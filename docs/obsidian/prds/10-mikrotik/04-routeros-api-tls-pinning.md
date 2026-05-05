---
id: PRD-10-04
title: RouterOS API transport — TLS, certificate pinning, ROS 7.22+ compatibility
status: implemented (P1)
phase: P1
priority: high
severity: security + reliability
depends_on:
  - "[[prds/10-mikrotik/01-mikrotik-driver]]"
  - "[[decisions/0002-backend-abstraction]]"
touches:
  - src/server/transports/routeros-api.ts
  - src/server/transports/routeros-api.test.ts
  - src/server/transports/routeros-api-protocol.ts (new)
  - src/server/transports/routeros-api-protocol.test.ts (new)
  - src/server/transports/tls-pin.ts (new)
  - src/server/transports/tls-pin.test.ts (new)
  - src/server/database/repositories/router/schema.ts
  - src/server/database/repositories/router/types.ts
  - src/server/database/repositories/router/service.ts
  - src/server/database/migrations/000X_router_tls_pin.sql (new)
  - src/server/api/admin/router/[id]/test.post.ts
  - src/server/api/admin/router/[id]/index.patch.ts
  - src/server/api/admin/router/index.post.ts
  - src/server/engines/mikrotik/index.ts
  - src/app/pages/admin/routers/[id].vue
  - src/app/pages/admin/routers/new.vue
  - src/i18n/locales/en.json
  - src/package.json
  - src/test/mikrotik_api_tls_verify.ts (new)
---

# PRD-10-04 — RouterOS API transport: TLS + cert pinning + ROS 7.22+ fix

> Status: `implemented` · Phase: `P1` · Severity: security + reliability (high)
>
> [!CAUTION]
> **Implementation Status:** The software architecture, protocol implementation, TLS pinning logic, and UI integration are complete. Unit tests for the protocol and pinning are passing. However, **this version has NOT been tested on live MikroTik hardware** due to environment limitations. Integration testing via `src/test/mikrotik_api_tls_verify.ts` is required before production deployment.

## Why

Two problems with the current `routeros-api.ts` transport:

1. **Broken on RouterOS 7.22.** The `routeros-client@1.1.2` library on which it is built fails to interoperate with the RouterOS 7.22 API protocol. As a result, the deployed system has been forced to fall back to the SSH transport (`routeros-ssh.ts`), which works but is slower (per-command shell parse), wider-scoped (full shell privilege), and harder to authenticate (per-host key trust).
2. **No transport security worth the name.** The current API path uses plain TCP on port 8728 without TLS, OR API-SSL on 8729 with no certificate pinning — meaning the connection is vulnerable to a compromised CA or a router-impersonation attack on the management network. Operationally the wg-easy host is talking to a router with cleartext credentials and bulk peer config.

This PRD replaces the broken third-party library with an in-tree RouterOS API protocol implementation that:

- Talks the RouterOS API binary protocol directly over Node `tls.connect` (port 8729 default).
- Pins the router's leaf certificate by SHA-256 fingerprint stored per-router in the database.
- Falls back, by explicit configuration only, to plaintext API for environments where TLS is impossible (legacy routers, lab networks).
- Is verified against ROS 7.22 (current production) and ROS 7.x mainline.

The SSH transport remains as an additional pathway — used by [[prds/10-mikrotik/02-mikrotik-autoconfig]] for one-shot bootstrap and as a deliberate manual fallback when API is unreachable. After this PRD, normal operations use the API transport again.

## User stories

- As an **admin**, when I add a MikroTik router, I paste a fingerprint (or click "Trust on first use") and from that moment on, every connection from wg-easy to the router cryptographically verifies that exact certificate.
- As an **admin**, my deployment works against RouterOS 7.22 out of the box without falling through to SSH.
- As an **operator**, I can rotate the router's API certificate by clicking "Re-pin" in the UI; the new fingerprint is recorded and old connections are rejected.
- As an **auditor**, I see a `router.tls.pinFailure` audit event whenever the router presents a different cert than the pinned one (potential MITM).

## Scope

### In

- New `src/server/transports/routeros-api-protocol.ts`: minimal RouterOS API protocol implementation.
  - Length-prefix encoding (variable-length per RouterOS spec).
  - Sentence framing: words terminated by zero-length word.
  - Login flow for ROS 6.43+ (plain credentials over already-secure TLS — no MD5 challenge needed; the legacy challenge flow is *out*).
  - Reply tag handling (`!done`, `!re`, `!trap`, `!fatal`).
  - Verified against ROS 7.22, 7.16, 6.49 (latest 6.x for compat sanity).
