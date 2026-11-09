import type { EnqueueInput, LeaseFence, OutboxMessage, OutboxStatus } from './outbox.js';

function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/** Minimal surface of `pg.Pool` / `pg.Client`, so this module has no runtime dependency on `pg`. */
export type Queryable = {
  query<R = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: R[]; rowCount?: number | null }>;
};

type Row = {
  id: string;
  target_url: string;
  body: string;
  headers: Record<string, string>;
  attempt_count: number;
  status: OutboxStatus;
  created_at: string;
  leased_by: string | null;
  lease_until: string | null;
  next_attempt_at: string;
  last_error: string | null;
};

export const OUTBOX_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS outbox_messages (
  id              text PRIMARY KEY,
  target_url      text   NOT NULL,
  body            text   NOT NULL,
  headers         jsonb  NOT NULL DEFAULT '{}'::jsonb,
  attempt_count   int    NOT NULL DEFAULT 0,
  status          text   NOT NULL CHECK (status IN ('pending','leased','delivered','dead')),
  created_at      bigint NOT NULL,
  leased_by       text,
  lease_until     bigint,
  next_attempt_at bigint NOT NULL,
  last_error      text
);
CREATE INDEX IF NOT EXISTS outbox_messages_due_idx
  ON outbox_messages (next_attempt_at, created_at)
  WHERE status IN ('pending','leased');
`;

function toMessage(row: Row): OutboxMessage {
  return {
    id: row.id,
    targetUrl: row.target_url,
    body: row.body,
    headers: row.headers ?? {},
    attemptCount: row.attempt_count,
    status: row.status,
    createdAt: Number(row.created_at),
    leasedBy: row.leased_by ?? undefined,
    leaseUntil: row.lease_until === null ? undefined : Number(row.lease_until),
    nextAttemptAt: Number(row.next_attempt_at),
    lastError: row.last_error ?? undefined,
  };
}

/**
 * Postgres-backed outbox with the same contract as the in-memory `OutboxStore`.
 * Timestamps are epoch milliseconds so the worker's injectable clock works identically in tests.
 */
export class PostgresOutboxStore {
  constructor(private readonly db: Queryable) {}

  async migrate(): Promise<void> {
    await this.db.query(OUTBOX_SCHEMA_SQL);
  }

  /** Idempotent on `id`: re-enqueueing an existing id returns the stored row unchanged. */
  async enqueue(input: EnqueueInput, now: number = Date.now()): Promise<OutboxMessage> {
    const id = input.id ?? createId();
    const { rows } = await this.db.query<Row>(
      `INSERT INTO outbox_messages (id, target_url, body, headers, status, created_at, next_attempt_at)
       VALUES ($1, $2, $3, $4::jsonb, 'pending', $5, $5)
       ON CONFLICT (id) DO UPDATE SET id = outbox_messages.id
       RETURNING *`,
      [id, input.targetUrl, input.body, JSON.stringify(input.headers ?? {}), now],
    );
    return toMessage(rows[0]);
  }

  /**
   * Claims one due message in a single statement. `FOR UPDATE SKIP LOCKED` lets many workers
   * poll the same table without blocking each other or double-claiming a row; an expired lease
   * makes the row claimable again, which is how a crashed worker's message is recovered.
   */
  async claimWithLease(
    workerId: string,
    leaseMs: number,
    now: number = Date.now(),
  ): Promise<OutboxMessage | null> {
    const { rows } = await this.db.query<Row>(
      `UPDATE outbox_messages
          SET status = 'leased', leased_by = $1, lease_until = $3::bigint + $2::bigint
        WHERE id = (
          SELECT id FROM outbox_messages
           WHERE next_attempt_at <= $3
             AND (status = 'pending' OR (status = 'leased' AND lease_until <= $3))
           ORDER BY next_attempt_at, created_at
           LIMIT 1
           FOR UPDATE SKIP LOCKED)
        RETURNING *`,
      [workerId, leaseMs, now],
    );
    return rows[0] ? toMessage(rows[0]) : null;
  }

  async get(id: string): Promise<OutboxMessage | undefined> {
    const { rows } = await this.db.query<Row>('SELECT * FROM outbox_messages WHERE id = $1', [id]);
    return rows[0] ? toMessage(rows[0]) : undefined;
  }

  async markDelivered(id: string, fence?: LeaseFence): Promise<void> {
    if (fence) {
      await this.db.query(
        `UPDATE outbox_messages
            SET status = 'delivered', leased_by = NULL, lease_until = NULL, last_error = NULL
          WHERE id = $1 AND leased_by = $2 AND lease_until = $3`,
        [id, fence.workerId, fence.leaseUntil],
      );
      return;
    }
    await this.db.query(
      `UPDATE outbox_messages
          SET status = 'delivered', leased_by = NULL, lease_until = NULL, last_error = NULL
        WHERE id = $1`,
      [id],
    );
  }

  async markFailed(
    id: string,
    error: string,
    nextAttemptAt: number,
    moveToDeadLetter: boolean,
    fence?: LeaseFence,
  ): Promise<void> {
    if (fence) {
      await this.db.query(
        `UPDATE outbox_messages
            SET attempt_count = attempt_count + 1,
                last_error = $2,
                leased_by = NULL,
                lease_until = NULL,
                next_attempt_at = $3,
                status = CASE WHEN $4::boolean THEN 'dead' ELSE 'pending' END
          WHERE id = $1 AND leased_by = $5 AND lease_until = $6`,
        [id, error, nextAttemptAt, moveToDeadLetter, fence.workerId, fence.leaseUntil],
      );
      return;
    }
    await this.db.query(
      `UPDATE outbox_messages
          SET attempt_count = attempt_count + 1,
              last_error = $2,
              leased_by = NULL,
              lease_until = NULL,
              next_attempt_at = $3,
              status = CASE WHEN $4::boolean THEN 'dead' ELSE 'pending' END
        WHERE id = $1`,
      [id, error, nextAttemptAt, moveToDeadLetter],
    );
  }

  async listDeadLetters(): Promise<OutboxMessage[]> {
    const { rows } = await this.db.query<Row>(
      "SELECT * FROM outbox_messages WHERE status = 'dead' ORDER BY created_at",
    );
    return rows.map(toMessage);
  }
}
