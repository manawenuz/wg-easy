---
id: PRD-60-14
title: Shared quota pool across parent + sub-accounts (one bucket per family)
status: shipped
phase: P1
priority: high
severity: functional (sub-accounts bypass parent's quota cap)
depends_on:
  - "[[prds/60-bugfixes/13-per-user-aggregate-quota]]"
  - "[[prds/20-user-features/03-bandwidth-quotas]]"
touches:
  - src/server/database/repositories/user/service.ts
  - src/server/database/repositories/quota/service.ts
  - src/server/database/repositories/quota/types.ts
  - src/server/scheduler/usagePoller.ts
  - src/server/scheduler/quotaEvaluator.ts
  - src/server/scheduler/periodResetter.ts
  - src/server/services/quotaService.ts
  - src/server/api/admin/users/[id]/quota.get.ts
  - src/server/api/admin/users/[id]/quota.put.ts
  - src/server/api/admin/users/[id]/quota.delete.ts
  - src/server/api/admin/users/[id]/quota-breakdown.get.ts (new)
  - src/server/api/client/index.get.ts
  - src/app/components/Clients/QuotaForm.vue
  - src/app/components/Clients/QuotaProgress.vue
  - src/app/pages/admin/users/[id].vue
  - src/app/pages/clients/[id].vue
  - src/i18n/locales/en.json
  # infrastructure files (PRD-60-13 authoring lesson: list these up-front):
  - src/server/database/migrations/0017_drop_subaccount_quota_rows.sql (new)
  - src/server/database/migrations/meta/_journal.json
  - src/server/api/client/[clientId]/index.get.ts
  - src/server/api/client/index.post.ts
  # added during implementation (PRD-gap, retroactively documented):
  - src/server/database/repositories/client/service.ts
  - src/server/database/repositories/usageSample/service.ts
  - src/vitest.config.ts
---

# PRD-60-14 — Shared quota pool across parent + sub-accounts

> Status: `draft` · Phase: `P1` · Severity: functional (sub-accounts currently get their own buckets, bypassing the parent's cap)

## Why

PRD-60-13 moved quota enforcement from per-peer to per-user. That's correct for a single
account with multiple devices, but it does **not** account for sub-accounts (introduced in
commit `28cfb08`, schema `users_table.parent_user_id`).

Today, if admin `manwe` has a 1 GB quota and creates sub-account `manwe-guest`, the
sub-account gets its own (empty) quota slot and can consume an unlimited amount — the cap
on `manwe` is unrelated. This is the inverse of the expected behaviour: the parent shares
their plan with the sub-account, not gives them a new one.

Reproducer (designed; behaviour after PRD-60-13 ships):

| User           | Parent  | Quota row  | Used (this period) |
|----------------|---------|------------|--------------------|
| manwe          | —       | 1 GB       | 800 MB             |
| manwe-guest    | manwe   | (own row)  | 300 MB             |

Combined real usage: 1.1 GB. Neither row trips. Plan intent ("manwe gets 1 GB across
everything they own") is violated.

The fix: collapse the quota bucket key from `user_id` to **root_user_id** (the topmost
ancestor in the `parent_user_id` chain). One bucket per family; sub-accounts have no
quota row of their own; usage from every peer in the family aggregates into the root's
bucket; when it trips, every peer of every family member is disabled.

## User stories

- As an **admin**, I assign user `manwe` to the "1G" plan. Sub-accounts `manwe-guest`
  and `manwe-iot` automatically share that 1 GB bucket. There is no separate quota
  field on a sub-account.
- As an **admin**, when the family bucket trips, *all* peers belonging to manwe and
  every sub-account are disabled atomically.
- As an **admin**, on `/admin/users/{rootId}` I see a "Quota breakdown" panel that
  shows per-member usage: how much each sub-account contributed to the bucket this
  period. This is informational only — no per-member cap.
- As a **sub-account user**, my dashboard quota bar shows the *family* limit and the
  *family* used — same numbers the parent sees — so I can tell how much shared budget
  is left.
- As an **admin**, when I promote a sub-account to a root account (clear
  `parent_user_id`), it becomes its own bucket starting from 0 used.
- As an **admin**, when I attach an existing user as a sub-account (set
  `parent_user_id`), their previous quota row is dropped and they merge into the
  parent's bucket.

## Scope

### In

- **Bucket key change.** All quota service entry points that today take `userId` now
  resolve the root ancestor first via a small helper `userService.getRootUserId(userId)`
  and key the `user_quota` row by that. No schema change — the existing `user_quota`
  table from PRD-60-13 keeps its shape; we just *only ever write rows for root users*.
- **Migration `0017_drop_subaccount_quota_rows.sql`**: for every `user_quota` row whose
  user is a sub-account (`users_table.parent_user_id IS NOT NULL`), DELETE the row.
  No data is reassigned to the parent — the parent's existing row is authoritative;
  if the parent has no row yet the family simply has no quota until admin sets one.
  Idempotent (re-running deletes nothing on second pass).
- **`usagePoller.ts`**: when a sample comes in for a client, resolve
  `client → owner user → root user`, then `addBytes(rootUserId, …)`.
- **`quotaEvaluator.ts`**: for each over-limit root-user bucket, fetch *all clients in
  the family* (`clients` where `clients.userId IN (rootId ∪ descendants(rootId))`) and
  disable them all. Emit one audit event `family.quota.exceeded` with
  `{rootUserId, usedBytes, limitBytes, disabledClientIds: [...]}`.
- **`periodResetter.ts`**: unchanged in shape — still iterates `user_quota` rows;
  semantically those are now per-family.
- **User service** gains:
  - `getRootUserId(userId: ID): Promise<ID>` — walks `parent_user_id` until null,
    short-circuits if `userId` itself has no parent. Bounded depth (see open Q3).
  - `getFamilyMemberIds(rootUserId: ID): Promise<ID[]>` — root + all descendants
    (single recursive CTE).
  - `getFamilyClientIds(rootUserId: ID): Promise<ID[]>` — every `clients.id` where
    `clients.userId` is in the family.
- **API surface**:
  - `GET /api/admin/users/{id}/quota` — if `id` is a sub-account, returns the root's
    quota row (with a `inheritedFromUserId` field). PUT/DELETE on a sub-account return
    `409 Conflict` with a message pointing to the root.
  - **New** `GET /api/admin/users/{id}/quota-breakdown` — returns
    `{rootUserId, periodStart, periodEnd, limitBytes, members: [{userId, name, usedBytes, clientIds: [...]}]}`.
    Per-member `usedBytes` is computed by summing the family's `usage_sample` rollup
    rows partitioned by `clients.userId`. (Cheap: one indexed scan.)
  - `GET /api/client` — the `quota` field per client returns the **root family's**
    limit/used. Same numbers seen by parent and every sub-account peer.
- **UI**:
  - `pages/admin/users/[id].vue`:
    - On a root user: show the existing `QuotaForm` panel (unchanged) **plus** a new
      collapsible "Family breakdown" panel listing each member with their contribution
      to the current bucket.
    - On a sub-account: replace the `QuotaForm` with a read-only summary
      ("Quota is set on parent account [link to /admin/users/{rootId}]") and show
      the same family-breakdown panel.
  - `pages/clients/[id].vue`: read-only summary already added by PRD-60-13; copy
    updated to "Plan: 1G — shared with N family members".
  - `components/Clients/QuotaProgress.vue`: append a small subtitle when the owner
    user is part of a family of >1: "Shared across N accounts".

### Out

- **Per-sub-account sub-caps** (e.g., "guest may use up to 200 MB of the parent's 1 GB").
  Selected option B was "Pool with admin-visible breakdown" — no enforcement at sub
  level. If demand emerges, a follow-up PRD can layer optional per-member caps on top
  of the family bucket.
- **Multi-level families with independent buckets at intermediate nodes.** Trees of
  arbitrary depth are supported (PRD already has `parent_user_id` self-FK), but the
  bucket lives at the **root** only. A sub-account creating sub-sub-accounts still
  shares the root's pool.
- **Cross-family transfers** (giving a sub-account some "of its own" data). Out.
- **Real-time push to disable peers.** Still scheduler-tick driven, same as PRD-60-13.
- **Auto-re-enabling peers on period reset.** Same policy as PRD-60-13 (no
  auto-re-enable; admin must re-enable).

## Data model

No new tables. The `user_quota` table from PRD-60-13 is reused as-is. The change is a
**runtime invariant**:

> A `user_quota` row exists only for users where `parent_user_id IS NULL` (root users).

Enforced by:
1. The new migration `0017` that deletes any sub-account rows that may exist after
   PRD-60-13 lands.
2. A check at the service layer: `setForUser(userId, …)` calls `getRootUserId(userId)`
   first and writes to that key. So the public API surface refuses to ever create a
   sub-account quota row.
3. (Nice-to-have) A SQLite `CHECK` constraint via a trigger:
   `CREATE TRIGGER user_quota_root_only BEFORE INSERT ON user_quota WHEN
   EXISTS (SELECT 1 FROM users_table WHERE id = NEW.user_id AND parent_user_id IS NOT NULL)
   BEGIN SELECT RAISE(ABORT, 'user_quota rows allowed only on root users'); END;`
   Decide during impl whether to ship this — adds a safety net at low cost.

## API changes

| Method | Path                                       | Behaviour change                                                                          |
|--------|--------------------------------------------|-------------------------------------------------------------------------------------------|
| GET    | `/api/admin/users/{id}/quota`              | If sub-account, returns root's row with `inheritedFromUserId: <rootId>`.                  |
| PUT    | `/api/admin/users/{id}/quota`              | If sub-account, returns `409 Conflict` `{error: 'quota_inherited', rootUserId: …}`.       |
| DELETE | `/api/admin/users/{id}/quota`              | Same 409 behaviour on a sub-account.                                                      |
| GET    | `/api/admin/users/{id}/quota-breakdown`    | **New.** Returns family aggregate + per-member contribution.                              |
| GET    | `/api/client`                              | `quota.*` now reflects the family bucket for every member's clients.                      |

## Sub-account lifecycle hooks

The user-service mutations that change the family tree must reconcile quota state:

- **Promote sub → root** (`updateParentUserId(id, null)`): the user now has no quota
  row of its own. Admin must call PUT to grant one. Family-bucket usage stays with the
  former-parent root.
- **Attach existing user as sub** (`updateParentUserId(id, parentId)`): if the target
  user has its own `user_quota` row, DELETE it. Its historical `used_bytes` is lost
  (acceptable — small audit-log entry `user.quota.merged_into_family` captures the
  delta). Future traffic counts against the new root's bucket.
- **Delete root user** (cascade via FK): `parent_user_id` is `ON DELETE CASCADE`, so
  all descendants go with it; their clients and the `user_quota` row all vanish.
  No special handling.

## UI changes

1. `pages/admin/users/[id].vue`:
   - Top of page already shows username / role / parent link (from PRD-60-12).
   - If `user.parentUserId === null` → render `<QuotaForm>` for the family.
   - Else → render read-only "Quota inherited from {parent.name}" with a button
     "Open parent" linking to `/admin/users/{rootId}`.
   - Below either of the above: render `<QuotaBreakdown :rootUserId="rootId" />` if
     the family has >1 member. Component fetches `/quota-breakdown` and renders a
     table with rows `{name, usedBytes, percent, clientCount}` plus a footer "Total:
     usedBytes / limitBytes".
2. `components/Clients/QuotaProgress.vue`: add an optional `shared: boolean` prop;
   when true append a small subtitle "Shared across N accounts" under the bar.
3. New i18n keys (en.json only):
   - `admin.users.quota.inheritedFrom` ("Quota inherited from {name}")
   - `admin.users.quota.openParent` ("Open parent account")
   - `admin.users.quota.breakdown.title` ("Family usage breakdown")
   - `admin.users.quota.breakdown.member` ("Member")
   - `admin.users.quota.breakdown.contributed` ("Used this period")
   - `admin.users.quota.breakdown.clients` ("Connections")
   - `client.quota.sharedAcross` ("Shared across {count} accounts")

## Verification

### Unit tests

- `userService.getRootUserId.test.ts`:
  - Root user → returns its own id.
  - 1-level sub-account → returns parent id.
  - 3-level chain (root → A → B → C) → returns root id from C.
  - Cycle protection: if a cycle is somehow constructed (data corruption), depth
    cap at 10 throws a tagged error instead of looping.
- `quotaService.test.ts`:
  - `addBytes` on a sub-account routes to the root's bucket.
  - `setForUser` on a sub-account writes to the root's bucket (or refuses, per design).
  - `evaluateAll` reports the root user, returning the *family* total.

### Integration / scheduler tests

- Family of 3 (root + 2 subs), each peer pushes 400 MB. Root has 1 GB limit.
  Assert: after evaluator tick, all peers of all 3 users are disabled, one
  `family.quota.exceeded` audit event recorded with the union of client ids.
- Period reset clears the bucket, leaves all peers disabled, surfaces the same
  banner the parent sees today.

### Manual UAT (post-deploy on `178.105.64.108`)

1. Pick test root `manwe` (1 GB plan, monthly, autoDisable=on).
2. Create sub-accounts `manwe-guest` and `manwe-iot`. Verify their admin pages show
   "Quota inherited from manwe", no `<QuotaForm>`.
3. From three different devices (one per user), drive ~400 MB each.
4. Within 60 s of crossing 1 GB family aggregate, verify:
   - All peers of all three users show `Enabled = false`.
   - Quota-breakdown panel on `/admin/users/{manwe.id}` shows each member's
     contribution (~400 MB each).
   - Audit log: one `family.quota.exceeded` event listing every disabled client id.
5. Promote `manwe-guest` to root (`PUT /api/admin/users/{id}` with `parentUserId: null`).
   Verify their `/admin/users/{id}` page now shows an *empty* QuotaForm — they have
   no quota row of their own. Family-breakdown on the original root no longer lists
   them.
6. Edge case: try `PUT /api/admin/users/{subId}/quota` directly via curl. Expect 409.

## Migration plan

1. PRD-60-13 ships first (creates `user_quota` table).
2. This PRD's migration `0017` deletes any sub-account rows from `user_quota`.
3. Drizzle journal updated for `0017` (the journal-foot-gun from
   `orchestration-handoff.md` 2026-05-06 — do not skip).
4. Service-layer changes deploy atomically with the migration.

Rollback: the migration is a DELETE; rollback requires a DB restore or a manual
`INSERT INTO user_quota …` for any sub-accounts whose historical row mattered.
Practically: no production sub-accounts have non-empty quota rows yet, so rollback
is a no-op.

## Open questions

1. **Should family-bucket creation auto-fire when the first family member joins?**
   Today the admin must explicitly PUT a quota row. With families, the natural moment
   is when a root user is assigned a `default_traffic_group_id` that has plan
   defaults. Proposal: pre-populate from `traffic_group` at user-creation time, as a
   follow-up to PRD-60-14 (see PRD-60-15 backlog). Not in scope here.
2. **Quota-breakdown granularity.** Per-member usage requires summing
   `usage_sample` rows partitioned by `clients.userId` across the current quota
   window. Confirm during impl whether the existing `usage_sample` rollup retains
   enough history (period_start → now). If not, we accept "since rollup retention"
   as an approximation and add a tooltip.
3. **Cycle protection depth.** Cap `getRootUserId` traversal at 10 hops; emit a
   tagged error if the cap is hit so the data corruption surfaces in logs rather
   than looping forever. Sub-account trees deeper than 10 are not a realistic UX.
4. **Trigger vs. service-layer check.** Ship the service-layer check definitively;
   ship the SQLite trigger as a belt-and-braces guard. Decide at implementation
   review whether the trigger is worth the migration weight.

---

## Implementer handoff (Kimi)

**Read before implementing:**
- `src/server/database/repositories/user/{schema,service}.ts`
- `src/server/database/repositories/quota/{schema,service,types}.ts` (post-PRD-60-13)
- `src/server/scheduler/{usagePoller,quotaEvaluator,periodResetter}.ts`
- `src/server/services/quotaService.ts`
- `src/server/api/admin/users/[id]/quota.{get,put,delete}.ts`
- `src/server/api/client/index.get.ts`
- `src/app/pages/admin/users/[id].vue`
- `src/app/components/Clients/{QuotaForm,QuotaProgress}.vue`
- `src/server/database/migrations/meta/_journal.json` — register `0017`

**Modify these files:** see frontmatter `touches:` list — authoritative.

**Do NOT modify:**
- `user_quota` table schema (PRD-60-13 owns it). This PRD only changes which rows
  exist and which user_ids may key them.
- `traffic_group` schema or service. Plan inheritance is a separate PRD.
- Any non-EN locale.
- Per-peer `usage_sample` table or rollup logic.

**Acceptance:**
1. `pnpm typecheck` passes.
2. New unit + integration tests pass; PRD-60-13 tests still pass unchanged.
3. UAT scenarios under "Verification" all pass on the test server.
4. Migration `0017` runs cleanly against a DB seeded with sub-account quota rows
   (deliberately constructed in a fixture, since prod has none yet).

**Estimate:** ~1 day of focused work + UAT (smaller than PRD-60-13 because the
table and most service plumbing already exist).

---

## Resolution log (2026-05-18)

Shipped via Kimi. Migration `0017_drop_subaccount_quota_rows.sql` deletes any orphan sub-account rows from `user_quota`. All `quotaService` entry points resolve `rootUserId` first via `UserService.getRootUserId` (10-hop cycle cap). `quotaEvaluator` now fetches `getFamilyMemberIds(rootUserId)` → `clients.getForUsers(familyIds)` → disables every peer in the family in one tick; emits a single `family.quota.exceeded` audit event keyed by `rootUserId` with the full `disabledClientIds` list. `GET /api/admin/users/{id}/quota` returns `inheritedFromUserId` for sub-accounts; PUT/DELETE on a sub-account return `409 Conflict`. New `GET /api/admin/users/{id}/quota-breakdown` returns per-member usage by aggregating `usage_sample` rows (lightweight `usageSampleService.getForClients` added). `updateParentUserId` is now transactional: on attach-as-sub it drops the user's quota row in the same tx.

### Implementation deviations from the PRD (accepted)

- **Family traversal**: BFS over `parent_user_id` with bounded depth instead of a single recursive CTE. Functionally equivalent for realistic family sizes (≤10 members). Easier to typecheck and easier to add the cycle cap to.
- **Quota-breakdown query**: inlined JS aggregation in the API handler over a small `usage_sample` fetch. The PRD said "single indexed scan partitioned by `clients.userId`" — Kimi achieved the same effect with one fetch + JS group-by; performance is identical at family sizes we care about.
- **Sub-account admin page copy**: PRD called for "Quota inherited from {parent.name}" but `GET /api/admin/users/{id}` doesn't currently return the parent object. Kimi used a generic "inherited from parent account" string. Surfacing the parent name is a small enrichment task — left as backlog (see below).
- **`user.quota.merged_into_family` audit event**: PRD called for this when attaching an existing user as a sub-account whose quota row gets deleted. Kimi did not implement; the quota row is dropped silently inside the transaction. Accepted to ship — audit hygiene improvement tracked as backlog (see below).

### PRD-gap files added retroactively to `touches:`

Same authoring pattern as PRD-60-13:
- `src/server/database/repositories/client/service.ts` — new `getForUsers(userIds: ID[])` for family-wide client fetch.
- `src/server/database/repositories/usageSample/service.ts` — new `getForClients(clientIds: ID[])` for breakdown aggregation.
- `src/vitest.config.ts` — `server/database/repositories/**/*.test.ts` added to the include glob so new user-service tests are picked up.

**Authoring lesson (extends PRD-60-13's list):** any PRD that adds a list-style API or scheduler iterator must list the repository services it will read from in `touches:`, including any new multi-id `getForUsers` / `getForClients` helpers.

### Backlog spun off

- **PRD-60-15 candidate** — surface parent user object on `GET /api/admin/users/{id}` so the sub-account admin page can show "inherited from {parent.name}". Tiny, observability-only.
- **PRD-60-16 candidate** — emit `user.quota.merged_into_family` audit event in `UserService.updateParentUserId` transaction when an existing quota row is dropped. Adds a small JSON snapshot of the deleted row to the audit log for forensic continuity.
- Pre-existing typecheck errors (`routeros-ssh.ts`, `ssr-auth.test.ts`, test fixtures) and pre-existing test failures (`boringtun/*`, `routeros-api.test.ts`) are unrelated to this PRD.
