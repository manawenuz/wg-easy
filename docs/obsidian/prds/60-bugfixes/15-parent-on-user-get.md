---
id: PRD-60-15
title: Surface parent user object on GET /api/admin/users/{id}
status: backlog
phase: P1
priority: low
severity: cosmetic
depends_on:
  - "[[prds/60-bugfixes/14-shared-quota-pool-subaccounts]]"
touches:
  - src/server/api/admin/users/[id]/index.get.ts
  - src/server/database/repositories/user/service.ts
  - src/app/pages/admin/users/[id].vue
  - src/i18n/locales/en.json
---

# PRD-60-15 — Surface parent user object on user GET

## Why

PRD-60-14 added a sub-account admin view that should read "Quota inherited from **{parent.name}**" with a link to `/admin/users/{parent.id}`. The implementer fell back to a generic "inherited from parent account" string because `GET /api/admin/users/{id}` only returns `parentUserId` (the FK), not the parent object.

This is cosmetic — the page still works — but the admin has to click around to find out *which* root account holds the quota when a sub-account is several names deep into the list.

## User stories

- As an **admin** viewing a sub-account, the inherited-quota line shows the parent's `name` and a link to the parent's admin page.
- As an **admin**, if the parent has been soft-deleted/disabled, the line still renders (uses whichever fields exist) and the link still routes there.

## Scope

### In

- `GET /api/admin/users/{id}` response gains a `parent: { id, name, username } | null` field. `null` when `parentUserId` is null.
- `UserService.getById` (or whatever the endpoint already calls) joins the parent row in one query — no N+1.
- Sub-account admin page uses the new field:
  - Copy becomes `admin.users.quota.inheritedFromNamed` ("Quota inherited from {name}")
  - "Open parent account" link points to `/admin/users/{parent.id}`.

### Out

- Exposing the *full* family tree on the GET response. If we ever need that, a dedicated `/family-tree` endpoint is better than nesting on the user GET.
- Backfilling the parent object in *list* endpoints. Only the detail endpoint needs it.
- Non-EN locale updates.

## API change

```diff
GET /api/admin/users/{id} response:
{
  "id": 42,
  "username": "manwe-guest",
  "name": "Manwe (guest)",
  "parentUserId": 7,
+ "parent": { "id": 7, "name": "Manwe", "username": "manwe" },
  ...
}
```

## Verification

- Unit: `userService.getById.test.ts` — assert `parent` is populated when `parentUserId` is set, null otherwise.
- Manual: open a sub-account admin page; assert the inherited-quota line shows the parent name and the link routes to the right page.

---

## Implementer handoff (Kimi)

**Read before implementing:**
- `src/server/api/admin/users/[id]/index.get.ts`
- `src/server/database/repositories/user/service.ts` (`getById` and friends)
- `src/app/pages/admin/users/[id].vue` (the inherited-quota section added by PRD-60-14)
- `src/i18n/locales/en.json` (the `admin.users.quota.*` namespace)

**Do NOT modify:** any list-endpoint payload, non-EN locales, the user schema.

**Acceptance:** typecheck passes; new unit test passes; manual check shows the parent name + working link.

**Estimate:** ~1–2 hours.
