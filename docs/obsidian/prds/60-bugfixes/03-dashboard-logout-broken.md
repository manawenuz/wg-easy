---
id: PRD-60-03
title: Dashboard logout does not clear `wg-user-session` cookie
status: approved
phase: P1
priority: high
severity: functional
depends_on: []
touches:
  - src/server/api/session.delete.ts
  - src/app/layouts/dashboard.vue
  - src/server/api/session.delete.test.ts
---

# Dashboard logout does not clear `wg-user-session` cookie

> Status: `approved` · Phase: `P1` · Severity: functional (related to security — a stuck session is a stale-auth risk)

## Why

Clicking "Logout" from the dashboard header has no effect: the session persists, and the user remains logged in after a refresh. Reproduced in production at `178.105.64.108:51821/dashboard`.

Root cause is a subtle bug in `src/server/api/session.delete.ts`:

```ts
// Try admin session first, then user session
let sessionId: string | undefined;
try {
  const session = await useWGSession(event);   // <-- creates a session if none exists
  if (session.id) {
    sessionId = session.id;                    // <-- fresh empty session has an id
    await session.clear();                     // <-- clears the empty admin session
  }
} catch { /* ignore */ }

if (!sessionId) {
  // user-session branch — never reached
  ...
}
```

`useWGSession` (which wraps h3's `useSession`) **creates** a new admin-session cookie if none is present, populates it with an id, and returns. The handler then sees `session.id` is set, clears the (empty) admin session, returns `{success: true}`, and **never enters the user-session branch**. The actual `wg-user-session` cookie is untouched.

The dashboard layout calls `DELETE /api/session` (`src/app/layouts/dashboard.vue:53`), so the user's logout always lands in this dead branch.

## User stories

- As a **dashboard user**, when I click Logout I am redirected to the login page and my session cookie is cleared on both client and server.
- As an **admin** also using the same browser, my admin session is independent of the dashboard user-session and remains untouched when a user-session is logged out (and vice-versa).

## Scope

### In

- Fix `session.delete.ts` so it clears whichever cookies actually exist on the request, never creates a new one. Use h3's `getSession` (read-only) or check `parseCookies(event)` for the cookie names before touching them.
- Clear **both** `wg-easy` (admin) and `wg-user-session` (user) cookies if both happen to be present, so that "Logout" is unambiguous.
- Update `src/app/layouts/dashboard.vue` if needed to await the response and only navigate after success (currently the navigate is wired via `revert`, which on `useSubmit` typically runs on **error**, not success — verify and fix).

### Out

- Combining the two session cookies into one.
- Adding CSRF protection to the logout endpoint (separate concern).
- Changing logout for the admin login page (`/login`).

## Data model changes

None.

## API changes

| Method | Path | Auth | Body | Returns |
| --- | --- | --- | --- | --- |
| DELETE | `/api/session` | any cookie present | — | `{ success: true, cleared: ['admin' \| 'user', ...] }` (200) or `{ success: false }` (401 if neither cookie was present) |

Behavior:
- If `wg-easy` cookie present: clear it.
- If `wg-user-session` cookie present: clear it.
- If neither: 401 "Not logged in".
- Never **create** a new session cookie as a side effect.

## UI changes

- `src/app/layouts/dashboard.vue` (lines 51-66):
  - Inspect `useSubmit` semantics. The current code passes `revert` as the navigation handler, but `revert` typically runs on failure for optimistic updates. The intended behavior is "navigate to `/dashboard/login` after successful logout". Refactor to:
    ```ts
    async function logout() {
      try {
        await $fetch('/api/session', { method: 'DELETE' });
      } finally {
        await navigateTo('/dashboard/login');
      }
    }
    ```
    (i.e., always navigate, regardless of server response, since a failed clear still means the cookies — if any survive — are useless without a redirect.)

## Driver / backend changes

None.

## Migration & rollout

- No migration. Stuck sessions in the wild will simply be cleared on the next click after deploy.

## Verification

### Unit tests

- **NEW** or extend `src/server/api/session.delete.test.ts`:
  1. With only `wg-easy` cookie: handler clears it, returns `{ cleared: ['admin'] }`.
  2. With only `wg-user-session` cookie: handler clears it, returns `{ cleared: ['user'] }`.
  3. With both cookies: handler clears both.
  4. With neither cookie: handler 401s.
  5. **Critical**: With no cookies, handler does NOT set a `Set-Cookie` header on the response.

### Integration tests

End-to-end:
1. Log in via dashboard QR/key flow → cookie `wg-user-session` is set.
2. `DELETE /api/session` → response sets `Set-Cookie: wg-user-session=; Max-Age=0` (or equivalent expiry-in-the-past).
3. Subsequent `GET /api/dashboard/me` returns 401.

### Manual test plan

1. Deploy fix to `178.105.64.108`.
2. Log in via QR. Reload `/dashboard` — still logged in.
3. Click Logout. Browser navigates to `/dashboard/login`.
4. Hit Back → `/dashboard` MUST redirect back to `/dashboard/login` (session cleared).
5. Open DevTools → Application → Cookies. The `wg-user-session` cookie MUST be gone.

## Open questions

- [ ] Should the admin session and dashboard user-session ever coexist in one browser? Currently they can — the cookies have different names. If the answer is "no" (e.g., security policy), `session.delete.ts` should also be the place where we enforce "one session per browser". Out of scope here.

---

## Kimi handoff

**Read before implementing:**
- `src/server/api/session.delete.ts` (full file)
- `src/server/utils/session.ts` (full file — note `useWGSession` vs `getWGSession` distinction)
- `src/server/api/dashboard/logout.post.ts` (already-correct user-session clearer; reference impl)
- `src/app/layouts/dashboard.vue` (lines 33-67)
- `src/app/composables/useSubmit.ts` (full file — to confirm `revert` semantics)

**Modify these files:** see `touches:` frontmatter.

**Do NOT modify:**
- The login flow (`verify.post.ts`, admin login).
- The session-cookie names or shape.

**Acceptance tests** (Kimi must demonstrate these pass):
1. Unit tests above all pass.
2. The handler never returns a response with a fresh `Set-Cookie` for either session name when no cookie was sent.
3. Manual: dashboard logout redirects to `/dashboard/login`, and the `wg-user-session` cookie is gone in DevTools.

**Self-test plan:**
```bash
cd src
pnpm test server/api/session.delete
pnpm dev
# Manual:
# 1. log in via /dashboard/login
# 2. document.cookie -> should show wg-user-session
# 3. click Logout
# 4. document.cookie -> should NOT show wg-user-session
```
