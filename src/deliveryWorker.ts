import { exponentialBackoffMs } from './backoff.js';
import { signHmacSha256 } from './hmac.js';
import type { LeaseFence, OutboxRepository } from './outbox.js';

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
  /** When set, outbound POSTs include X-Signature / X-Timestamp / X-Nonce HMAC headers. */
  hmacSecret?: string;
};

export type ProcessOnceResult =
  | { outcome: 'idle' }
  | { outcome: 'delivered'; messageId: string }
  | { outcome: 'retry'; messageId: string; attempt: number; nextAttemptAt: number }
  | { outcome: 'dead'; messageId: string; attempt: number };

const DEFAULT_MAX_ATTEMPTS = 5;

function signedHeaders(secret: string, body: string, now: number): Record<string, string> {
  const timestamp = String(Math.floor(now / 1000));
  const nonce =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `n_${now}`;
  const payload = `${timestamp}.${nonce}.${body}`;
  const signature = signHmacSha256(secret, payload);
  return {
    'x-timestamp': timestamp,
    'x-nonce': nonce,
    'x-signature': signature,
  };
}

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
    hmacSecret,
  } = options;

  const claimed = await store.claimWithLease(workerId, leaseMs, now);
  if (!claimed) {
    return { outcome: 'idle' };
  }

  const fence: LeaseFence = {
    workerId,
    leaseUntil: claimed.leaseUntil ?? now + leaseMs,
  };

  try {
    const authHeaders = hmacSecret ? signedHeaders(hmacSecret, claimed.body, now) : {};
    const response = await fetch(claimed.targetUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...claimed.headers,
        ...authHeaders,
      },
      body: claimed.body,
    });

    if (response.ok) {
      await store.markDelivered(claimed.id, fence);
      return { outcome: 'delivered', messageId: claimed.id };
    }

    const error = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
    return handleFailure(store, claimed.id, claimed.attemptCount, error, maxAttempts, now, fence);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return handleFailure(store, claimed.id, claimed.attemptCount, error, maxAttempts, now, fence);
  }
}

async function handleFailure(
  store: OutboxRepository,
  messageId: string,
  previousAttempts: number,
  error: string,
  maxAttempts: number,
  now: number,
  fence: LeaseFence,
): Promise<ProcessOnceResult> {
  const attemptAfterFail = previousAttempts + 1;
  const moveToDeadLetter = attemptAfterFail >= maxAttempts;
  const nextAttemptAt = now + exponentialBackoffMs(attemptAfterFail);
  await store.markFailed(messageId, error, nextAttemptAt, moveToDeadLetter, fence);

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
