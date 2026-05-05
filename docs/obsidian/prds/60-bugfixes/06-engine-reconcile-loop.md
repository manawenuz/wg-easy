---
id: PRD-60-06
title: Engine reconcile loop + mutation retry queue
status: draft
phase: P1
priority: high
severity: data-integrity
depends_on:
  - "[[prds/10-mikrotik/01-mikrotik-driver]]"
  - "[[prds/00-foundation/04-data-model-migration]]"
touches:
  - src/server/scheduler/index.ts
  - src/server/scheduler/reconciler.ts (new)
  - src/server/scheduler/mutationQueue.ts (new)
  - src/server/database/repositories/pendingMutation/schema.ts (new)
  - src/server/database/repositories/pendingMutation/types.ts (new)
  - src/server/database/repositories/pendingMutation/service.ts (new)
  - src/server/database/migrations/000X_pending_mutations.sql (new)
  - src/server/database/schema.ts
  - src/server/api/client/index.post.ts
  - src/server/api/client/[clientId]/index.delete.ts
  - src/server/api/client/[clientId]/index.post.ts
  - src/server/api/client/[clientId]/disable.post.ts
  - src/server/api/client/[clientId]/enable.post.ts
  - src/server/api/admin/interface/index.post.ts
  - src/server/api/admin/userconfig.post.ts
  - src/server/api/admin/hooks.post.ts
  - src/server/scheduler/reconciler.test.ts (new)
  - src/server/scheduler/mutationQueue.test.ts (new)
---

# PRD-60-06 — Engine reconcile loop + mutation retry queue

> Status: `draft` · Phase: `P1` · Severity: data-integrity (high)

## Why

Today the only path that pushes DB state to the router is a user-triggered API mutation calling `engine.syncInterface(iface, peers)` inline. Two failure modes leak silently:

1. **Mutation during router outage.** `api/client/index.post.ts:13-18` writes to the DB *then* awaits `syncInterface`. If MikroTik is unreachable at that moment, the API returns 5xx, the client row already exists, and the peer is never pushed. There is no retry queue.
2. **Router state drift.** If the router reboots and (for any reason — bad config, manual operator change, half-applied write) loses peer config, no scheduled job notices. `syncInterface` only fires on the next user mutation, which may be days away.

We need two cooperating mechanisms:

- A **periodic reconciler** that runs `syncInterface` against the live router on a slow tick (default 5 min), bringing DB and router back into agreement.
- A **mutation retry queue** so that the API path can return success the moment DB is durable, and an out-of-band worker pushes the change with bounded retry/backoff. Failures surface as audit events.

The combination guarantees eventual consistency between DB and router for any transient outage.

## User stories

- As an **admin**, when MikroTik is briefly unreachable, my `Create client` action still succeeds: the client appears in the UI immediately and is pushed to the router as soon as it's reachable again.
- As an **admin**, if MikroTik is rebooted out-of-band and forgets peer config, the system restores it within 5 minutes without me doing anything.
- As an **admin**, I see audit log entries (`engine.reconcile.ok`, `engine.mutation.retry`, `engine.mutation.giveUp`) so I can tell when reconciliation has been doing work for me.

## Scope

### In

- New `pending_mutation` table (id, client_id?, kind, payload, attempts, next_attempt_at, last_error, created_at).
- Periodic reconciler tick (default 300 s) that calls `engine.syncInterface(iface, await Database.clients.getAll())` per interface.
- Periodic mutation-queue drain tick (default 15 s) that processes pending mutations in FIFO order with exponential backoff (15s, 30s, 1m, 5m, 15m capped, give up at 10 attempts).
- Inline write-through path is preserved: API handlers still attempt `syncInterface` synchronously. On failure, they enqueue a pending mutation and return 200 with `{success: true, queued: true}` (instead of 5xx).
- Audit events: `engine.reconcile.ok`, `engine.reconcile.error`, `engine.mutation.retry` (with attempt count), `engine.mutation.giveUp`.
- Failure-streak tracking: after N consecutive sample/reconcile failures, mark `router.last_seen_error` (handled by [[prds/60-bugfixes/08-engine-health-surface]]; this PRD just emits the audit events).

### Out

- Per-mutation conflict resolution. If the user enables a peer while a queued disable mutation is pending for the same peer, last-write-wins on the queue (newer mutation supersedes older for same client_id+kind).
- UI surface for the queue (out: shown in audit log only; richer UI is folded into [[prds/60-bugfixes/08-engine-health-surface]]).
- Cross-router federation reconciliation (out: future PRD; this PRD assumes one router per interface).

## Data model changes

```ts
// src/server/database/repositories/pendingMutation/schema.ts
export const pendingMutation = sqliteTable('pending_mutation', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  interfaceId: text('interface_id').notNull(),
  kind: text('kind').$type<'syncInterface'>().notNull(), // future: more granular
  clientId: integer('client_id').references(() => client.id, { onDelete: 'cascade' }),
  payload: text('payload', { mode: 'json' }).notNull(), // serialized context
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp' }).notNull(),
  lastError: text('last_error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
// index on (interface_id, next_attempt_at) for the drain query.
```

