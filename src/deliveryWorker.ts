import { exponentialBackoffMs } from './backoff.js';
import type { OutboxRepository } from './outbox.js';

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; statusText?: string }>;

export type ProcessOnceOptions = {
  store: OutboxRepository;
  workerId: string;
  leaseMs: number;
  fetch: FetchLike;
  maxAttempts?: number;
  now?: number;
};

export type ProcessOnceResult =
  | { outcome: 'idle' }
  | { outcome: 'delivered'; messageId: string }
  | { outcome: 'retry'; messageId: string; attempt: number; nextAttemptAt: number }
  | { outcome: 'dead'; messageId: string; attempt: number };

const DEFAULT_MAX_ATTEMPTS = 5;

export async function processOnce(
  options: ProcessOnceOptions,
): Promise<ProcessOnceResult> {
  const {
    store,
    workerId,
    leaseMs,
    fetch,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    now = Date.now(),
  } = options;

  const claimed = await store.claimWithLease(workerId, leaseMs, now);
  if (!claimed) {
    return { outcome: 'idle' };
  }

  try {
    const response = await fetch(claimed.targetUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...claimed.headers,
      },
      body: claimed.body,
    });

    if (response.ok) {
      await store.markDelivered(claimed.id);
      return { outcome: 'delivered', messageId: claimed.id };
    }

    const error = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
    return handleFailure(store, claimed.id, claimed.attemptCount, error, maxAttempts, now);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return handleFailure(store, claimed.id, claimed.attemptCount, error, maxAttempts, now);
  }
}

async function handleFailure(
  store: OutboxRepository,
  messageId: string,
  previousAttempts: number,
  error: string,
  maxAttempts: number,
  now: number,
): Promise<ProcessOnceResult> {
  const attemptAfterFail = previousAttempts + 1;
  const moveToDeadLetter = attemptAfterFail >= maxAttempts;
  const nextAttemptAt = now + exponentialBackoffMs(attemptAfterFail);
  await store.markFailed(messageId, error, nextAttemptAt, moveToDeadLetter);

  if (moveToDeadLetter) {
    return { outcome: 'dead', messageId, attempt: attemptAfterFail };
  }

  return {
    outcome: 'retry',
    messageId,
    attempt: attemptAfterFail,
    nextAttemptAt,
  };
}
