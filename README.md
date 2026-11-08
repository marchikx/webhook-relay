# webhook-relay

[![CI](https://github.com/marchikx/webhook-relay/actions/workflows/ci.yml/badge.svg)](https://github.com/marchikx/webhook-relay/actions/workflows/ci.yml) ![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

Transactional webhook **outbox** for Node.js: enqueue events, deliver over HTTP with worker leases, exponential backoff, a dead-letter queue (DLQ), HMAC signing helpers, and idempotency keys. Everything ships with in-memory stores so you can unit-test reliability logic without a database.

## Who it is for

Teams that accept webhooks or emit them to customers and need **at-least-once delivery** with safe retries—not fire-and-forget `fetch` from the request thread. Integrate the outbox in your API, run `processOnce` in a worker loop, and plug in Postgres or Redis adapters in production.

## Demo snippet

```typescript
import {
  OutboxStore,
  processOnce,
  IdempotencyStore,
  buildSignedPayload,
  signHmacSha256,
} from 'webhook-relay';

const outbox = new OutboxStore();
const idem = new IdempotencyStore();

app.post('/events', (req, res) => {
  const key = req.headers['idempotency-key'] as string;
  if (!idem.rememberKey(key, 86_400_000)) {
    res.status(409).json({ error: 'duplicate' });
    return;
  }
  outbox.enqueue({ targetUrl: 'https://customer.app/hooks', body: req.rawBody });
  res.status(202).json({ accepted: true });
});

setInterval(() => {
  void processOnce({
    store: outbox,
    workerId: 'relay-1',
    leaseMs: 60_000,
    fetch: globalThis.fetch,
  });
}, 5_000);
```

Signing an outbound body:

```typescript
const timestamp = String(Math.floor(Date.now() / 1000));
const nonce = crypto.randomUUID();
const payload = buildSignedPayload(rawBody, timestamp, nonce);
const signature = signHmacSha256(process.env.WEBHOOK_SECRET!, payload);
```

## Quick start

```bash
git clone https://github.com/marchikx/webhook-relay
cd webhook-relay
make verify
```

`make verify` runs `npm ci` and `npm run verify` (TypeScript check + Vitest). Expect exit code `0`.

## Architecture

```mermaid
flowchart TB
  API[HTTP ingress] -->|202 accept| OB[(OutboxRepository: memory or Postgres)]
  API --> IDEM[IdempotencyStore]
  W[Delivery worker] -->|claimWithLease| OB
  W -->|POST| DEST[Subscriber URL]
  DEST -->|2xx| W
  W -->|markDelivered| OB
  DEST -->|fail| W
  W -->|backoff + retry| OB
  W -->|max attempts| DLQ[Dead letters]
  OB -.->|HMAC helpers| SIG[sign / verify]
```

## Decisions and tradeoffs

| Choice | Rationale |
|--------|-----------|
| Two stores, one `OutboxRepository` contract | `OutboxStore` (memory) for unit tests; `PostgresOutboxStore` for production. The worker cannot tell them apart. |
| Claim = one `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)` | Many workers poll one table without blocking or double-claiming; no advisory locks, no separate queue broker. |
| Lease expiry instead of heartbeats | A crashed worker's message becomes claimable again after `leaseMs`. Cost: delivery is **at-least-once**, so receivers must dedupe (HMAC nonce / idempotency key). |
| No lease fencing on `markDelivered` / `markFailed` | Kept simple on purpose. If a worker outlives its lease, a second delivery can race it; pick `leaseMs` well above your HTTP timeout. |
| `pg` is a dev dependency only | `PostgresOutboxStore` takes any `{ query(text, params) }`, so `pg.Pool`, a pooled client, or a test double all work. |
| 5-minute base backoff, 12h cap | Limits load on a failing endpoint while guaranteeing eventual DLQ visibility. |
| `processOnce` not a long-running daemon | You control scheduling (cron, queue consumer, serverless tick). |
| HMAC over `timestamp.nonce.body` | Common signed-webhook pattern; constant-time compare on verify. |

## Tests

```bash
npm test
```

Coverage includes HMAC verify success and failure, backoff growth and cap, successful delivery, five failures leading to DLQ, and duplicate idempotency rejection.

**Against real Postgres** (`tests/postgresOutbox.integration.test.ts`, runs in CI on a `postgres:16` service; skipped locally unless `TEST_DATABASE_URL` is set):

- 30 concurrent workers race for 20 messages → exactly 20 claims, zero duplicates
- a worker that dies mid-lease → message is re-claimed only after the lease expires
- duplicate `enqueue` id → one row, original payload kept
- the real `processOnce` loop drives a poison message through retries into the DLQ

```bash
docker run -d --name relay-pg -e POSTGRES_PASSWORD=relay -p 5432:5432 postgres:16-alpine
TEST_DATABASE_URL=postgresql://postgres:relay@localhost:5432/postgres npm test
```

## License

MIT — see [LICENSE](LICENSE).

## Hire / paid task

Need **production-grade webhook infrastructure** (Postgres outbox, metrics, multi-tenant signing keys, replay UI)? Open a GitHub issue with your volume and SLO targets, or mention “webhook relay hardening” — typical engagement: audit your current retry/DLQ behavior and deliver a hardened worker plus runbooks in one sprint.
