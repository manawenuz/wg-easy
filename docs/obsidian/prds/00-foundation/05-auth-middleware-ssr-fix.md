---
id: PRD-00-05
title: Fix SSR auth middleware — resolvePrincipal not defined
status: approved
phase: P0
depends_on: [PRD-00-03]
touches:
  - src/app/middleware/auth.global.ts
  - src/server/middleware/principal.ts
  - src/server/utils/principal.ts
  - src/app/stores/auth.ts
---

# Fix SSR auth middleware — `resolvePrincipal not defined`

> Status: `approved` · Phase: `P0` · Depends on: [[03-auth-refactor]]

## Why

Every SSR-rendered page currently returns **HTTP 500 — "resolvePrincipal is not defined"**. The dev server boots, Vite/Nitro compile cleanly, but the first request to `/` (and every other page route) throws. The user cannot reach the login screen, cannot log in, cannot run the UAT audit that the rest of the project is gated on.

Root cause: `src/app/middleware/auth.global.ts:22` calls `resolvePrincipal(event)`. `resolvePrincipal` is defined in `src/server/utils/principal.ts` and is auto-imported by Nuxt only inside the `server/` directory tree. Files under `app/` (universal layer — runs on both client and SSR) never receive `server/utils/*` auto-imports, even when executing during SSR. The reference is therefore undefined at runtime, the SSR render aborts with a ReferenceError, and Nuxt returns the generic 500.

This was introduced in commit `b1071fc` (PRD-00-03 "auth-refactor"). It was not caught because no SSR smoke test exists in CI and the previous implementer reported "184 unit tests pass" without ever loading a page.

This PRD also covers the secondary observation discovered while debugging: a stale relative-import path in `src/server/api/admin/router/index.get.ts` (`'../../engines/metadata'` should be `'../../../engines/metadata'`). That one-character fix has already been applied locally but must be preserved in the final patch.

## User stories

- As a **developer running `docker compose -f docker-compose.dev.yml up`**, I can load `http://localhost:51821/` and see the login page (or be redirected to `/login`) instead of a 500 error.
- As an **admin auditor**, I can log in with the seeded credentials and reach `/admin/routers`, `/dashboard`, etc., with SSR working on the first request (no client-only hydration fallback).
- As a **server-side route handler**, I can read `event.context.principal` and trust it has been resolved exactly once per request, regardless of whether the request hit a page or an API endpoint.

## Scope

### In

- Move principal resolution into a **Nitro server middleware** (`src/server/middleware/principal.ts`) so it runs in the `server/` layer (full auto-imports available) once per request, and stashes the result on `event.context.principal`.
- Refactor `src/app/middleware/auth.global.ts` to **stop calling `resolvePrincipal` directly**. Instead, on SSR it reads `event.context.principal` via `useRequestEvent()`; on the client it falls through to the existing `authStore.getSession()` path.
- Restore the corrected import path in `src/server/api/admin/router/index.get.ts` (`'../../../engines/metadata'`).
- Add an SSR smoke test (Vitest + a real Nitro request handler, or a `curl`-style test in the integration harness) that asserts `GET /` returns a redirect to `/login` (HTTP 302) for an unauthenticated request — not a 500.
- Update `architecture.md` §Auth to document the Nitro-middleware-resolves-principal pattern.

### Out

- **No changes to `Principal` shape or `resolvePrincipal` logic.** Bearer/Basic/admin-session/user-session resolution stays exactly as it is in `src/server/utils/principal.ts`. This PRD is wiring, not policy.
- **No changes to `requirePermission` / `definePermissionEventHandler`** — they already use server-layer auto-imports correctly.
- **No client-side auth UX changes.** Login, logout, redirect-to-login behavior is unchanged from a user's perspective.
- **No new endpoints.** `/api/session`, `/api/me`, `/api/dashboard/me` already exist and stay as-is.

## Data model changes

None. This is a runtime-wiring fix.

## API changes

