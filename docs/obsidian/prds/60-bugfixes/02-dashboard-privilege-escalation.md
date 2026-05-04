---
id: PRD-60-02
title: Dashboard session must not inherit underlying user's admin role
status: approved
phase: P1
priority: critical
severity: security-critical
depends_on: []
touches:
  - src/server/utils/principal.ts
  - src/server/api/session.get.ts
  - src/app/middleware/auth.global.ts
  - src/app/stores/auth.ts
  - src/server/api/dashboard/me.get.ts
  - src/server/api/dashboard/clients/index.get.ts
  - src/server/api/dashboard/clients/[id]/configuration.get.ts
  - src/server/api/dashboard/clients/[id]/qrcode.svg.get.ts
  - src/server/api/dashboard/clients/[id]/usage.get.ts
  - src/shared/utils/permissions.ts
  - src/server/utils/permissions.ts
---

# Dashboard session must not inherit underlying user's admin role

> Status: `approved` · Phase: `P1` · **Severity: security-critical**

## Why

**This is a privilege-escalation bug on a live deployment.** When a user logs into the dashboard via QR/key (the WireGuard key challenge flow), they receive a `wg-user-session` cookie bound to the user record that *owns* the client config. In the production deployment at `178.105.64.108`, all clients were created by the admin and are therefore owned by the admin user. Result: any user holding any valid client keypair becomes a fully-privileged Administrator after dashboard login. They can:

- See every client config in the system (admin's UI shows all clients on `/dashboard`, because `dashboard/clients/index.get.ts` queries by `principal.user.id` which is the admin's id).
- Navigate to `/` and access the full admin panel (the global auth middleware at `src/app/middleware/auth.global.ts:73` checks `userData.role === CLIENT` to deny `/admin` access — but the user's role is ADMIN since the client config is owned by admin).
- Be displayed as "Administrator" in the dashboard header (the user's `name` field).

Two intertwined root causes:

1. **The dashboard "user" session is not actually a constrained role — it inherits the full user record, including the underlying user's role.** `Principal.kind` distinguishes 'admin' / 'user' / 'token' but no code path treats `kind: 'user'` as a privilege ceiling. Auth middleware at `src/app/middleware/auth.global.ts:25-32` exposes `principal.user.role` to the front-end as `userData.role`, which the route guards then trust.
2. **All clients are owned by a single admin user**, because the admin client-creation flow in this fork does not require selecting/creating a separate end-user owner. Even if (1) is fixed, two end-users sharing the same owner-user would still see each other's configs.

This PRD fixes (1) — the privilege ceiling — which is the security-critical part. Per-user client ownership (2) is captured separately as **PRD-60-05** (multi-tenant client ownership).

Reference: see screenshot in handoff conversation 2026-05-04. Header reads "Administrator", body lists clients `dns-test` and `TTTT` belonging to *different* end-users.

## User stories

- As a **dashboard user** authenticated via the QR/key flow, I can see only **my own** client configs and account info, regardless of which user record technically owns the underlying client.
- As a **dashboard user**, I cannot reach `/admin/*` routes or any admin API, even if the user record I'm bound to has `role = ADMIN`.
- As a **server operator**, I want a dashboard session to be a strictly less-privileged scope than an admin session, even when both reference the same user row.

## Scope

### In

- Introduce an **effective role** concept: when `principal.kind === 'user'`, the effective role for permission checks is `CLIENT`, regardless of `principal.user.role`.
- Update `src/server/api/session.get.ts` (and any dashboard "me" endpoint) to return `role: 'CLIENT'` to the front-end whenever the request was authenticated via the user-session cookie, not the admin cookie.
- Update `src/app/middleware/auth.global.ts` to use the principal kind from the server-rendered context to compute UI-side role gating, not the raw `user.role`.
- Update `requirePermission` (or whichever helper enforces server-side perms — see `src/server/utils/permissions.ts`) so that `principal.kind === 'user'` only ever resolves permissions in the `dashboard:self` scope. It MUST NOT resolve `admin:*` or `clients:*` permissions even if the underlying user has admin role.
- Update `/api/dashboard/clients` and per-client dashboard endpoints to scope by **client ownership** (see "API changes" below). Until PRD-60-05 introduces a separate `dashboard_user_id` column, this PRD scopes by `client.id == session.boundClientId` — i.e., the dashboard session is bound to the **specific client** whose keypair signed the login challenge, not to the owner-user.

### Out

- Schema migration for per-user client ownership (separate `dashboard_user` table or `client.ownerUserId`) — that is **PRD-60-05**.
- Changing the admin login flow.
- Changing the QR/key challenge cryptography (`src/server/utils/wgKeyAuth.ts`).
- Removing the `wg-user-session` cookie or merging it with the admin session.

## Data model changes

No schema changes in this PRD. The only persistent state needed is "which client did this user authenticate with?", and we store it in the **session cookie payload**, not the database.

Update the session shape in `src/server/utils/session.ts`:

```ts
export type WGSession = Partial<{
  userId: ID;        // existing — used by admin session
  clientId: ID;      // NEW — set only by dashboard user-session login
}>;
```

`verify.post.ts` writes `{ userId: user.id, clientId: clientRecord.id }` instead of `{ userId }` alone.

## API changes

| Method | Path | Auth | Body | Returns | Notes |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/session` | any | — | `{ id, role, username, name, email, totpVerified }` | When authenticated via `wg-user-session`, returns `role: 'CLIENT'` regardless of underlying user role. |
| GET | `/api/dashboard/me` | dashboard | — | `{ user: { id, name, email }, clientsCount }` | `user.id` is the **client id**, not the owner-user id. `clientsCount` is always 1 in this PRD (one session = one client). |
| GET | `/api/dashboard/clients` | dashboard | — | `[client]` (length 1) | Returns ONLY the client whose id matches `session.clientId`. |
| GET | `/api/dashboard/clients/:id/{configuration,qrcode.svg,usage}` | dashboard | — | as today | MUST 403 if `:id !== session.clientId`. |

## UI changes

- `src/app/middleware/auth.global.ts`:
  - Replace direct read of `principal.user.role` (lines 27-32) with effective role: `principal.kind === 'user' ? 'CLIENT' : principal.user.role`.
  - Make sure `/admin/*` redirect (line 73) uses the effective role.
  - The `/dashboard` flow still requires a session, but the session no longer leaks admin privileges.
- `src/app/stores/auth.ts`:
  - Document via comment that `userData.role` is the **effective** role, never the raw user-row role.
- `src/app/layouts/dashboard.vue`:
  - The `authStore.userData.name` displayed in the header should now be the **client name** (e.g. "dns-test"), not the owner-user's name. Either the server returns the client name in `userData.name` for user-sessions, or the layout reads `dashboardStore.me.user.name`. Pick one — recommend the former so existing layout code keeps working.

## Driver / backend changes

None — this is auth/permissions plumbing. No engine code touched.

## Migration & rollout

- **No DB migration**. Existing `wg-user-session` cookies in the wild will be missing `clientId`. Treat absent `clientId` as **invalid session** and force re-login. There is no expectation of forward compatibility — this is a security fix on a fresh test deployment.
- Roll out by:
  1. Add `clientId` to `WGSession` type.
  2. Update `verify.post.ts` to write it.
  3. Update server endpoints to read it (and 401 if missing).
  4. Update `/api/session` GET and global middleware to demote role for user-sessions.
- No feature flag. The behavior change is mandatory.

## Verification

### Unit tests

- **NEW** `src/server/utils/principal.test.ts` (extend if exists): assert that `requirePermission(event, 'admin:*')` rejects for `principal.kind === 'user'` even when `principal.user.role === ADMIN`.
- **NEW** `src/server/api/dashboard/clients/index.get.test.ts` (extend if exists): assert the endpoint returns ONLY `session.clientId`'s row and 403s if `session.clientId` is missing.
- **NEW** `src/server/api/dashboard/clients/[id]/configuration.get.test.ts`: assert 403 when path id ≠ session.clientId.
- Update `src/server/api/dashboard/login/verify.post.test.ts` to assert the session is written with `clientId`.

### Integration tests

End-to-end:
1. Seed two clients owned by the same admin user: `clientA`, `clientB`.
2. Generate a QR-key login signature for `clientA`.
3. Verify the resulting session sees only `clientA` on `GET /api/dashboard/clients` and 403s on `GET /api/dashboard/clients/<clientB.id>/configuration`.
4. Hit `GET /api/session` and assert `role === 'CLIENT'`.
5. Hit `GET /admin/...` (any admin route) — assert 403 / redirect.

### Manual test plan

1. Deploy fix to `178.105.64.108`.
2. Open a fresh browser, scan QR for `dns-test`, log in.
3. Header MUST read "dns-test", not "Administrator".
4. `/dashboard` MUST list **one** client only (`dns-test`).
5. Visiting `/` MUST redirect to `/dashboard?toast=no-permission` (or equivalent), NOT show the admin panel.
6. Repeat for `TTTT` — must see only TTTT.
7. Logout and re-login — session restored cleanly.

## Open questions

- [ ] Should the dashboard ever show **multiple** clients per user? (e.g., user has two devices.) That requires PRD-60-05's per-user ownership model. For now: one session = one client. Document this constraint in the layout.
- [ ] Naming: "effective role" vs "session role" vs "principal role". Pick a term consistently across `permissions.ts` and the auth store.

---

## Kimi handoff

**Read before implementing:**
- `[[architecture]]` — auth/principal section
- `[[decisions/0003-auth-model]]` — split admin/user/token rationale
- `src/server/utils/principal.ts` (full file)
- `src/server/utils/session.ts` (full file)
- `src/server/api/session.get.ts` (full file)
- `src/server/api/dashboard/login/verify.post.ts` (full file)
- `src/server/api/dashboard/clients/index.get.ts` (full file)
- `src/server/api/dashboard/me.get.ts` (full file)
- `src/app/middleware/auth.global.ts` (full file)
- `src/app/stores/auth.ts` (full file)
- `src/app/layouts/dashboard.vue` (full file)
- `src/server/utils/permissions.ts` (full file)
- `src/shared/utils/permissions.ts` (full file)

**Modify these files:** see `touches:` frontmatter.

**Do NOT modify:**
- DB schema files (`src/server/database/repositories/**/schema.ts`)
- Migration SQL
- Engine code
- The QR/key challenge crypto (`src/server/utils/wgKeyAuth.ts`)

**Acceptance tests** (Kimi must demonstrate these pass):
1. New unit tests for principal-kind-as-ceiling all pass.
2. After dashboard login, `GET /api/session` returns `role: 'CLIENT'` even when the underlying user has `role: 'ADMIN'`.
3. After dashboard login, `GET /api/dashboard/clients` returns exactly one record (the client whose key signed the challenge).
4. After dashboard login, requesting `/api/dashboard/clients/<other-id>/configuration` returns 403.
5. After dashboard login, the front-end never displays admin nav links and `/admin` redirects with the no-permission toast.

**Self-test plan:**
```bash
cd src
pnpm test server/utils/principal
pnpm test server/api/dashboard
pnpm test server/api/session
pnpm dev
# manual: log in via QR, verify header text and /admin gating
```
