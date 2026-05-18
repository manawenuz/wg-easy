---
id: PRD-60-16
title: Emit user.quota.merged_into_family audit event when sub-account attach drops a quota row
status: backlog
phase: P1
priority: low
severity: audit hygiene
depends_on:
  - "[[prds/60-bugfixes/14-shared-quota-pool-subaccounts]]"
  - "[[prds/60-bugfixes/13-per-user-aggregate-quota]]"
touches:
  - src/server/database/repositories/user/service.ts
  - src/server/database/repositories/auditLog/types.ts
  - src/server/database/repositories/user/service.test.ts
---

# PRD-60-16 — Audit event for quota merge on sub-account attach

## Why

PRD-60-14 made `UserService.updateParentUserId(id, parentId)` transactionally drop the user's `user_quota` row when attaching them as a sub-account — they merge into the family's bucket. Today this happens **silently**. If an admin later asks "why did manwe-guest lose their 5 GB quota?", the audit log has no answer.

This is pure forensic hygiene. Functionally everything still works; we just want a paper trail.

## User stories

- As an **admin** auditing past changes, when I attach `manwe-guest` (who had their own 5 GB quota) under `manwe`, the audit log records both the parent change *and* the dropped quota row's full state at the moment of merge.
- As an **admin** investigating an incident, I can answer "what was this sub-account's quota before they joined the family?" from the audit trail alone.

## Scope

### In

- New audit action constant: `user.quota.merged_into_family`.
- Inside the existing transaction in `UserService.updateParentUserId`:
  - **Before** deleting the `user_quota` row, fetch it (`SELECT * FROM user_quota WHERE user_id = ?`).
  - If a row exists, write an audit event in the same tx after the delete:
    ```ts
    await Database.auditLogs.create({
      action: 'user.quota.merged_into_family',
      target: {
        userId: id,
        mergedIntoRootId: await Database.users.getRootUserId(parentUserId),
        droppedRow: {
          limitBytes, period, usedBytes,
          periodStart, periodEnd, autoDisable,
          disabledByQuotaAt,
        },
      },
      result: 'ok',
    });
    ```
- Update the audit-log action type union to include the new constant.

### Out

- Reverse event (`user.quota.split_from_family`) when promoting sub → root. The promotion doesn't drop or create a quota row — root user simply has none until admin sets one. Nothing to log.
- Restoring the dropped quota row on detach. Out of scope; that's a separate "carry quotas across moves" PRD if anyone ever asks.
- Surfacing the event in the UI audit-log viewer (already shows arbitrary actions generically).

## Verification

- Unit test in `src/server/database/repositories/user/service.test.ts`:
  - Seed a user with a `user_quota` row.
  - Call `updateParentUserId(id, parentId)`.
  - Assert `user_quota` row is gone.
  - Assert audit log has one new `user.quota.merged_into_family` row with the dropped state in `target.droppedRow`.
- Edge case: user has no `user_quota` row → no audit event written (only logs the parent change, if that's already tracked).

---

## Implementer handoff (Kimi)

**Read before implementing:**
- `src/server/database/repositories/user/service.ts` — `updateParentUserId` (PRD-60-14 made it transactional).
- `src/server/database/repositories/auditLog/{service,schema,types}.ts` — existing action union + create signature.
- `src/server/database/repositories/quota/service.ts` — to confirm the row shape.

**Do NOT modify:** the `user_quota` schema; the audit-log table schema (only the TypeScript action union changes).

**Acceptance:** typecheck passes; new test passes; existing PRD-60-14 tests still pass unchanged.

**Estimate:** ~1 hour.
