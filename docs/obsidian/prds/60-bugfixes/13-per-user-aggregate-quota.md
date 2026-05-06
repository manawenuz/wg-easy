---
id: PRD-60-13
title: Per-user aggregate quota — share one bucket across a user's VPN connections
status: draft
phase: P1
priority: high
severity: functional (quota does not enforce as advertised)
depends_on:
  - "[[prds/20-user-features/03-bandwidth-quotas]]"
  - "[[prds/20-user-features/05-user-groups]]"
  - "[[prds/60-bugfixes/12-subaccount-ui-affordance]]"
touches:
  - src/server/database/migrations/0016_per_user_quota.sql (new)
  - src/server/database/migrations/meta/_journal.json
  - src/server/database/repositories/quota/schema.ts
  - src/server/database/repositories/quota/service.ts
  - src/server/database/repositories/quota/types.ts
  - src/server/scheduler/usagePoller.ts
  - src/server/scheduler/quotaEvaluator.ts
  - src/server/scheduler/periodResetter.ts
  - src/server/services/quotaService.ts
  - src/server/api/admin/clients/[id]/quota.get.ts
  - src/server/api/admin/clients/[id]/quota.put.ts
  - src/server/api/admin/clients/[id]/quota.delete.ts
  - src/server/api/admin/users/[id]/quota.get.ts (new)
  - src/server/api/admin/users/[id]/quota.put.ts (new)
  - src/server/api/admin/users/[id]/quota.delete.ts (new)
  - src/server/api/client/index.get.ts
  - src/app/components/Clients/QuotaForm.vue
  - src/app/components/Clients/QuotaProgress.vue
  - src/app/components/Clients/QuotaProgressBar.vue
  - src/app/components/ClientCard/ClientCard.vue
  - src/app/components/Clients/List.vue
  - src/app/pages/clients/[id].vue
  - src/app/stores/clients.ts
  - src/i18n/locales/en.json
---

# PRD-60-13 — Per-user aggregate quota

> Status: `draft` · Phase: `P1` · Severity: functional bug (quota label promises a per-account cap; enforcement is per-peer)

## Why

PRD-60-12 introduced the "+ Add VPN connection" affordance: a single end-user can now own multiple WireGuard peers (one per device). PRD-20-03 (bandwidth quotas) was designed before this — its `quota` table is keyed by `client_id`, so each peer gets its own independent bucket.

Reproducer (live on 178.105.64.108 on 2026-05-06):

| Peer  | Owner | Group  | Used      |
|-------|-------|--------|-----------|
| Booo  | manwe | 1G     | 0 B       |
| booo1 | manwe | 1G     | 358.9 MB  |
| booo2 | manwe | 1G     | 714.8 MB  |
| **sum** |     |        | **~1.07 GB** |

Aggregate is over 1 GB but no client is individually over, so `quotaEvaluator` never trips and all three peers stay enabled. The admin UI also shows the "1G" badge on each peer, implying the limit applies to the *plan* rather than the device. Today's behaviour silently undercharges multi-device users by N×.

The fix is to track and enforce quota at the **owner-user** layer instead of the peer layer. One bucket per `users_table.id`; sum bytes from all of that user's peers; when the bucket is over limit, disable all peers belonging to that user.

## User stories

- As an **admin**, when I assign user `manwe` to the "1G" traffic group, *all* of manwe's VPN connections collectively cannot exceed 1 GB before the period resets.
- As an **admin**, when manwe's bucket trips, *every* device manwe owns is auto-disabled atomically; manwe cannot keep using a second device after the first hits the cap.
- As a **user**, the `/dashboard` quota progress bar shows my plan's combined usage across my devices, not per-device numbers that look fine while my plan is actually exhausted.
- As an **admin**, on `/admin/users/{id}` I can see and edit one quota row for the user (limit, period, auto-disable). The per-client `QuotaForm` is removed.

## Scope

### In

