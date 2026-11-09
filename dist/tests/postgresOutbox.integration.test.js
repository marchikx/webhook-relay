import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processOnce } from '../src/deliveryWorker.js';
import { PostgresOutboxStore } from '../src/postgresOutbox.js';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('PostgresOutboxStore (real Postgres)', () => {
    let pool;
    let store;
    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: url, max: 10 });
        store = new PostgresOutboxStore(pool);
        await store.migrate();
    });
    beforeEach(async () => {
        await pool.query('TRUNCATE outbox_messages');
    });
    afterAll(async () => {
        await pool?.end();
    });
    it('never hands the same message to two concurrent workers', async () => {
        const now = 1_000_000;
        for (let i = 0; i < 20; i += 1) {
            await store.enqueue({ id: `m${i}`, targetUrl: 'https://hooks.example.com', body: '{}' }, now);
        }
        const claims = await Promise.all(Array.from({ length: 30 }, (_, i) => store.claimWithLease(`w${i}`, 30_000, now)));
        const ids = claims.filter((c) => c !== null).map((c) => c.id);
        expect(ids).toHaveLength(20);
        expect(new Set(ids).size).toBe(20);
    });
    it('re-delivers a message whose worker died after its lease expired', async () => {
        const now = 1_000_000;
        await store.enqueue({ id: 'crash', targetUrl: 'https://hooks.example.com', body: '{}' }, now);
        expect((await store.claimWithLease('dead-worker', 1_000, now))?.id).toBe('crash');
        expect(await store.claimWithLease('other', 1_000, now + 500)).toBeNull();
        expect((await store.claimWithLease('other', 1_000, now + 1_000))?.leasedBy).toBe('other');
    });
    it('is idempotent on enqueue id', async () => {
        await store.enqueue({ id: 'dup', targetUrl: 'https://a.example.com', body: '1' }, 1);
        const again = await store.enqueue({ id: 'dup', targetUrl: 'https://b.example.com', body: '2' }, 2);
        expect(again.targetUrl).toBe('https://a.example.com');
        const { rows } = await pool.query('SELECT count(*)::int AS n FROM outbox_messages');
        expect(rows[0].n).toBe(1);
    });
    it('runs the real worker loop through retries into the dead-letter queue', async () => {
        const failing = async () => ({ ok: false, status: 503, statusText: 'Unavailable' });
        let now = 1_000_000;
        await store.enqueue({ id: 'poison', targetUrl: 'https://hooks.example.com', body: '{}' }, now);
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            const result = await processOnce({ store, workerId: 'w', leaseMs: 30_000, fetch: failing, maxAttempts: 3, now });
            if (result.outcome === 'retry') {
                now = result.nextAttemptAt;
            }
            else {
                expect(result).toEqual({ outcome: 'dead', messageId: 'poison', attempt: 3 });
            }
        }
        const dead = await store.listDeadLetters();
        expect(dead).toHaveLength(1);
        expect(dead[0]).toMatchObject({ id: 'poison', attemptCount: 3, lastError: 'HTTP 503 Unavailable' });
        expect(await store.claimWithLease('w', 30_000, now + 10 ** 9)).toBeNull();
    });
});
