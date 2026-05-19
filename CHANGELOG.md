# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fork Maintenance

- Updated the fork-only `Fork Image (ghcr)` workflow to the current Node 24-compatible action majors used by upstream workflows, removing GitHub's Node.js 20 action deprecation warning.
- Hardened router credential encryption by explicitly requiring 128-bit AES-GCM auth tags during encryption and decryption.
- Removed tracked WireGuard runtime config from `data/wireguard/wg0.conf` and ignored generated WireGuard config files.
- Replaced concrete development compose init credentials with placeholders.
- Enforced router ACL scoping on router lists, interface lists, admin usage, router mutations, and client speed-limit/usage routes.
- Repaired fork unit tests for RouterOS API transport mocks and BoringTun host-path assumptions; the unit suite currently passes with 292 tests and 1 skipped test.

### Fork: Multi-Engine Control Plane

#### Phase 0 — Foundation (`b1071fc`)

Replaced the monolithic `WireGuard.ts` utility with a proper `VpnEngine` abstraction layer, enabling the application to manage VPN tunnels across different hardware and OS environments.

- **Engine Abstraction (`VpnEngine` interface):** Define a common contract (`bringUp`, `bringDown`, `createPeer`, `syncInterface`, `sampleUsage`, `applySpeedLimit`, etc.) implemented by each engine
- **Engine Registry:** `registry.ts` maps `EngineType` strings to concrete engine instances, resolved per-interface at runtime
- **Transport Layer:** Separate communication protocols from engine logic — `LocalShellTransport` (WireGuard/AmneziaWG/BoringTun), `SshTransport` (remote hosts), `RouterOsApiTransport` (MikroTik)
- **Multi-Admin RBAC:** Five roles (SUPERADMIN, ADMIN, OPERATOR, VIEWER, CLIENT) with a permission matrix (`permissions.ts`) enforced via `definePermissionEventHandler` wrapper. Automatic promotion of sole admin to SUPERADMIN
- **Auth Refactor:** Principal resolution middleware (`server/middleware/principal.ts`) supporting session cookies, HTTP Basic auth, and Bearer API tokens. Principal cached on `event.context` per-request
- **Database Expansion:** New tables for `audit_logs`, `api_tokens`, `routers`, `quotas`, `speed_limits`, `usage_samples`, `exit_nodes`, `route_policies`, `admin_router_acls`, `user_configs`, `wg_obfuscator_configs`
- **Repository Pattern:** Each DB entity has `schema.ts` (Drizzle table + relations), `types.ts` (TypeScript types + Zod validation), `service.ts` (prepared statements), aggregated via `DBService`
- **Audit Logging:** All state-changing actions logged with actor ID and timestamp
- **WireGuard Engine:** First `VpnEngine` implementation, extracting all logic from deleted `WireGuard.ts` into `engines/wireguard/`. Includes `configgen.ts` for `.conf` file generation
- **Admin User Management:** CRUD pages for users at `/admin/users`, role assignment, enable/disable

#### Phase 1 — User Features

- **PRD-20-01 — User Dashboard (`b9903ed` onward):** Dedicated self-service view at `/dashboard` for VPN clients. Read-only access to their own clients, usage statistics, and expiry dates. Layout at `app/layouts/dashboard.vue`, store at `app/stores/dashboard.ts`
- **PRD-20-02 — QR Key Login (`b9903ed`):** Passwordless authentication for the user dashboard. Users scan their WireGuard QR code or paste their config; the server verifies ownership of the private key via a Curve25519 ECDH + SHA-512 challenge-response (`server/utils/wgKeyAuth.ts`). Private keys never leave the client device. Components: `Dashboard/QrLogin.vue`, `Dashboard/PasteConfigLogin.vue`
- **PRD-20-03 — Bandwidth Quotas (`61564a4`):** Per-client data caps (daily, weekly, monthly). Scheduler background jobs poll usage every 60s, evaluate quotas, and auto-disable clients that exceed their limit. Period resetter handles automatic quota renewal. Components: `Clients/QuotaForm.vue`, `Clients/QuotaProgress.vue`, `Clients/QuotaProgressBar.vue`. Services: `server/services/quotaService.ts`, `server/scheduler/usagePoller.ts`, `server/scheduler/quotaEvaluator.ts`, `server/scheduler/periodResetter.ts`, `server/scheduler/usageRollup.ts`
- **PRD-20-04 — Speed Limits (`95a9a8f`):** Per-client rate limiting (KB/s up/down). Linux implementation uses `tc` with HTB qdiscs and IFB redirection for bi-directional shaping (requires `modprobe ifb`). Components: `Clients/SpeedLimitForm.vue`. Service: `server/services/speedLimitService.ts`. Engine integration: `engines/wireguard/speedlimit.ts`

