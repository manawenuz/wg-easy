---
id: PRD-60-05
title: Per-user client ownership (multi-tenant dashboard)
status: approved
phase: P1
priority: high
severity: security-architectural
depends_on:
  - PRD-60-02
touches:
  - src/server/database/repositories/client/schema.ts
  - src/server/database/repositories/user/schema.ts
  - src/server/database/migrations/
  - src/server/api/admin/client/index.post.ts
  - src/server/api/admin/client/[id]/index.patch.ts
  - src/server/api/admin/users/index.get.ts
  - src/server/api/admin/users/index.post.ts
  - src/server/api/dashboard/clients/index.get.ts
  - src/server/api/dashboard/login/verify.post.ts
  - src/server/api/dashboard/me.get.ts
  - src/app/components/Clients/Create.vue
  - src/app/pages/admin/users/index.vue
---

# Per-user client ownership (multi-tenant dashboard)

> Status: `approved` · Phase: `P1` · Severity: security-architectural

## Why

Companion to **PRD-60-02**. PRD-60-02 patches the *symptom* (a dashboard session inheriting admin role) by binding the session to a single `clientId`. That's necessary but not sufficient for the long-term model: real end-users typically have **multiple devices** (phone + laptop = two configs), and a single end-user dashboard should aggregate "my configs" across devices. The current schema assumes the only "user" rows are admins; clients hang off whichever admin created them.

Concretely, on the production deployment at `178.105.64.108`:
- `dns-test` and `TTTT` are configs for two unrelated end-users, but both are owned by the `Administrator` user record.
- There is no `user`-row representing those end-users; they exist only as `client` rows.

We need a first-class **end-user** entity, distinct from admin/operator users, with a one-user-to-many-clients relationship. Auth already distinguishes principal kinds (admin/user/token), but the data model conflates "operator user" and "end-user" into the same `users_table`.

This PRD introduces that separation. It is the architectural fix that makes PRD-60-02's session-binding decision (one session = one client) generalize to (one session = one end-user, with multiple clients).

## User stories

- As an **admin**, when I create a new client config, I select an existing end-user or create a new one inline. The client is owned by that end-user, not by me.
- As an **end-user**, after logging in via QR/key on any of my devices, my dashboard lists **all** my devices (e.g. phone + laptop), each with its own config, status, and usage graph.
- As an **end-user**, I cannot see configs belonging to any other end-user, even one that shares my admin's namespace.
- As an **admin**, I can see in `/admin/users` who owns which client(s), disable an end-user (cascading-disable all their clients), or transfer a client to another end-user.
- As a **server operator**, an end-user has no admin password and no ability to authenticate to admin endpoints — they can only authenticate to the dashboard via the QR/key flow tied to one of their clients.

## Scope

### In

- Introduce a **role distinction** in `users_table`. Today the table has `role` (ADMIN / CLIENT). Make sure CLIENT-role rows are valid first-class users that own clients.
- Add `clients_table.user_id NOT NULL` foreign key (it already exists per PRD-60-02 reads — verify; if so, this is just enforcing semantics). Backfill existing client rows to point at a newly-created end-user (per-client, named after the client name, e.g., `dns-test-user`) rather than at the admin.
- Admin client creation flow:
  - Replace the "create client" form's name-only input with a two-field form: **end-user** (autocomplete from existing end-users + "Create new") and **client name** (the device label, e.g. "iPhone").
  - On the server, atomically create the user (if new) and client.
- Dashboard QR/key login: bind the session to the **user_id** of the client whose key signed the challenge, NOT to the client_id.
  - Replace `WGSession.clientId` (introduced in PRD-60-02) with `WGSession.dashboardUserId` for user-sessions.
- Dashboard endpoints scope by `session.dashboardUserId`:
  - `/api/dashboard/clients` returns all clients owned by that user.
  - `/api/dashboard/clients/:id/{configuration,qrcode,usage}` validate `client.user_id === session.dashboardUserId`.
- `/api/dashboard/me` returns user-level info: name, email, count of clients.
- Disabling an end-user disables all their clients (already true via existing user.enabled propagation? verify; if not, add cascade in the disable handler).
- Update `/admin/users` page to clearly list end-users with their client counts and admin users separately (or with role badges).