- Schema migration `0016_per_user_quota`:
  - New table `user_quota` keyed by `user_id` (PK, FK → `users_table.id`, `ON DELETE CASCADE`).
  - Columns: `limit_bytes`, `period`, `used_bytes`, `period_start`, `period_end`, `auto_disable`, `disabled_by_quota_at`.
  - Drop `quota` table after successful copy.
  - **Data migration**: for each existing `quota` row, look up `clients.userId`, write a `user_quota` row with the same limits/used/period. If multiple peers of one user have rows, take the **earliest** `period_start` and **sum** `used_bytes`; warn (do not fail) if their `limit_bytes`/`period` differ — copy the parent client's group's settings.
- Service rewrite `QuotaService` (renamed conceptually to `UserQuotaService`, file path may stay):
  - `getForUser(userId)` returns the row (or null).
  - `setForUser(userId, {limit, period, autoDisable})` upserts.
  - `addBytes(userId, bytes)` increments atomic.
  - `clearForUser(userId)` deletes (no enforcement).
  - `evaluateAll()` returns `{userId, overLimit: boolean, autoDisable: boolean}[]`.
  - `resetPeriodIfNeeded(userId, now)` rolls window if `period_end <= now`.
- `usagePoller.ts`: when receiving sample `{publicKey, rxBytes, txBytes}`, look up `client.userId`, call `quotaService.addBytes(userId, rxBytes+txBytes)`. Drop the per-client increment path.
- `quotaEvaluator.ts`: iterate `user_quota` rows. For each over-limit user with `auto_disable=1`, fetch all their clients (`clients.getForUser(userId)`), `toggle(false)` each one not already disabled, call `engine.disablePeer(iface, publicKey)` for each, write **one** audit event `user.quota.exceeded` with `{userId, usedBytes, limitBytes, disabledClientIds: [...]}`. On engine failure for any one peer, leave that one enabled so the next tick retries; mark the user-quota row only after at least one peer was successfully disabled (idempotent enough).
- `periodResetter.ts`: iterate `user_quota`; reset `used_bytes=0`, advance window, clear `disabled_by_quota_at`, **but do not auto-re-enable** clients (admin must re-enable, matching current per-client behaviour — see open question 1).
- API:
  - `GET /api/admin/users/{id}/quota`, `PUT`, `DELETE` — admin reads/writes the user's quota override.
  - The current `GET/PUT/DELETE /api/admin/clients/{id}/quota` endpoints stay as **read-only views** that return the *user's* quota (resolved via `client.userId`). PUT/DELETE on these become 410 Gone, returning a hint to use the user-level endpoint. (We keep them mounted because PRD-20-03 advertised them — removing in a major version.)
- Client API surface:
  - `GET /api/client` already includes `userId` on each client. Add a `quota` field to each row that returns the **owner-user's** quota (limit, used, period, periodEnd) — every device in a user-group will report the same numbers. This keeps the existing mobile/dashboard UI shape (`client.quota.*`) without a breaking change.
- UI:
  - `Clients/QuotaProgress.vue` keeps its current per-client interface but shows the user-level numbers (because the API resolves them). One bar per peer all reading the same — acceptable; we could collapse it later.
  - `pages/admin/users/[id].vue` (already exists) gets a new `QuotaForm` panel mirroring the old per-client form, calling the new user endpoints.
  - `pages/clients/[id].vue` removes its own `<ClientsQuotaForm>` and instead renders a read-only "Plan: 1G — 1.07 GB used / 1 GB (over limit)" line linking to `/admin/users/{userId}` for editing.
  - `Clients/List.vue` (already groups by user, PRD-60-12 follow-up) — show the aggregate quota bar **once per user-group**, not per-row.
- New i18n keys under `client.quota.*` and `admin.users.quota.*`:
  - `client.quota.viewOnly` ("Quota is set on the user account")
  - `client.quota.editOnUser` ("Edit on user")
  - `admin.users.quota.title`, `admin.users.quota.limit`, `admin.users.quota.period`, `admin.users.quota.autoDisable`, `admin.users.quota.usedOf`, `admin.users.quota.overLimit`, `admin.users.quota.resetsAt`.
- Tests:
  - `userQuotaService.test.ts`: unit tests for `addBytes`, `evaluateAll`, `resetPeriodIfNeeded`.
  - `quotaEvaluator.test.ts`: scenario where user has 3 peers and only crosses the limit when summed; assert all 3 get disabled.
  - `migration-0016.test.ts`: snapshot of an existing `quota` table → asserts merged row.

