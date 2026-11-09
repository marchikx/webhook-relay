export type OutboxStatus = 'pending' | 'leased' | 'delivered' | 'dead';

export type OutboxMessage = {
  id: string;
  targetUrl: string;
  body: string;
  headers: Record<string, string>;
  attemptCount: number;
  status: OutboxStatus;
  createdAt: number;
  leasedBy?: string;
  leaseUntil?: number;
  nextAttemptAt: number;
  lastError?: string;
};

export type EnqueueInput = {
  targetUrl: string;
  body: string;
  headers?: Record<string, string>;
  id?: string;
};

export type LeaseFence = {
  workerId: string;
  leaseUntil: number;
};

type Awaitable<T> = T | Promise<T>;

/** What the delivery worker needs; implemented by `OutboxStore` (memory) and `PostgresOutboxStore`. */
export interface OutboxRepository {
  claimWithLease(workerId: string, leaseMs: number, now?: number): Awaitable<OutboxMessage | null>;
  markDelivered(id: string, fence?: LeaseFence): Awaitable<void>;
  markFailed(
    id: string,
    error: string,
    nextAttemptAt: number,
    moveToDeadLetter: boolean,
    fence?: LeaseFence,
  ): Awaitable<void>;
}

function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export class OutboxStore implements OutboxRepository {
  private readonly messages = new Map<string, OutboxMessage>();
  private readonly deadLetters = new Map<string, OutboxMessage>();

  enqueue(input: EnqueueInput, now: number = Date.now()): OutboxMessage {
    const id = input.id ?? createId();
    const message: OutboxMessage = {
      id,
      targetUrl: input.targetUrl,
      body: input.body,
      headers: input.headers ?? {},
      attemptCount: 0,
      status: 'pending',
      createdAt: now,
      nextAttemptAt: now,
    };
    this.messages.set(id, message);
    return { ...message };
  }

  claimWithLease(
    workerId: string,
    leaseMs: number,
    now: number = Date.now(),
  ): OutboxMessage | null {
    for (const message of this.messages.values()) {
      if (message.status === 'delivered' || message.status === 'dead') {
        continue;
      }
      if (message.nextAttemptAt > now) {
        continue;
      }
      if (message.status === 'leased' && message.leaseUntil && message.leaseUntil > now) {
        continue;
      }
      message.status = 'leased';
      message.leasedBy = workerId;
      message.leaseUntil = now + leaseMs;
      return { ...message };
    }
    return null;
  }

  get(id: string): OutboxMessage | undefined {
    const m = this.messages.get(id);
    return m ? { ...m } : undefined;
  }

  private assertFence(message: OutboxMessage, fence?: LeaseFence): boolean {
    if (!fence) {
      return true;
    }
    return message.leasedBy === fence.workerId && message.leaseUntil === fence.leaseUntil;
  }

  markDelivered(id: string, fence?: LeaseFence): void {
    const message = this.messages.get(id);
    if (!message) {
      return;
    }
    if (!this.assertFence(message, fence)) {
      return;
    }
    message.status = 'delivered';
    message.leasedBy = undefined;
    message.leaseUntil = undefined;
    message.lastError = undefined;
  }

  markFailed(
    id: string,
    error: string,
    nextAttemptAt: number,
    moveToDeadLetter: boolean,
    fence?: LeaseFence,
  ): void {
    const message = this.messages.get(id);
    if (!message) {
      return;
    }
    if (!this.assertFence(message, fence)) {
      return;
    }
    message.attemptCount += 1;
    message.lastError = error;
    message.leasedBy = undefined;
    message.leaseUntil = undefined;

    if (moveToDeadLetter) {
      message.status = 'dead';
      message.nextAttemptAt = nextAttemptAt;
      this.deadLetters.set(id, { ...message });
      this.messages.delete(id);
      return;
    }

    message.status = 'pending';
    message.nextAttemptAt = nextAttemptAt;
  }

  listDeadLetters(): OutboxMessage[] {
    return [...this.deadLetters.values()].map((m) => ({ ...m }));
  }
}
