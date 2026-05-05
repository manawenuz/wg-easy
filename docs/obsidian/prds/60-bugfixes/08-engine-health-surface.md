---
id: PRD-60-08
title: Engine health surface — connectivity status, last_seen, audit alerts
status: draft
phase: P1
priority: medium
severity: observability
depends_on:
  - "[[prds/10-mikrotik/01-mikrotik-driver]]"
  - "[[prds/60-bugfixes/06-engine-reconcile-loop]]"
touches:
  - src/server/database/repositories/router/schema.ts
  - src/server/database/repositories/router/types.ts
  - src/server/database/repositories/router/service.ts
  - src/server/database/migrations/000X_router_health.sql (new)
  - src/server/scheduler/usagePoller.ts
  - src/server/scheduler/reconciler.ts
  - src/server/api/admin/router/[id]/index.get.ts
  - src/server/api/admin/router/index.get.ts
  - src/app/components/RouterHealthBadge.vue (new)
  - src/app/pages/admin/routers/index.vue
  - src/app/pages/admin/routers/[id].vue
  - src/i18n/locales/en.json
---

# PRD-60-08 — Engine health surface

> Status: `draft` · Phase: `P1` · Severity: observability (medium)

## Why

When MikroTik connectivity drops, today we fail silently: the periodic poll catches the exception, logs to `debug` (off by default), and moves on. Admins only learn of the outage when a user complains a tunnel doesn't work. We already have a `router.last_seen` column (used for nothing). This PRD wires it up and exposes it to the UI plus audit log so an admin glances and knows the engine state.

Combined with [[prds/60-bugfixes/06-engine-reconcile-loop]] (which provides the failure events), this closes the observability loop.

## User stories

- As an **admin**, the routers admin page shows a green/yellow/red dot per router with "last contacted X seconds ago".
- As an **admin**, I get an audit log entry when a router has been unreachable for ≥ N consecutive ticks (default 3, i.e. ~3 minutes).
- As an **admin**, I can drill into a router to see error history (last 10 errors, timestamped).

## Scope

### In

- Schema: add `last_seen_ok_at`, `last_seen_error`, `consecutive_failures` to `router` table.
- `runUsagePoller` and `runReconciler` update these fields on each call.
- After `consecutive_failures >= 3`, write one audit log entry `engine.unreachable` (debounced — don't write again until recovery).
- On recovery, write `engine.recovered` audit entry (with downtime duration).
- API: `GET /api/admin/router` includes the health fields; `GET /api/admin/router/[id]` adds an `errors[]` array (last 10 sourced from audit log filtered to `engine.*` for that router).
- UI: green dot if `consecutive_failures=0`, yellow if 1-2, red if ≥3, plus relative timestamp.

### Out

- Push notifications / email / webhooks — no notification subsystem exists yet.
- Per-engine SLO dashboards / Grafana export — out, but the `last_seen_*` columns enable future scrape.
- Detail charts of historical uptime — out, last 10 errors only.

## Data model changes

```ts
// src/server/database/repositories/router/schema.ts (additions)
last_seen_ok_at: integer('last_seen_ok_at', { mode: 'timestamp' }),
last_seen_error: text('last_seen_error'),
consecutive_failures: integer('consecutive_failures').notNull().default(0),
```

Migration up: `ALTER TABLE router ADD COLUMN ...` for each. Down: drop columns.

## API changes

| Method | Path | Auth | Returns (added fields) |
|---|---|---|---|
| GET | `/api/admin/router` | admin | each row gains `lastSeenOkAt`, `lastSeenError`, `consecutiveFailures` |
| GET | `/api/admin/router/[id]` | admin | adds `recentErrors: {ts, action, message}[]` (≤10) |

## UI changes

- New `src/app/components/RouterHealthBadge.vue` — colored dot + relative time.
- `src/app/pages/admin/routers/index.vue` — embed badge in the table.
- `src/app/pages/admin/routers/[id].vue` — show recent errors in a small table.
- i18n keys: `routers.health.ok`, `routers.health.degraded`, `routers.health.down`, `routers.health.lastSeen`.

## Driver / backend changes

- `usagePoller` and `reconciler` wrap engine calls in a helper:
  ```ts
  await recordEngineCall(routerId, async () => engine.sampleUsage(iface))
  ```
- `recordEngineCall` (in `Database.routers`) updates fields atomically and emits the threshold-crossing audit events.

## Migration & rollout

- Schema migrate, default values keep existing routers in "0 failures, never seen" state until first poll.
- No UI feature flag — green-by-default if no failures recorded.

## Verification

**Unit tests:**
- `recordEngineCall` success path → `consecutive_failures = 0`, `last_seen_ok_at` updated.
- Failure path → `consecutive_failures` increments, error stored.
- 3rd consecutive failure → `engine.unreachable` audit event emitted exactly once.
- Recovery after streak → `engine.recovered` event emitted with elapsed time; counter resets.

**Manual test plan:**
1. Stop tgCHR (or block port 22 from tgmanwehs).
2. Wait 3 min.
3. Audit log shows `engine.unreachable`.
4. UI router row shows red dot.
5. Restart tgCHR.
6. Within 1 min, audit log shows `engine.recovered`, dot turns green.

## Open questions

- [ ] Threshold: 3 consecutive failures (≈3 min) — appropriate? Could be 2 for a more sensitive alert.

---

## Kimi handoff

**Read before implementing:**
- `src/server/database/repositories/router/schema.ts` (full)
- `src/server/database/repositories/router/service.ts` (full)
- `src/server/scheduler/usagePoller.ts` (full)
- `src/server/scheduler/index.ts` (full)
- `src/server/database/repositories/audit/service.ts` — for emitting events.
- `src/app/pages/admin/routers/index.vue` (full)
- `src/i18n/locales/en.json` (lines around `routers.*`)

**Modify these files:** see `touches:`.

**Do NOT modify:**
- `VpnEngine` interface.
- `quotaEvaluator` / `periodResetter` (out of scope for this PRD).

**Acceptance tests:**
1. Unit suite green for the new helper.
2. Manual outage simulation produces the expected audit events and UI state changes.

**Self-test plan:**
```bash
cd src
pnpm vitest run server/database/repositories/router
# Manual outage test against tgCHR.
ssh tgCHR '/system/reboot' # or block port via firewall rule, then unblock.
```