Migration up: create table + index. Migration down: drop table.

## API changes

No new endpoints. Behavior change in existing handlers:

| Handler | Before | After |
|---|---|---|
| `client/index.post.ts` | `await syncInterface()` → on throw, return 5xx | `await syncInterface()` → on throw, enqueue + return 200 with `queued: true` |
| `client/[id]/index.delete.ts` | same | same |
| `client/[id]/index.post.ts` | same | same |
| `client/[id]/{enable,disable}.post.ts` | same | same |
| `admin/interface/index.post.ts` | same | same |
| `admin/{userconfig,hooks}.post.ts` | same | same |

Response shape gains optional `queued: boolean`. UI may show a small "syncing…" badge when `queued=true`.

## Driver / backend changes

- New module `src/server/scheduler/reconciler.ts` exporting `runReconciler()`. Pulls interfaces, calls engine.syncInterface for each. Errors update `router.last_seen_error` (touched in [[prds/60-bugfixes/08-engine-health-surface]]).
- New module `src/server/scheduler/mutationQueue.ts` exporting:
  - `enqueueMutation(kind, interfaceId, clientId, payload)` — used by API handlers on transient failure.
  - `runMutationQueue()` — scheduler tick that picks rows where `next_attempt_at <= now`, attempts them, on success deletes the row, on failure updates attempts/next_attempt_at/last_error.
- `src/server/scheduler/index.ts` registers both new ticks.
- No changes to `VpnEngine` interface (the queue calls existing methods).

## Migration & rollout

- Schema migrate first (creates empty table; idle code is fine).
- Deploy code; reconciler and mutation queue start up.
- No backfill required; the queue is empty at start.
- Backwards-compat: old API responses without `queued` are still valid; clients that don't read it just see `success: true`.

## Verification

**Unit tests:**
- `reconciler.test.ts` — mocks engine, asserts syncInterface called with all clients per interface; asserts errors recorded.
- `mutationQueue.test.ts` — enqueue → drain succeeds → row deleted; enqueue → drain fails → attempts incremented + backoff applied; give-up after N attempts.

**Integration tests** (live tgCHR):
- `src/test/mikrotik_reconcile_verify.ts` (new):
  1. Confirm baseline peers on router.
  2. Manually delete a peer on the router via SSH.
  3. Wait one reconciler tick.
  4. Assert peer is back.
- Mutation queue: with router unplugged (or `enabled=0` on `router` row), call `POST /api/client`; assert API returns `{success:true,queued:true}`; re-enable router; wait queue tick; assert peer present.

**Manual test plan:**
1. Reboot tgCHR via `/system/reboot`.
2. While it's down, create a client in the UI. Confirm UI shows the client and a `queued` badge if implemented.
3. After tgCHR is back, within 30s of the next queue tick, the client appears on the router.
4. Audit log shows one `engine.mutation.retry` then `engine.reconcile.ok`.

## Open questions

- [ ] Default reconciler interval (300 s suggested; might be too aggressive for fleets with many peers — revisit if poll cost becomes a problem).
- [ ] Drain ordering — strict FIFO across the whole queue, or per-(interface, client_id)? Recommend per-client FIFO so a stuck client doesn't block others.

---

## Kimi handoff

**Read before implementing:**
- `[[architecture]]` — engine + scheduler sections.
- `src/server/scheduler/index.ts` (full)
- `src/server/scheduler/usagePoller.ts` (full) — copy the catch/log idiom.
- `src/server/scheduler/quotaEvaluator.ts` (full)
- `src/server/api/client/index.post.ts` (full)
- `src/server/api/client/[clientId]/index.delete.ts` (full)
- `src/server/database/schema.ts` (lines 1-80) — to slot the new schema.
- `src/server/engines/types.ts` — confirm `VpnEngine.syncInterface` signature.

**Modify these files:** see `touches:` list.

**Do NOT modify:**
- `VpnEngine` interface (`src/server/engines/types.ts`) beyond what's explicit above.
- Engine implementations themselves.
- UI files (out of scope for this PRD).

**Acceptance tests** (Kimi must demonstrate these pass):
1. Vitest suite green: `pnpm vitest run scheduler/reconciler scheduler/mutationQueue`.
2. Live integration test `mikrotik_reconcile_verify.ts` passes against tgCHR.
3. Manual: with router stopped, `POST /api/client` returns `{success:true,queued:true,clientId:X}` (not 5xx), and after router restart the peer ends up on the router within 60s.

**Self-test plan:**
```bash
cd src
pnpm vitest run server/scheduler
# Live test against tgCHR (over Tailscale):
ssh tgmanwehs 'docker run --rm -v ~/wg-easy/src:/app -v /home/manwe/.ssh/wzp:/root/.ssh/wzp:ro --network host -w /app -e CI=true node:20-alpine sh -c "corepack enable pnpm && npx tsx test/mikrotik_reconcile_verify.ts"'
```
