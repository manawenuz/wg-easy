---
id: PRD-20-08
title: Add "lifetime" quota period — one-shot quota that never resets
status: backlog
phase: P2
priority: medium
severity: missing feature (operators want trial/prepaid accounts that don't auto-reset)
depends_on:
  - "[[prds/60-bugfixes/13-per-user-aggregate-quota]]"
touches:
  - src/server/database/migrations/0019_quota_period_lifetime.sql (new)
  - src/server/database/migrations/meta/_journal.json
  - src/server/database/repositories/quota/schema.ts
  - src/server/database/repositories/quota/types.ts
  - src/server/scheduler/periodResetter.ts
  - src/server/services/quotaService.ts
  - src/app/components/Clients/QuotaForm.vue
  - src/i18n/locales/en.json
---

# PRD-20-08 — Lifetime quota period

## Why

Operator-reported during 2026-05-18 UAT:

> period, should have 1 time as well, meaning that user will go through the quota limit, and never restarts.

Today's quota period is one of `daily`, `weekly`, `monthly`. All three auto-reset via the period resetter scheduler tick. The use case here is a **prepaid / trial** account: "you bought 500 MB. When you use it up, that's it. We don't refill at midnight."

Without this period, operators run prepaid plans by setting a giant quota and pretending. Or they manually clear the disabled flag on resets, which defeats the purpose.

## User stories

- As an **admin** selling a 1 GB trial pack, I create a user, set quota = 1 GB / **lifetime** / auto-disable. When the user runs out, every device disables and stays disabled until I top them up manually.
- As an **admin** giving someone a 500 MB demo, period = lifetime means I don't have to remember to disable them at midnight.
- As a **user**, when my lifetime quota is exhausted, the dashboard shows "Quota exhausted — contact your admin" instead of a misleading "Resets in 11h".

## Scope

### In

- New `period` value: `'lifetime'`. Allowed enum becomes `'daily' | 'weekly' | 'monthly' | 'lifetime'`.
- Schema migration `0019_quota_period_lifetime` that relaxes the `CHECK (period IN (…))` constraint on `user_quota` to include `lifetime`.
- `periodResetter` skips users whose quota.period === `'lifetime'`. No reset ever fires for them.
- `getPeriodDates(period)` for `lifetime` returns `{periodStart: createdAt, periodEnd: very_far_future}` (e.g., `'9999-12-31'` epoch). UI uses this as the "no reset" sentinel.
- `QuotaForm.vue`: add `Lifetime` to the period dropdown. When chosen, the auto-disable toggle is forced **on** (a lifetime quota with auto-disable off is nonsense — clarify with a tooltip).
- Dashboard / admin quota progress bar: when period is `lifetime`, replace "Resets in 11h" with "No reset". When `used_bytes >= limit_bytes`, replace with "Quota exhausted — admin must reset".
- New admin action: a one-click "Reset lifetime quota" button on the user's quota page that zeroes `used_bytes` and clears `disabled_by_quota_at` (essentially a manual period rollover). Audit log: `user.quota.manual_reset`.

### Out

- Top-up flows ("add 500 MB to existing balance"). Out — admin re-creates the quota row or uses the manual reset above.
- Per-day-limit on top of lifetime ("you have 1 GB lifetime AND 100 MB/day"). Out — that's billing software territory.
- Notifications when a lifetime quota crosses 90% / 100%. Separate PRD if anyone asks.

## Data model

```sql
-- 0019_quota_period_lifetime.sql
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE user_quota_new (
  user_id INTEGER PRIMARY KEY REFERENCES users_table(id) ON DELETE CASCADE,
  limit_bytes INTEGER NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('daily','weekly','monthly','lifetime')),
  used_bytes INTEGER NOT NULL DEFAULT 0,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  auto_disable INTEGER NOT NULL DEFAULT 1,
  disabled_by_quota_at INTEGER
);
--> statement-breakpoint
INSERT INTO user_quota_new SELECT * FROM user_quota;
--> statement-breakpoint
DROP TABLE user_quota;
--> statement-breakpoint
ALTER TABLE user_quota_new RENAME TO user_quota;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
```

SQLite doesn't support `ALTER TABLE ... ALTER COLUMN`, hence the create-copy-rename dance.

## API + service changes

```ts
// quotaService.ts
function getPeriodDates(period: 'daily'|'weekly'|'monthly'|'lifetime'): {start, end} {
  if (period === 'lifetime') {
    return { periodStart: Date.now(), periodEnd: 253402300799_000 }; // 9999-12-31
  }
  // ... existing logic
}

// periodResetter.ts
async function runPeriodResetter() {
  const rows = await Database.quotas.getAllExceptLifetime(); // new helper
  for (const q of rows) {
    if (Date.now() >= q.periodEnd) {
      await Database.quotas.resetPeriod(q.userId);
    }
  }
}
```

## UI

- Period dropdown gains a `Lifetime` option.
- Picking Lifetime disables (and force-checks) the auto-disable toggle, with a small "Lifetime quotas always auto-disable" hint.
- Progress component reads `period`; when `lifetime`, replaces "Resets in Xd" with "No reset" or, when exhausted, "Quota exhausted — admin must reset".
- New "Reset" button next to "Remove Quota" on the admin quota panel, visible only when `period === 'lifetime'`.

## Verification

1. Create user, set 100 MB / lifetime / auto-disable. Drive 110 MB. Family bucket trips; user disabled; audit log has `family.quota.exceeded` (or `user.quota.exceeded` for single-peer setups).
2. Wait 24 h (or fast-forward `period_end` in test): user **remains** disabled. No period reset fires.
3. Admin clicks "Reset". `used_bytes` zeroes, `disabled_by_quota_at` clears. User stays disabled (admin still must re-enable peers — matches existing semantics). Audit log: `user.quota.manual_reset`.
4. Re-enable peers. User can now drive 100 MB more.

## Open questions

- **Persistence of `used_bytes` across server restarts**: same as current model — survives. No change.
- **Reset semantics**: should "Reset" re-enable peers too? Default proposal: no, matches the rest of the quota system's "admin must re-enable" rule. If operators want one-click, a separate "Reset and re-enable" button can be added.
- **i18n word choice**: `Lifetime` vs. `One-time` vs. `No reset` — operators in the UAT said "1 time". The PRD picks `Lifetime` for clarity; bikeshed welcome.

## Implementer handoff

- Read `src/server/services/quotaService.ts` for `getPeriodDates` and how it's called.
- The Drizzle types in `quota/types.ts` use a TS union; widen it.
- `QuotaForm.vue`'s period dropdown is a simple `BaseSelect` — extend the options array.

**Estimate:** ~1 day including the migration + manual reset button.
