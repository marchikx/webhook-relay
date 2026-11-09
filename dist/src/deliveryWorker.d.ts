import type { OutboxRepository } from './outbox.js';
export type FetchLike = (input: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}) => Promise<{
    ok: boolean;
    status: number;
    statusText?: string;
}>;
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
export type ProcessOnceResult = {
    outcome: 'idle';
} | {
    outcome: 'delivered';
    messageId: string;
} | {
    outcome: 'retry';
    messageId: string;
    attempt: number;
    nextAttemptAt: number;
} | {
    outcome: 'dead';
    messageId: string;
    attempt: number;
};
export declare function processOnce(options: ProcessOnceOptions): Promise<ProcessOnceResult>;