- New `src/server/transports/tls-pin.ts`: cert-pin verification helper.
  - Wraps `tls.connect` with `checkServerIdentity` that compares SHA-256 of `peerCertificate.raw` against the pinned fingerprint.
  - Exposes `getServerFingerprint(host, port)` for the "Trust on first use" UI flow.
- Refactored `routeros-api.ts`: thin adapter implementing the existing transport interface (`exec`, `print`, `set`, `add`, `remove`, `isConnected`) on top of the new protocol module.
- Schema additions on `router` table: `tls_fingerprint_sha256` (text, nullable), `api_port` (int, default 8729), `tls_required` (bool, default true).
- Admin UI: "Trust on first use" button that connects, fetches the cert, displays the fingerprint, lets admin save it. Plus a manual paste field for paranoid setups.
- Engine connection pool keys API connections per `routerId`; on `tls.alert` or `pin mismatch`, audit-log and tear down the cached connection.
- `connectivity test` endpoint becomes the canonical way to fetch the cert fingerprint for first-time setup.

### Out

- ACME / Let's Encrypt cert provisioning on the router side. Out — RouterOS supports this but it's the operator's job; we just pin whatever's there.
- API user permission profiles (least-privilege RouterOS group). Open in [[prds/10-mikrotik/02-mikrotik-autoconfig]]. Out here.
- Rewriting the SSH transport. Stays as-is.
- Multi-cert rotation windows ("accept old fingerprint for 24h"). Out — admin re-pins manually.
- Removing the `routeros-client` package. *Out for this PRD*; remove it in a follow-up cleanup once the in-tree protocol has been live for 30 days without regression.

## Data model changes

```ts
// src/server/database/repositories/router/schema.ts (additions)
tls_fingerprint_sha256: text('tls_fingerprint_sha256'),
api_port: integer('api_port').notNull().default(8729),
tls_required: integer('tls_required', { mode: 'boolean' }).notNull().default(true),
```

```sql
-- migration up
ALTER TABLE router ADD COLUMN tls_fingerprint_sha256 TEXT;
ALTER TABLE router ADD COLUMN api_port INTEGER NOT NULL DEFAULT 8729;
ALTER TABLE router ADD COLUMN tls_required INTEGER NOT NULL DEFAULT 1;
```

Down: drop columns.

## API changes

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| GET | `/api/admin/router/[id]/fingerprint` | admin | – | `{ fingerprint: string, subject: {...}, validNotAfter: string }` |
| POST | `/api/admin/router/[id]/test` | admin | `{ tlsFingerprint?: string }` | `{ ok: boolean, fingerprint: string, message?: string }` (existing endpoint extended) |
| PATCH | `/api/admin/router/[id]` | admin | `{ tlsFingerprintSha256?, apiPort?, tlsRequired? }` (additions) | router |
| POST | `/api/admin/router` | admin | additions to body schema | router |

## UI changes

- `src/app/pages/admin/routers/new.vue`: new fields:
  - `API port` (default 8729).
  - `Require TLS` toggle (default ON, warning shown if turned off).
  - "Fetch fingerprint from router" button → calls `test` endpoint, displays result, "Save fingerprint" persists it.
- `src/app/pages/admin/routers/[id].vue`: existing router page gains "TLS" panel showing the pinned fingerprint, expiry, and a "Re-pin" button.
- i18n keys: `routers.tls.fingerprint`, `routers.tls.pin`, `routers.tls.repin`, `routers.tls.required`, `routers.tls.warningPlaintext`.

## Driver / backend changes

- `MikrotikEngine` connection pool (`#getApi()` in `src/server/engines/mikrotik/index.ts`) now reads `tls_required`, `api_port`, `tls_fingerprint_sha256` from the router record and threads them into `RouterOsApiTransport`.
- On pin mismatch: throw a typed error class `TlsPinError` so callers can distinguish from other I/O errors and the audit layer can log `router.tls.pinFailure`.

## Migration & rollout

- Schema migration is additive; existing rows get default `api_port=8729`, `tls_required=true`, `tls_fingerprint_sha256=NULL`.
- For existing routers with NULL fingerprint, the engine logs a one-time warning and falls back to plain SSH transport until an admin completes the trust-on-first-use flow.
- Once an admin sets a fingerprint, API transport is preferred for that router; SSH stays available as a manual fallback.
- After 30 days running stable on the new transport against ROS 7.22 production, open a follow-up to remove the `routeros-client` dependency entirely.

