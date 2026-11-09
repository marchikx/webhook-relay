import { describe, expect, it, vi } from 'vitest';
import { processOnce } from '../src/deliveryWorker.js';
import { OutboxStore } from '../src/outbox.js';
describe('deliveryWorker.processOnce', () => {
    it('delivers successfully and marks the message delivered', async () => {
        const store = new OutboxStore();
        store.enqueue({
            targetUrl: 'https://example.com/hook',
            body: '{"ok":true}',
        });
        const fetch = vi.fn(async () => ({ ok: true, status: 200 }));
        const result = await processOnce({
            store,
            workerId: 'worker-a',
            leaseMs: 30_000,
            fetch,
        });
        expect(result.outcome).toBe('delivered');
        expect(fetch).toHaveBeenCalledOnce();
        const dead = store.listDeadLetters();
        expect(dead).toHaveLength(0);
    });
    it('moves to DLQ after five failed delivery attempts', async () => {
        const store = new OutboxStore();
        let now = 2_000_000;
        const msg = store.enqueue({
            targetUrl: 'https://example.com/hook',
            body: '{"fail":true}',
        }, now);
        const fetch = vi.fn(async () => ({
            ok: false,
            status: 503,
            statusText: 'Service Unavailable',
        }));
        for (let i = 0; i < 4; i++) {
            const result = await processOnce({
                store,
                workerId: 'worker-b',
                leaseMs: 30_000,
                fetch,
                now,
            });
            expect(result.outcome).toBe('retry');
            if (result.outcome === 'retry') {
                // Advance past backoff so the next claim is eligible.
                now = result.nextAttemptAt;
            }
        }
        const last = await processOnce({
            store,
            workerId: 'worker-b',
            leaseMs: 30_000,
            fetch,
            now,
        });
        expect(last.outcome).toBe('dead');
        const dlq = store.listDeadLetters();
        expect(dlq).toHaveLength(1);
        expect(dlq[0]?.id).toBe(msg.id);
        expect(dlq[0]?.attemptCount).toBe(5);
    });
});
