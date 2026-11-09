import { describe, expect, it } from 'vitest';
import { IdempotencyStore } from '../src/idempotency.js';
describe('IdempotencyStore', () => {
    it('rejects duplicate keys until TTL expires', () => {
        const store = new IdempotencyStore();
        const ttl = 60_000;
        const t0 = 1_000_000;
        expect(store.rememberKey('evt-1', ttl, t0)).toBe(true);
        expect(store.seenKey('evt-1', t0)).toBe(true);
        expect(store.rememberKey('evt-1', ttl, t0 + 1)).toBe(false);
        expect(store.rememberKey('evt-1', ttl, t0 + ttl + 1)).toBe(true);
    });
});
