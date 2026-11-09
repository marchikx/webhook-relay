import { describe, expect, it } from 'vitest';
import { OutboxStore } from '../src/outbox.js';
import { processOnce } from '../src/deliveryWorker.js';
describe('lease fencing', () => {
    it('ignores stale markDelivered from a worker that lost the lease', () => {
        const store = new OutboxStore();
        const t0 = 1_000;
        const msg = store.enqueue({
            targetUrl: 'https://example.test/hook',
            body: '{"ok":true}',
        }, t0);
        const claimed = store.claimWithLease('worker-a', 60_000, t0);
        expect(claimed?.id).toBe(msg.id);
        // Simulate another worker reclaiming after lease expiry
        const reclaimed = store.claimWithLease('worker-b', 60_000, 100_000);
        expect(reclaimed?.leasedBy).toBe('worker-b');
        store.markDelivered(msg.id, {
            workerId: 'worker-a',
            leaseUntil: claimed.leaseUntil,
        });
        expect(store.get(msg.id)?.status).toBe('leased');
        expect(store.get(msg.id)?.leasedBy).toBe('worker-b');
        store.markDelivered(msg.id, {
            workerId: 'worker-b',
            leaseUntil: reclaimed.leaseUntil,
        });
        expect(store.get(msg.id)?.status).toBe('delivered');
    });
    it('signs outbound deliveries when hmacSecret is set', async () => {
        const store = new OutboxStore();
        store.enqueue({ targetUrl: 'https://example.test/hook', body: '{"a":1}' });
        let sawSig = false;
        const result = await processOnce({
            store,
            workerId: 'w1',
            leaseMs: 5_000,
            hmacSecret: 'test-secret',
            fetch: async (_url, init) => {
                sawSig = Boolean(init?.headers?.['x-signature']);
                expect(init?.headers?.['x-timestamp']).toBeTruthy();
                expect(init?.headers?.['x-nonce']).toBeTruthy();
                return { ok: true, status: 200 };
            },
        });
        expect(result.outcome).toBe('delivered');
        expect(sawSig).toBe(true);
    });
});