None. The new server middleware is internal — it runs before every request and populates `event.context.principal`, but it does not add or change any HTTP routes.

## UI changes

None visible. Page-load behavior is restored to what was specified in PRD-00-03.

## Driver / backend changes

### New file: `src/server/middleware/principal.ts`

A Nitro server middleware (Nuxt picks up everything under `server/middleware/` automatically and runs it on every request, before route handlers and before SSR page rendering). It must:

1. Call `resolvePrincipal(event)` (auto-imported from `server/utils/principal.ts`).
2. Assign the result to `event.context.principal` (the existing typed slot on `H3EventContext`, declared at `src/server/utils/principal.ts:115-119`).
3. Never throw — wrap in try/catch, log on failure, leave `event.context.principal` as `undefined` so downstream `requirePermission` returns 401 cleanly.
4. Return `void` so Nitro continues to the next handler.

### Modified: `src/app/middleware/auth.global.ts`

The current SSR branch (lines 20-37) calls `resolvePrincipal(event)` directly. Replace it with: read `event.context.principal` from the request event (already populated by the new server middleware). If present, populate `authStore.principal` and `authStore.userData` from it exactly as today. If absent, leave the store nulled. The client branch (line 40) is unchanged.

### Modified: `src/server/api/admin/router/index.get.ts`

Line 1: import path bugfix. `'../../engines/metadata'` → `'../../../engines/metadata'`. (Already applied in working tree; ensure the patch preserves it.)

### Unchanged

- `src/server/utils/principal.ts` — keep as-is. The `H3EventContext.principal` module augmentation at the bottom of the file is required by the new middleware and must not be removed.
- `src/app/stores/auth.ts` — `getSession()` continues to back the client-side branch.

## Migration & rollout

- No schema migration. No data migration. No feature flag.
- Order of operations on a single PR:
  1. Add `src/server/middleware/principal.ts`.
  2. Edit `src/app/middleware/auth.global.ts` to consume `event.context.principal`.
  3. Confirm `src/server/api/admin/router/index.get.ts` import path is correct.
  4. Add SSR smoke test.
  5. Verify locally per "Manual test plan" below.
- Backwards compatibility: server route handlers that already call `resolvePrincipal(event)` themselves (search the tree before assuming none do) will get the same result they got before — the function is idempotent and side-effect-free aside from `apiTokens.updateLastUsed`. To avoid double "last used" writes, prefer reading `event.context.principal` first when refactoring callers — but **not in this PRD**; that is a follow-up cleanup.

## Verification

### Unit tests

- `src/server/middleware/principal.test.ts` (new): mock `resolvePrincipal`, assert the middleware writes the result onto `event.context.principal` and swallows thrown errors without rejecting.

### Integration / SSR test

- New test (location: `src/test/ssr-auth.test.ts` or extend the existing harness) that boots the Nuxt app and asserts:
  1. `GET /` unauthenticated → **302 to `/login`** (not 500, not a body containing "resolvePrincipal").
  2. `GET /login` unauthenticated → **200** with a body that includes the login form.
  3. `GET /` with a valid admin session cookie → **200** with the dashboard markup.

### Manual test plan

1. From repo root: `docker compose -f docker-compose.dev.yml up --build -d`.
2. `until curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:51821/ | grep -qE '200|302'; do sleep 2; done` — should resolve within ~60s.
3. Open `http://localhost:51821/` in a browser. Expect redirect to `/login` (no JSON 500 page).
4. Log in with `testtest` / `Qweasdyxcv!2`. Expect to land on the admin home.
5. Hard-refresh `/admin/routers`. Expect a 200 with content rendered server-side (view source: dashboard markup present pre-hydration, not just an empty `<div id="__nuxt">`).
6. `docker logs wg-easy-fork-wg-easy-1 2>&1 | grep -i 'resolvePrincipal\|ReferenceError'` — must return zero matches.

## Open questions