#### Phase 2 — MikroTik Integration

- **PRD-10-01 — MikroTik Driver Engine (`f824ac2`):** Full `VpnEngine` implementation for remote MikroTik routers. Uses `RouterOsApiTransport` (steady-state management via native RouterOS API) and `SshTransport` (bootstrap/low-level operations). Router CRUD at `/admin/routers`. Router credentials encrypted at rest with AES-256-GCM (`server/utils/crypto.ts`). Implements peer management, config generation (`configgen.ts`), speed limits via RouterOS `queue tree` + `mangle` rules, and usage sampling
- **PRD-10-02 — Bootstrap Wizard (`fd51db4`):** Zero-touch provisioning of a "vanilla" MikroTik router. 4-step automated sequence via SSH: (1) create WireGuard interface, (2) assign IP addresses, (3) configure NAT/masquerade, (4) create API user. Component: `Routers/BootstrapWizard.vue`, logic: `engines/mikrotik/bootstrap.ts`
- **PRD-10-03 — wg-obfuscator Sidecar (`facfde5`):** Automatic deployment of `wg-obfuscator` containers on RouterOS for DPI evasion. Per-interface obfuscation configuration stored in `wg_obfuscator_configs` table. Component: `Interfaces/ObfuscationForm.vue`, logic: `engines/mikrotik/obfuscator.ts`. **Note: client config generation for obfuscation is not yet wired into the download routes**

#### Phase 3 — Multi-Engine Support

- **PRD-30-01 — AmneziaWG Engine (`d7b1338`):** Promoted from experimental flag to first-class runtime engine. Uses `awg`/`awg-quick` when native tools are available; transparently falls back to `amneziawg-go` userspace implementation (bundled in Docker image). Auto-generates obfuscation parameters (Jc, Jmin, Jmax, S1-S4, H1-H4, I1-I5) for client configs. Config generation at `engines/amneziawg/configgen.ts`. Docker fallback: if `awg` is missing on host, runs commands via transient Docker container
- **PRD-30-02 — BoringTun Engine (`7b4e711`):** Userspace WireGuard implementation via Cloudflare's `boringtun-cli` (Rust, built in Dockerfile). Process manager (`engines/boringtun/process.ts`) handles the long-running daemon lifecycle with UAPI socket communication. Workaround for BoringTun's single-peer-set UAPI bug: uses `wg setconf` for peer sync. Built from source in Docker multi-stage build
- **PRD-30-03 — Engine Selection UX (`5c72363`):** Admin interface for selecting VPN engine per interface. Shows capability hints (obfuscation support, speed limit method, live stats availability, multi-peer sync). Engine metadata API at `/api/admin/engines`. Components: `Interfaces/EngineSelector.vue`, `Interfaces/EngineCapabilityHints.vue`

#### Final Integration & Bug Fixes (`b8f2410`)