### Out

- Self-signup. End-users are still admin-provisioned in this PRD.
- End-user password / 2FA. Auth remains key-based via dashboard QR/key login.
- End-user-initiated client creation (e.g., "add a new device" from the dashboard). Captured as a follow-up.
- Per-end-user quotas (the existing per-client quota system suffices for now; user-level aggregate quotas are out).
- SSO mapping of end-users to external identities (covered by `[[prds/50-integrations/02-sso]]`).
- Cross-router federation of end-users (covered by `[[prds/40-multi-server/01-multi-router-federation]]`).

## Data model changes

The `users_table` already has a `role` column. Verify it has a `CLIENT` enum value distinct from `ADMIN`. Verify `clients_table.user_id` exists and is a non-null FK to `users_table.id`.

If the FK already exists (likely — auth code reads `clientRecord.user`), the only schema change is a constraint-tightening migration:

```sql
-- Migration up: backfill existing clients to per-client end-users
-- For each client where user_id points to an admin row,
-- create a new CLIENT-role user named "<client-name>-user" and reassign.
-- Pseudocode (real migration writes SQL):
--
-- INSERT INTO users_table (username, name, role, enabled, password)
--   SELECT 'auto-' || c.id, c.name, 'CLIENT', 1, ''
--   FROM clients_table c
--   JOIN users_table u ON c.user_id = u.id
--   WHERE u.role = 'ADMIN';
-- UPDATE clients_table SET user_id = (newly-created user id) WHERE ...;
```

End-user rows have `password = ''` (or a sentinel) and are never valid for password login — `resolveBasicAuth` must reject `role === 'CLIENT'` users explicitly.

## API changes

| Method | Path | Auth | Body | Returns |
| --- | --- | --- | --- | --- |
| POST | `/api/admin/client` | admin | `{ userId?: number, newUser?: { name, email? }, clientName, ... }` | created client + user |
| GET | `/api/admin/users?role=client` | admin | — | list of end-users with `{ id, name, email, clientCount, lastSeenAt }` |
| GET | `/api/dashboard/clients` | dashboard | — | array of all clients for `session.dashboardUserId` |
| GET | `/api/dashboard/clients/:id/configuration` | dashboard | — | 403 if `client.user_id !== session.dashboardUserId` |
| GET | `/api/dashboard/me` | dashboard | — | `{ user: { id, name, email }, clientsCount }` (real user, not client) |

## UI changes

- `src/app/components/Clients/Create.vue`: add user picker + "create new user" inline.
- `src/app/pages/admin/users/index.vue`: split tabs or filter — "Operators" (ADMIN role) vs "End-users" (CLIENT role). Show client count and last-seen per end-user.
- `src/app/pages/dashboard/index.vue`: now genuinely lists multiple devices (currently lists one due to PRD-60-02 binding). Add a "These are your devices" header.
- `src/app/layouts/dashboard.vue`: header shows the **end-user's** name (e.g. "Alice Liddell") rather than the client name.

## Driver / backend changes

- `src/server/api/dashboard/login/verify.post.ts`: write `{ userId: clientRecord.userId, dashboardUserId: clientRecord.userId }` to the session. (After this PRD lands, `clientId` from PRD-60-02 is no longer needed in the session.)
- `src/server/utils/principal.ts`: when resolving a user-session, the principal's `user` is the end-user, role CLIENT. The existing kind discrimination in PRD-60-02 still gates admin endpoints; this PRD just changes which user record gets bound.
- No engine code changes.

## Migration & rollout

Order of operations:

1. **Schema migrate**: ensure `users_table.role = CLIENT` is a valid value (probably already true). No table changes if FK already exists.
2. **Backfill**: split existing admin-owned clients into per-client end-users (see SQL pseudocode). On the test deployment, this turns `Administrator → [dns-test, TTTT]` into `dns-test-user → [dns-test]` and `TTTT-user → [TTTT]`.
3. **Code deploy**: switch session binding from `clientId` to `dashboardUserId`.
4. **Existing dashboard sessions invalidated** (acceptable on a test deployment — force re-login).
5. **Admin UI updated** to enforce end-user selection on client creation.