### Out

- Quota inheritance from `traffic_group` settings — for now an admin must explicitly set the user's quota row even if the user is in the "1G" group (matches today's per-client behaviour). Auto-derivation is PRD-60-14 (future).
- Real-time push to disable peers (currently scheduler tick-driven, ~60 s lag — acceptable, same as PRD-20-03).
- Per-device sub-limits ("phone gets 200 MB of the 1 GB"). Out of scope; can revisit if requested.
- Splitting upload vs download in the bucket — still a single `used_bytes`.
- Migration from the per-peer model on production *without downtime*. We accept a brief restart window during deploy.

## Data model changes

```sql
-- 0016_per_user_quota.sql

CREATE TABLE user_quota (
  user_id INTEGER PRIMARY KEY REFERENCES users_table(id) ON DELETE CASCADE,
  limit_bytes INTEGER NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('daily','weekly','monthly')),
  used_bytes INTEGER NOT NULL DEFAULT 0,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  auto_disable INTEGER NOT NULL DEFAULT 1,
  disabled_by_quota_at INTEGER
);

INSERT INTO user_quota (user_id, limit_bytes, period, used_bytes, period_start, period_end, auto_disable, disabled_by_quota_at)
SELECT
  c.user_id,
  MAX(q.limit_bytes)         AS limit_bytes,
  MIN(q.period)              AS period,
  SUM(q.used_bytes)          AS used_bytes,
  MIN(q.period_start)        AS period_start,
  MIN(q.period_end)          AS period_end,
  MAX(q.auto_disable)        AS auto_disable,
  MIN(q.disabled_by_quota_at) AS disabled_by_quota_at
FROM quota q
JOIN clients_table c ON c.id = q.client_id
WHERE c.user_id IS NOT NULL
GROUP BY c.user_id;

DROP TABLE quota;
```

`MIN(period)` is a placeholder — alphabetically that's `daily` ahead of `monthly`/`weekly`. The data migration will warn if rows for one user disagree on `period`; in practice (today's prod) every user has 0–1 quota rows so the ambiguity doesn't bite. If we ever need exact rules, add a manual reconciliation step before running.

Schema is then declared via Drizzle; remember to register `0016_per_user_quota` in `migrations/meta/_journal.json` (PRD-60-12 highlighted that "SQL file written but journal not updated" is a recurring foot-gun — do not skip).

## API changes

Removed (downgraded to 410):
- `PUT /api/admin/clients/{id}/quota`
- `DELETE /api/admin/clients/{id}/quota`

Repurposed (now read-through to user):
- `GET /api/admin/clients/{id}/quota` → returns the owner-user's quota.

Added:
- `GET /api/admin/users/{id}/quota` → `{limitBytes, period, usedBytes, periodStart, periodEnd, autoDisable, disabledByQuotaAt} | null`
- `PUT /api/admin/users/{id}/quota` body `{limitBytes:number, period:'daily'|'weekly'|'monthly', autoDisable?:boolean}`
- `DELETE /api/admin/users/{id}/quota`

`GET /api/client` response shape adds `quota` per row populated from the owner-user's bucket. Pre-existing per-client `quota` field is removed; UI consumers were already reading `client.quota.*` so the shape stays.

## UI changes

1. `pages/admin/users/[id].vue`: add a `Quota` panel (existing `<ClientsQuotaForm>` adapted to user endpoints).
2. `pages/clients/[id].vue`: replace `<ClientsQuotaForm>` with a read-only summary linking to the user page.
3. `components/Clients/List.vue`: render the quota progress **once per user group** (above the indented children), not per-row.
4. `components/ClientCard/ClientCard.vue`: hide `<ClientCardQuota>` when the parent group already shows it (i.e., when this card is `idx > 0` in the group), or always — TBD during implementation review.
5. New copy: see in-scope i18n list above.

## Verification

Manual UAT (post-deploy on test server):

