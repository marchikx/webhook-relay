import type { EnqueueInput, LeaseFence, OutboxMessage } from './outbox.js';
/** Minimal surface of `pg.Pool` / `pg.Client`, so this module has no runtime dependency on `pg`. */
export type Queryable = {
    query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{
        rows: R[];
        rowCount?: number | null;
    }>;
};
export declare const OUTBOX_SCHEMA_SQL = "\nCREATE TABLE IF NOT EXISTS outbox_messages (\n  id              text PRIMARY KEY,\n  target_url      text   NOT NULL,\n  body            text   NOT NULL,\n  headers         jsonb  NOT NULL DEFAULT '{}'::jsonb,\n  attempt_count   int    NOT NULL DEFAULT 0,\n  status          text   NOT NULL CHECK (status IN ('pending','leased','delivered','dead')),\n  created_at      bigint NOT NULL,\n  leased_by       text,\n  lease_until     bigint,\n  next_attempt_at bigint NOT NULL,\n  last_error      text\n);\nCREATE INDEX IF NOT EXISTS outbox_messages_due_idx\n  ON outbox_messages (next_attempt_at, created_at)\n  WHERE status IN ('pending','leased');\n";
/**
 * Postgres-backed outbox with the same contract as the in-memory `OutboxStore`.
 * Timestamps are epoch milliseconds so the worker's injectable clock works identically in tests.
 */
export declare class PostgresOutboxStore {
    private readonly db;
    constructor(db: Queryable);
    migrate(): Promise<void>;
    /** Idempotent on `id`: re-enqueueing an existing id returns the stored row unchanged. */
    enqueue(input: EnqueueInput, now?: number): Promise<OutboxMessage>;
    /**
     * Claims one due message in a single statement. `FOR UPDATE SKIP LOCKED` lets many workers
     * poll the same table without blocking each other or double-claiming a row; an expired lease
     * makes the row claimable again, which is how a crashed worker's message is recovered.
     */
    claimWithLease(workerId: string, leaseMs: number, now?: number): Promise<OutboxMessage | null>;
    get(id: string): Promise<OutboxMessage | undefined>;
    markDelivered(id: string, fence?: LeaseFence): Promise<void>;
    markFailed(id: string, error: string, nextAttemptAt: number, moveToDeadLetter: boolean, fence?: LeaseFence): Promise<void>;
    listDeadLetters(): Promise<OutboxMessage[]>;
}