Backwards-compat: none required (test deployment, single operator).

Feature flag: optional `MULTI_USER_DASHBOARD=false` env var to disable the new flow if a regression is found late. Remove after one stable release.

## Verification

### Unit tests

- **NEW** `src/server/api/admin/client/index.post.test.ts`:
  - With `userId` of existing end-user, client is created under that user.
  - With `newUser`, both user and client are created in one transaction.
  - With `userId` of an admin role user, request is rejected (clients can only be owned by CLIENT-role users).
- **NEW** `src/server/api/dashboard/clients/index.get.test.ts`:
  - Returns all clients owned by `session.dashboardUserId`.
  - Returns empty array if user has no clients.
- Update `src/server/api/dashboard/login/verify.post.test.ts` for the new session shape.

### Integration tests

End-to-end:
1. Admin creates end-user "alice", then creates two clients ("alice-phone", "alice-laptop") under alice.
2. Admin creates end-user "bob", then one client ("bob-laptop") under bob.
3. Log in as alice via QR (using alice-phone's keypair). `/api/dashboard/clients` returns 2 entries. Both entries' `configuration` endpoint returns 200.
4. Try to fetch `bob-laptop`'s configuration via alice's session → 403.
5. `/api/dashboard/me` returns alice's user record (name, email).

### Manual test plan

1. Deploy. Run backfill migration on `178.105.64.108`. Verify `dns-test` and `TTTT` have distinct end-user owners.
2. As admin, create a third client under `dns-test`'s owner ("dns-test-laptop"). Verify it appears as a second device in dns-test's dashboard.
3. Log in as dns-test → see two devices.
4. Try to access TTTT's config URL while logged in as dns-test → 403.

## Open questions

- [ ] Naming: "end-user" vs "client-user" vs just "user". The codebase already uses "user" for both senses, which is the source of confusion. Pick a term and use it consistently in i18n and admin UI.
- [ ] Should an end-user have an email-verified flow for receiving their config (instead of admin downloading and forwarding)? Out of scope here; revisit after this lands.
- [ ] When backfilling, should we generate placeholder end-user names or require admin to rename them post-migration? Recommend placeholder + a banner in admin UI prompting cleanup.

---

## Kimi handoff

**Read before implementing:**
- `[[architecture]]` — auth section
- `[[decisions/0003-auth-model]]` — split admin/user/token rationale
- **`docs/obsidian/prds/60-bugfixes/02-dashboard-privilege-escalation.md`** — the prerequisite PRD; this PRD layers on top.
- `src/server/database/repositories/client/schema.ts` (full file)
- `src/server/database/repositories/user/schema.ts` (full file)
- `src/server/api/admin/client/index.post.ts` (full file)
- `src/server/api/dashboard/clients/index.get.ts` (full file)
- `src/server/api/dashboard/login/verify.post.ts` (full file)
- `src/server/utils/principal.ts` (full file)
- `src/server/utils/session.ts` (full file)
- `src/app/components/Clients/Create.vue` (full file)
- `src/app/pages/admin/users/index.vue` (full file)

**Modify these files:** see `touches:` frontmatter. Also add a new migration under `src/server/database/migrations/` and update `meta/_journal.json`.

**Do NOT modify:**
- Engine code.
- The QR/key challenge cryptography.
- API token endpoints.

**Acceptance tests** (Kimi must demonstrate these pass):
1. All unit/integration tests above pass.
2. The backfill migration is idempotent (running it twice is a no-op after the first run).
3. After deploy, the existing `dns-test` and `TTTT` clients are re-owned by distinct end-users, and an admin login still sees all clients in `/admin`.
4. Logging into the dashboard via QR for one client shows ALL clients of that owner-user.
5. Cross-user access via direct URL is 403.

**Self-test plan:**
```bash
cd src
pnpm test server/api/admin/client
pnpm test server/api/dashboard
pnpm exec drizzle-kit migrate
pnpm dev
# manual: walk through admin → create user/client flow, then dashboard login as that user
```
