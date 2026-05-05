---
id: PRD-60-07
title: Auto-disable expired clients
status: draft
phase: P1
priority: high
severity: security
depends_on:
  - "[[prds/00-foundation/04-data-model-migration]]"
touches:
  - src/server/scheduler/expirationEnforcer.ts (new)
  - src/server/scheduler/index.ts
  - src/server/database/repositories/client/service.ts
  - src/server/scheduler/expirationEnforcer.test.ts (new)
---

# PRD-60-07 — Auto-disable expired clients

> Status: `draft` · Phase: `P1` · Severity: security (medium-high)

## Why

`clients_table.expires_at` exists and the UI lets admins set it. The only enforcement today is `api/client/[clientId]/enable.post.ts:18-19`, which refuses to *re-enable* a client whose expiration has passed. **There is no scheduler that scans for expired-but-still-enabled clients and disables them on the router.** Result: a client created today with `expires_at = tomorrow` keeps working indefinitely as long as no admin clicks anything.

This is a security bug, not just a UX one: an offboarded contractor's WireGuard tunnel stays up past its expected end-date.

## User stories

- As an **admin**, when I set `expires_at` on a client, the tunnel stops working at that timestamp without further action from me.
- As an **admin**, I can audit when an expiration was enforced (audit log entry per disable).

## Scope

### In

- New scheduler tick `runExpirationEnforcer` running every 60s.
- Selects `enabled=1 AND expires_at IS NOT NULL AND expires_at <= now()`.
- For each, calls `Database.clients.toggle(id, false)` then `engine.disablePeer(iface, publicKey)`.
- Writes audit event `client.expired` with `{clientId, expiresAt, action: 'auto-disable'}`.
- Failure handling: same self-healing pattern as `quotaEvaluator` — on engine error, leave row enabled so next tick retries.

### Out

- *Time-quota* (e.g. "valid for 8 hours of session time"). Out: `expires_at` is a single absolute timestamp, not a duration budget. Feature work, not a bugfix.
- Email/notification on expiration. Out: no notification channel exists yet; folded into a future user-features PRD.
- Re-enable when an admin extends `expires_at`. The existing `enable.post.ts` flow already covers this — admin clicks "Enable", server checks `now() < expires_at`, succeeds. No new code.

## Data model changes

None. Uses existing `clients_table.expires_at`.

## API changes

None. Pure scheduler addition.

## UI changes

None. The client list already shows `expires_at` and `enabled`; the disable will show through to the UI on next refresh.

## Driver / backend changes

- `runExpirationEnforcer` calls existing `engine.disablePeer(iface, publicKey)` — no driver changes.
- New repository helper `Database.clients.findExpired(now: Date)` returning clients with `enabled=1 AND expires_at <= now`.

## Migration & rollout

- Pure code addition; no schema migration.
- On deploy, the first tick will sweep up any already-expired-but-enabled clients. Expected behavior. Document in changelog so admins aren't surprised.

## Verification

**Unit tests:**
- `expirationEnforcer.test.ts`:
  - Client with `expires_at < now` and `enabled=1` → `toggle(false)` and `disablePeer` called once; audit log entry created.
  - Client with `expires_at > now` → not touched.
  - Client with `expires_at = NULL` → not touched.
  - Engine throws → row stays enabled, audit log entry has `result: error`.

**Integration test** (live tgCHR):
- Add a client with `expires_at = now() + 90 seconds`. Wait 2 minutes. Assert client is `enabled=0` in DB and the peer is `disabled=yes` on `tgCHR`.

**Manual test plan:**
1. Create a client in UI with expiration set 2 min in the future.
2. Wait 2 min.
3. Refresh client list — client shows disabled.
4. SSH `tgCHR` → `/interface/wireguard/peers/print` — peer flagged disabled.
5. Audit log shows `client.expired` entry.

## Open questions

- [ ] Tick interval: 60s seems right (matches other ticks). Could be 30s if we care about precise expiration.

---

## Kimi handoff

**Read before implementing:**
- `src/server/scheduler/quotaEvaluator.ts` (full) — copy structure.
- `src/server/scheduler/index.ts` (full)
- `src/server/api/client/[clientId]/enable.post.ts` (full) — confirms expiration semantics.
- `src/server/database/repositories/client/service.ts` — find existing `findAll` / `toggle` to match patterns.
- `src/server/database/repositories/client/types.ts` — Client type.

**Modify these files:** see `touches:`.

**Do NOT modify:**
- `engine.disablePeer` or any engine code.
- UI files.
- The `enable.post.ts` handler.

**Acceptance tests:**
1. Unit test suite green.
2. Live: client with `expires_at = now()+90s` is auto-disabled on `tgCHR` within 2 min.

**Self-test plan:**
```bash
cd src
pnpm vitest run server/scheduler/expirationEnforcer
# Live: through the UI, set a client expiration 2 min in the future, wait, verify on tgCHR.
ssh tgCHR '/interface/wireguard/peers/print'
```