- **Config Generation Fix:** All client config download routes now use engine-aware config generation (was hardcoded to WireGuard). Affected routes: `/api/client/:id/configuration`, `/api/dashboard/clients/:id/configuration`, `/api/client/:id/qrcode.svg`, `/api/dashboard/clients/:id/qrcode.svg`, `/cnf/:oneTimeLink`. Removed hardcoded configgen from `wgHelper.ts`
- **Auth Hardening:** Fixed SSR auth middleware for dashboard routes, fixed principal resolution for per-user client ownership, fixed session handling for token-based auth. Dashboard users always get effective `CLIENT` role to prevent privilege escalation
- **Dashboard Fixes:** Fixed QR code route params (`[id]` → `[clientId]`), fixed usage graph delta computation, fixed dashboard logout, added missing i18n keys across all locales
- **SSH Passphrase Support:** `SshTransport` now supports encrypted, passphrase-protected SSH private keys for MikroTik management
- **Traffic Shaping Infrastructure:** Added `init-ifb.sh` for IFB kernel module setup (required for upload speed limiting). Bi-directional shaping requires Linux with `ifb` module; Docker-on-macOS/Windows only supports download shaping
- **Docker Updates:** Multi-stage build now includes `boringtun-cli` (Rust), `amneziawg-go` + `amneziawg-tools` (Go). Updated `Dockerfile.dev` for development workflow
- **Test Suite:** ~165 unit tests covering crypto, engine logic, API controllers, scheduler, services, middleware, and composables. E2E integration tests for WireGuard and MikroTik engines

#### Known Gaps

- **MikroTik engine is untested with live hardware** — unit tests and logic review pass, but no end-to-end verification against a real RouterOS device
- **MikroTik live hardware coverage** remains limited; RouterOS SSH/API unit tests pass, but only targeted UAT has been run against live devices
- **MikroTik obfuscation** `generateClientObfuscatorConfig()` is implemented in the engine but not wired into client config download routes
- **i18n** — many dashboard and engine capability keys are missing from non-English locales
- **Per-peer AmneziaWG parameter overrides** in the UI were punted; parameters are currently shared via interface-level defaults

### Upstream