1. Reset quota state on user `manwe` (DELETE then PUT 1 GB / monthly / autoDisable=true).
2. From three different devices, drive ~400 MB through `Booo`, `booo1`, `booo2` respectively.
3. Within 60 s of crossing 1 GB aggregate, verify:
   - All three peers show `Enabled = false` on `/admin/users`.
   - WireGuard tunnels drop on each device (no internet).
   - Audit log has one `user.quota.exceeded` event with `disabledClientIds: [9,10,11]`.
4. Re-enable any one peer manually → traffic for *that* peer resumes (no further auto-disable until reset).
5. Trigger period reset (force `period_end` to past) → bucket clears, `disabled_by_quota_at` clears, peers stay disabled (admin must re-enable).
6. Edge case: create a fourth client for manwe while over limit → it must come up *disabled* (`enabled=0`), not enabled. (Implementation note: `client/index.post.ts` should check the user's quota state on create.)

Automated:

```bash
cd src && pnpm test -- userQuotaService quotaEvaluator periodResetter migration-0016
```

## Migration plan

1. Backup the prod DB before deploy (`/etc/wireguard/wg-easy.db`).
2. Deploy the new image; on first start drizzle-migrate runs `0016`. Existing per-client quotas are folded into one row per user.
3. Spot-check `user_quota` matches expected values for 2–3 known users.
4. Run a full quota-reset cycle in the next reset window to confirm `periodResetter` works on the new shape.

Rollback: keep image of pre-deploy build (`manawenuz/wg-easy:edge-prev`); restore DB backup; redeploy. The migration is one-way (drops `quota`); rollback requires DB restore.

## Open questions

1. **On period reset, do we auto-re-enable peers that were `disabled_by_quota`?** Today's per-client behaviour does not — admin must re-enable. Carrying that forward keeps semantics consistent and is cheaper to reason about. Default: no auto-re-enable. Surface a banner on the user page suggesting re-enable.
2. **Where do default quotas come from?** Today an admin must call `PUT` after creating each client. Now the analogue is "after creating each user". A future PRD (60-14) can pre-populate `user_quota` from the user's `traffic_group` settings so a "1G" group automatically applies.
3. **Should we keep or drop the per-client `quota.*` fields on the GET response?** Drop is cleaner but breaks any external consumer that reads them. Decision: keep the keys but populate from user level (every device of one user reports identical numbers). Mark the per-client legacy paths with a deprecation notice in API docs.
4. **What happens during the brief window where `quotaEvaluator` has disabled some-but-not-all of a user's peers (engine errors)?** Already idempotent — next tick will retry the failed peers; the user-quota row's `disabled_by_quota_at` is set the moment we attempt enforcement, so re-tries don't double-toggle. Document this in the service header comment.

---

## Implementer handoff (Kimi)

**Read before implementing:**
- `src/server/database/repositories/quota/{schema,service,types}.ts`
- `src/server/scheduler/{usagePoller,quotaEvaluator,periodResetter}.ts`
- `src/server/scheduler/index.ts`
- `src/server/services/quotaService.ts`
- `src/server/api/admin/clients/[id]/quota.{get,put,delete}.ts`
- `src/server/api/client/index.get.ts` (and `service.ts` `getAllPublic`)
- `src/app/components/Clients/{QuotaForm,QuotaProgress,QuotaProgressBar}.vue`
- `src/app/pages/clients/[id].vue`
- `src/app/pages/admin/users/[id].vue`
- `src/server/database/migrations/meta/_journal.json` — register the new migration tag

**Modify these files:** see frontmatter `touches:` list — that's the authoritative inventory.

**Do NOT modify:**
- The `client_id`-keyed `usage_sample` rollup table (PRD-20-03 §usage). That's per-peer telemetry and is orthogonal to per-user enforcement.
- The `traffic_group` schema. Group → user link is just `users_table.default_traffic_group_id`, already there.
- Any non-EN locale.

**Acceptance:**
1. `pnpm typecheck` passes.
2. New tests pass; existing per-client quota tests are deleted (not skipped) — they encoded the old behaviour.
3. Manual UAT scenarios under "Verification" all pass.
4. Migration runs cleanly on a DB seeded from the pre-deploy snapshot of 178.105.64.108.

**Estimate:** ~half a day of focused work + UAT.
