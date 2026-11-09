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
    markFailed(id: string, error: string, nextAttemptAt: number, moveToDeadLetter: boolean, fence?: LeaseFence): Awaitable<void>;
}
export declare class OutboxStore implements OutboxRepository {
    private readonly messages;
    private readonly deadLetters;
    enqueue(input: EnqueueInput, now?: number): OutboxMessage;
    claimWithLease(workerId: string, leaseMs: number, now?: number): OutboxMessage | null;
    get(id: string): OutboxMessage | undefined;
    private assertFence;
    markDelivered(id: string, fence?: LeaseFence): void;
    markFailed(id: string, error: string, nextAttemptAt: number, moveToDeadLetter: boolean, fence?: LeaseFence): void;
    listDeadLetters(): OutboxMessage[];
}
export {};