## Verification

**Unit tests** (`vitest`):
- `routeros-api-protocol.test.ts`:
  - Encode/decode length-prefix words (boundary cases at 0x80, 0x4000, 0x200000).
  - Sentence framing round-trip.
  - Login reply parsing for 6.43+ flow.
  - `!trap` and `!fatal` translate to typed errors.
- `tls-pin.test.ts`:
  - `getServerFingerprint` returns hex SHA-256 of a known DER cert.
  - `checkServerIdentity` rejects mismatched fingerprint, accepts matched.
- `routeros-api.test.ts` updated: mocks the protocol module instead of `routeros-client`.

**Integration tests** (live tgCHR):
- New `src/test/mikrotik_api_tls_verify.ts`:
  1. Connect to tgCHR on port 8729 with `tls_required=true` and `fingerprint=<known>`.
  2. Run `/system/identity/print` and assert response.
  3. Re-connect with deliberately wrong fingerprint → expect `TlsPinError`.
  4. Run full peer create/print/remove cycle.
- Re-run existing `mikrotik_engine_verify.ts` after switching its router record to API transport — must pass identically.

**Manual test plan:**
1. From a fresh DB, add tgCHR via the UI:
   - Click "Fetch fingerprint" → see a `SHA-256: xx:xx:…`.
   - Save router. Confirm engine uses API path (debug log `MikroTik` shows `tls.connect → 172.16.81.127:8729`).
2. Create/disable/delete a client through the UI; verify on tgCHR.
3. On the router, regenerate the API cert (`/certificate/print`, regen). Engine connection should fail with a TLS pin error within one tick. Audit log shows `router.tls.pinFailure`. Click "Re-pin" in UI; new fingerprint accepted; operations resume.
4. Set `tls_required=false` on a test row; confirm a banner shows in the UI; confirm engine falls back to plaintext (lab use only).

## Open questions

- [ ] Cert pinning *which* cert: leaf vs. SubjectPublicKeyInfo (SPKI). Recommend SPKI pinning so admin-side cert renewals (same key) don't require re-pinning. Decide before implementation.
- [ ] Default `api_port`: 8729 (TLS). Confirm that's the standard ROS 7.x default; `8728` is plain.
- [ ] How to handle routers with multiple certs (e.g. SAN with both IP + DNS) — store one fingerprint, fail closed if any other is presented.
- [ ] Do we want a "first session" out-of-band fingerprint export (QR code, copy-paste from `tgCHR /certificate/print` output) for stricter setups?

---

## Kimi handoff

**Read before implementing:**
- `[[architecture]]` — driver section, transport split.
- `[[prds/10-mikrotik/01-mikrotik-driver]]` — current state of API + SSH transports.
- `src/server/transports/routeros-api.ts` (full) — the file being replaced.
- `src/server/transports/routeros-api.test.ts` (full)
- `src/server/transports/routeros-ssh.ts` (full) — pattern reference for transport interface.
- `src/server/engines/mikrotik/index.ts` — connection pool around `#getApi()`.
- `src/server/database/repositories/router/schema.ts` (full)
- `src/server/database/repositories/router/service.ts` (full)
- RouterOS API protocol reference (link in code comment): https://help.mikrotik.com/docs/display/ROS/API
- Node TLS docs: `tls.connect` `checkServerIdentity`, `peerCertificate.raw`.

**Modify these files:** see `touches:`.

**Do NOT modify:**
- `routeros-ssh.ts` (parallel transport, stays as-is).
- `VpnEngine` interface.
- Any non-MikroTik engine.

**Acceptance tests** (Kimi must demonstrate):
1. Vitest suite green for protocol + pin modules.
2. `mikrotik_api_tls_verify.ts` passes against tgCHR on ROS 7.22 — including the deliberate-pin-mismatch case.
3. Full UI flow (add router → fetch fingerprint → save → create client → see peer on tgCHR) demonstrated end-to-end.

**Self-test plan:**
```bash
cd src
pnpm vitest run server/transports
ssh tgmanwehs 'docker run --rm -v ~/wg-easy/src:/app -v /home/manwe/.ssh/wzp:/root/.ssh/wzp:ro --network host -w /app -e CI=true -e DEBUG=MikroTik node:20-alpine sh -c "corepack enable pnpm && npx tsx test/mikrotik_api_tls_verify.ts"'
```