- [ ] Are there any other `app/`-layer files (middleware, plugins, pages) that reference `server/utils/*` symbols and would fail under the same mechanism? Implementer should `grep -rn "from '~~/server/utils\|resolvePrincipal\|requirePermission\|getWGSession\|getWGUserSession" src/app` and report findings before closing the PRD. Any hits beyond `auth.global.ts` are out of scope here but must be filed as follow-up issues.

---

## Kimi handoff

> This block is the contract between the PRD and the implementer. Keep it in sync with `touches:` frontmatter.

**Read before implementing:**
- `[[architecture]]` — §Auth, §Request lifecycle
- `[[glossary]]` — entries for "Principal", "Session", "Server middleware"
- `[[03-auth-refactor]]` — the PRD that introduced the broken middleware; do not regress its acceptance tests
- Source files (with line ranges):
  - `src/app/middleware/auth.global.ts` (full file, 1–78)
  - `src/server/utils/principal.ts` (full file, 1–119; do NOT modify the function body)
  - `src/app/stores/auth.ts` (full file, 1–27)
  - `src/server/api/admin/router/index.get.ts` (line 1 only)
  - Nuxt 3 docs: server middleware (https://nuxt.com/docs/guide/directory-structure/server#server-middleware) and `useRequestEvent` (https://nuxt.com/docs/api/composables/use-request-event)

**Modify these files:**
- `src/app/middleware/auth.global.ts` — replace the SSR branch with a read from `event.context.principal`.
- `src/server/api/admin/router/index.get.ts` — confirm import path is `'../../../engines/metadata'`.
- New: `src/server/middleware/principal.ts` — Nitro middleware that calls `resolvePrincipal` and writes to `event.context.principal`.
- New: `src/server/middleware/principal.test.ts` — unit test for the middleware.
- New: `src/test/ssr-auth.test.ts` (or appropriate harness location) — SSR smoke test.
- `docs/obsidian/architecture.md` — one paragraph in §Auth describing the Nitro-middleware pattern (do not redo the whole section).

**Do NOT modify:**
- `src/server/utils/principal.ts` — the `Principal` type, `resolvePrincipal`, and the `H3EventContext` augmentation must stay byte-identical.
- `src/server/api/session.*.ts`, `src/server/api/me/**`, `src/server/api/dashboard/me*` — none of these need changes.
- Anything outside the file lists above without re-opening this PRD.

**Acceptance tests** (Kimi must demonstrate these pass):
1. `curl -sS -o /dev/null -w "%{http_code}" http://localhost:51821/` returns `302` for an unauthenticated request (currently `500`).
2. After logging in via the UI with `testtest` / `Qweasdyxcv!2`, `curl -sS -b cookies.txt -o /dev/null -w "%{http_code}" http://localhost:51821/admin/routers` returns `200`.
3. `docker logs wg-easy-fork-wg-easy-1 2>&1 | grep -ic 'resolvePrincipal is not defined'` returns `0`.
4. The full existing test suite (`pnpm test`) still passes — same count as before plus the new tests.
5. `grep -rn "resolvePrincipal" src/app` returns **zero** hits after the change.

**Self-test plan** (commands Kimi runs locally):
```bash
# 1. Build & boot
docker compose -f docker-compose.dev.yml up --build -d

# 2. Wait for Nitro to finish first-request compile
until curl -sS -o /dev/null -w "%{http_code}\n" --max-time 30 http://localhost:51821/ | grep -qE '^(200|302)$'; do sleep 3; done

# 3. Smoke
curl -sS -o /dev/null -w "unauth_root=%{http_code}\n" http://localhost:51821/
curl -sS -o /dev/null -w "login_page=%{http_code}\n" http://localhost:51821/login

# 4. Unit + integration tests
pnpm test src/server/middleware/principal.test.ts
pnpm test src/test/ssr-auth.test.ts
pnpm test  # full run, must still be green

# 5. Log scan — must produce no output
docker logs wg-easy-fork-wg-easy-1 2>&1 | grep -i 'resolvePrincipal is not defined' || echo "OK: no occurrences"
```
