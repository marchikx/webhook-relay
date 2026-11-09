function createId() {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
export class OutboxStore {
    messages = new Map();
    deadLetters = new Map();
    enqueue(input, now = Date.now()) {
        const id = input.id ?? createId();
        const message = {
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
    claimWithLease(workerId, leaseMs, now = Date.now()) {
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
    get(id) {
        const m = this.messages.get(id);
        return m ? { ...m } : undefined;
    }
    assertFence(message, fence) {
        if (!fence) {
            return true;
        }
        return message.leasedBy === fence.workerId && message.leaseUntil === fence.leaseUntil;
    }
    markDelivered(id, fence) {
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
    markFailed(id, error, nextAttemptAt, moveToDeadLetter, fence) {
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
    listDeadLetters() {
        return [...this.deadLetters.values()].map((m) => ({ ...m }));
    }
}