- AWG: support for H1-H4 ranges (https://github.com/wg-easy/wg-easy/pull/2480)
- Client Firewall (https://github.com/wg-easy/wg-easy/pull/2418)
- CLI: Show QR code (https://github.com/wg-easy/wg-easy/pull/2518)
- Copy QR code to clipboard / save as png (https://github.com/wg-easy/wg-easy/pull/2521)

### Fixed

- Add trailing newline to Prometheus metrics output (https://github.com/wg-easy/wg-easy/pull/2573)
- Correctly use DEBUG env var (https://github.com/wg-easy/wg-easy/pull/2619)

### Changed (Upstream)

- Hooks are now Textareas (https://github.com/wg-easy/wg-easy/pull/2522)
- Update to Node Krypton (24) (https://github.com/wg-easy/wg-easy/pull/2536)
- Mobile UI (https://github.com/wg-easy/wg-easy/pull/2569)
- Prevent enabling client when expired (https://github.com/wg-easy/wg-easy/pull/2594)

## [15.2.2] - 2026-02-06

### Added

- Added Userspace WireGuard support (https://github.com/wg-easy/wg-easy/pull/2419)

### Fixed

- LangSelector overlapping with Buttons (https://github.com/wg-easy/wg-easy/pull/2434)
- AmnzeziaWG config parameters (https://github.com/wg-easy/wg-easy/pull/2440)
- OpenMetrics help string format (https://github.com/wg-easy/wg-easy/pull/2453)
- Reset 2fa when resetting admin password (https://github.com/wg-easy/wg-easy/pull/2461)

### Docs

- Replace Watchtower with maintained fork (https://github.com/wg-easy/wg-easy/pull/2456)

## [15.2.1] - 2026-01-14

### Fixed

- Icon in Searchbar (https://github.com/wg-easy/wg-easy/commit/458f66818a400f181e2c6326ede077c8793d71f2)
- Interface save not working (https://github.com/wg-easy/wg-easy/commit/48f3fbd715a889e2425702a8a46332f2752aef91)
- Error Messages in Setup (https://github.com/wg-easy/wg-easy/commit/32a055093a76342c40858d8dcf563b0700a8bd48)

## [15.2.0] - 2026-01-12

### Added

- AmneziaWG integration (https://github.com/wg-easy/wg-easy/pull/2102, https://github.com/wg-easy/wg-easy/pull/2226)
- Search / filter box (https://github.com/wg-easy/wg-easy/pull/2170)
- `INIT_ALLOWED_IPS` env var (https://github.com/wg-easy/wg-easy/pull/2164)
- Show client endpoint (https://github.com/wg-easy/wg-easy/pull/2058)
- Add option to view and copy config (https://github.com/wg-easy/wg-easy/pull/2289)

### Fixed

- Fix download as conf.txt (https://github.com/wg-easy/wg-easy/pull/2269)
- Clean filename for OTL download (https://github.com/wg-easy/wg-easy/pull/2253)
- Text color in admin menu in light mode (https://github.com/wg-easy/wg-easy/pull/2307)

### Changed

- Allow lower MTU (https://github.com/wg-easy/wg-easy/pull/2228)
- Use /32 and /128 for client Cidr (https://github.com/wg-easy/wg-easy/pull/2217)
- Return client id on create (https://github.com/wg-easy/wg-easy/pull/2190)
- Publish on Codeberg (https://github.com/wg-easy/wg-easy/pull/2160)
- Allow empty DNS (https://github.com/wg-easy/wg-easy/pull/2052, https://github.com/wg-easy/wg-easy/pull/2057)
- Don't include keys in API responses (https://github.com/wg-easy/wg-easy/pull/2015)
- Try all QR ecc levels (https://github.com/wg-easy/wg-easy/pull/2288)
- Update OneTimeLink expiry on reuse (https://github.com/wg-easy/wg-easy/pull/2370)
- Removed ARMv7 support (https://github.com/wg-easy/wg-easy/pull/2369)

### Docs

- Add AdGuard Home (https://github.com/wg-easy/wg-easy/pull/2175)
- Add Routed (No NAT) docs (https://github.com/wg-easy/wg-easy/pull/2181, https://github.com/wg-easy/wg-easy/pull/2380)
- Add AmneziaWG docs (https://github.com/wg-easy/wg-easy/pull/2108, https://github.com/wg-easy/wg-easy/pull/2292)

## [15.1.0] - 2025-07-01

### Added

- Added Ukrainian language (#1906)
- Add French language (#1924)
- docs for caddy example (#1939)
- add docs on how to add/update translation (be26db6)
- Add german translations (#1889)
- feat: Add Traditional Chinese (zh-HK) i18n Support (#1988)
- Add Chinese Simplified (#1990)
- Add option to disable ipv6 (#1951)

### Fixed

- Updated container launch commands (#1989)
- update screenshot (962bfa2)

### Changed

- Updated dependencies

## [15.0.0] - 2025-05-28

We're super excited to announce v15!
This update is an entire rewrite to make it even easier to set up your own VPN.

### Breaking Changes

As the whole setup has changed, we recommend to start from scratch. And import your existing configs.

### Major Changes

- Almost all Environment variables removed
- New and Improved UI
- API Basic Authentication
- Added Docs
- Incrementing Version -> Semantic Versioning
- CIDR Support
- IPv6 Support
- Changed API Structure
- SQLite Database
- Deprecated Dockerless Installations
- Added Docker Volume Mount (`/lib/modules`)
- Removed ARMv6 support
- Connections over HTTP require setting the `INSECURE` env var
- Changed license from CC BY-NC-SA 4.0 to AGPL-3.0-only
- Added 2FA using TOTP
- Improved mobile support
- CLI
- Replaced `nightly` with `edge`

## [14.0.0] - 2024-09-04

### Major changes

- `PASSWORD` has been replaced by `PASSWORD_HASH`
