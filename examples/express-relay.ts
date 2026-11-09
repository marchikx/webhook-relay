/**
 * Minimal Express-shaped sketch (no express dependency): enqueue + processOnce loop.
 * Run after `npm run build` conceptually — copy into an Express route in real apps.
 */
import { OutboxStore, processOnce, signHmacSha256 } from '../src/index.js';

const store = new OutboxStore();
const secret = process.env.WEBHOOK_HMAC_SECRET ?? 'dev-secret';

export function enqueueEvent(targetUrl: string, body: unknown): string {
  const raw = JSON.stringify(body);
  const msg = store.enqueue({
    targetUrl,
    body: raw,
    headers: { 'x-demo': 'express-relay' },
  });
  return msg.id;
}

export async function tickWorker(workerId = 'express-1'): Promise<string> {
  const result = await processOnce({
    store,
    workerId,
    leaseMs: 15_000,
    hmacSecret: secret,
    fetch: async (url, init) => {
      // Replace with global fetch in Node 18+
      const res = await fetch(url, {
        method: init?.method ?? 'POST',
        headers: init?.headers,
        body: init?.body,
      });
      return { ok: res.ok, status: res.status, statusText: res.statusText };
    },
  });
  return result.outcome;
}

export function verifyInbound(rawBody: string, timestamp: string, nonce: string, sig: string): boolean {
  const expected = signHmacSha256(secret, `${timestamp}.${nonce}.${rawBody}`);
  return expected === sig;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const id = enqueueEvent('https://httpbin.org/status/200', { hello: 'relay' });
  console.log('enqueued', id);
}
