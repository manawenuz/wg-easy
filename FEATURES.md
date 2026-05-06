# wg-easy Fork - Feature Inventory

This document tracks all features added to this fork since diverging from the original wg-easy project.

**Last Updated**: 2026-05-06

---

## Overview

This fork transforms wg-easy from a single-host WireGuard manager into a **multi-engine, multi-router VPN control plane** with user self-service, traffic management, and enterprise features.

**Key Differentiators**:
- Pluggable VPN engines (WireGuard, AmneziaWG, BoringTun, MikroTik)
- Multi-transport architecture (local shell, SSH, RouterOS API)
- User dashboard with passwordless QR login
- Traffic management (quotas, speed limits, traffic groups)
- Multi-admin RBAC with audit logging
- MikroTik integration with zero-touch provisioning
- DPI evasion via wg-obfuscator

---

## PHASE 0 — Foundation (✅ Shipped)

Core architectural refactoring enabling all later features.

### VpnEngine Driver Interface
**Status**: ✅ Shipped | **Commit**: `b1071fc`

Abstraction layer replacing monolithic `WireGuard.ts`. Enables pluggable engines with standardized interface:
- `bringUp()` / `bringDown()` - Interface lifecycle
- `syncInterface()` - Reconcile desired state
- `createPeer()` / `deletePeer()` - Peer management
- `sampleUsage()` - Traffic statistics
- `applySpeedLimit()` - Rate limiting
- `generateClientConfig()` - Engine-specific config generation

**Implementations**: WireGuard (wg-quick), AmneziaWG (awg-quick), BoringTun (userspace), MikroTik (RouterOS)

### Transport Layer
**Status**: ✅ Shipped | **Commit**: `b1071fc`

Separated communication protocols for multi-host management:
- **LocalShellTransport**: Direct command execution on local host
- **SshTransport**: Remote execution via SSH (supports passphrase-protected keys)
- **RouterOsApiTransport**: MikroTik RouterOS API client with TLS

### Multi-Admin RBAC
**Status**: ✅ Shipped | **Commit**: `b1071fc`

Five-tier role system with granular permissions:
- **SUPERADMIN**: Full system access (auto-promoted if sole admin)
- **ADMIN**: Manage users, clients, routers
- **OPERATOR**: Manage clients only
- **VIEWER**: Read-only access
- **CLIENT**: Dashboard access to own clients

**Enforcement**: `definePermissionEventHandler` wrapper on all API routes  
**Features**: Per-router ACLs (planned), automatic sole-admin promotion

### Auth Refactor
**Status**: ✅ Shipped | **Commit**: `b1071fc`

Principal resolution middleware supporting multiple auth methods:
- Session cookies (admin panel)
- HTTP Basic auth (legacy API)
- Bearer API tokens (programmatic access)
- QR key login (dashboard)

**Architecture**: Per-request caching on `event.context`, split admin/user auth flows

### Database Expansion
**Status**: ✅ Shipped | **Commit**: `b1071fc`

New tables for advanced features:
- `audit_logs` - Compliance and debugging
- `api_tokens` - Programmatic access
- `routers` - Multi-router management
- `quotas` - Bandwidth caps
- `speed_limits` - Rate limiting
- `usage_samples` - Traffic history
- `exit_nodes` - Multi-path routing (planned)
- `route_policies` - Policy-based routing (planned)
- `admin_router_acls` - Per-admin router scoping (planned)
- `user_configs` - User preferences
- `wg_obfuscator_configs` - DPI evasion settings
- `traffic_groups` - Reusable traffic templates
- `users_table.parent_user_id` - Sub-account hierarchy

**Pattern**: Repository pattern with Drizzle ORM schemas

### Audit Logging
**Status**: ✅ Shipped | **Commit**: `b1071fc`

All state-changing actions logged with:
- Actor ID (user/admin)
- Action type (create, update, delete, enable, disable)
- Resource type (client, user, router, etc.)
- Timestamp
- Metadata (IP, user agent, changes)

**Use Cases**: Compliance, debugging, security investigations

---

## PHASE 1 — Flagship Features (✅ Shipped)

User-visible features differentiating the fork.

### User Dashboard
**Status**: ✅ Shipped | **Commit**: `b9903ed`

Self-service portal at `/dashboard` for VPN clients:
- View own clients (read-only)
- Download configs and QR codes
- Monitor usage statistics
- Check expiry dates
- Passwordless login via QR code

**Components**: `Dashboard.vue`, `DashboardStore`, `DashboardClientCard.vue`  
**Routes**: `/dashboard`, `/dashboard/login`, `/dashboard/clients/:id`

### QR Key Login
**Status**: ✅ Shipped | **Commit**: `b9903ed`

Passwordless authentication via WireGuard config:
- Scan QR code or paste config text
- Curve25519 ECDH + SHA-512 challenge-response
- Private keys never leave client device
- Session-based auth after verification

**Components**: `QrLogin.vue`, `PasteConfigLogin.vue`  
**Security**: Zero-knowledge proof, no password storage

### Bandwidth Quotas
**Status**: ✅ Shipped | **Commit**: `61564a4`

Per-client data caps with automatic enforcement:
- Daily, weekly, or monthly periods
- Auto-disable on quota exceed
- Auto-reset at period end
- Usage tracking with 60s polling interval

**Components**: `QuotaForm.vue`, `QuotaProgress.vue`  
**Services**: `quotaService.ts`, `usagePoller.ts`, `quotaEvaluator.ts`, `periodResetter.ts`  
**Scheduler**: Background workers for polling and enforcement

### Speed Limits
**Status**: ✅ Shipped | **Commit**: `95a9a8f`

Per-client rate limiting (upload/download):
- Linux: `tc` with HTB qdiscs + IFB redirection
- Bi-directional shaping (requires `ifb` kernel module)
- Per-peer enforcement via `tc` filters

**Components**: `SpeedLimitForm.vue`  
**Service**: `speedLimitService.ts`  
**Infrastructure**: `init-ifb.sh` for IFB setup

### Traffic Groups
**Status**: ✅ Shipped | **Commit**: `0015` migration

Reusable templates for speed limits and quotas:
- 12-color palette with dark/light mode support
- Auto-generated colors (cycles after 12 groups)
- Set default group for new users
- Group settings override per-client settings
- Auto-reassign clients on group deletion

**Components**: `TrafficGroupDialog.vue`, `TrafficGroupBadge.vue`  
**Pages**: `/admin/traffic-groups`  
**API**: `/api/admin/traffic-groups/*`

### Sub-accounts
**Status**: ✅ Shipped | **Commit**: `0015` migration

Parent-child user relationships:
- View-only sub-accounts
- Only parent can create clients for sub-accounts
- Hierarchical display in user list
- CASCADE delete when parent deleted
- One-level nesting only (no deep hierarchy)

**Components**: `SubAccountDialog.vue`  
**API**: `/api/admin/users/[id]/sub-accounts`  
**Validation**: Sub-accounts cannot create clients (403 error)

### MikroTik Integration
**Status**: ✅ Shipped | **Commit**: `f824ac2`

Full `VpnEngine` implementation for remote MikroTik routers:
- RouterOS API (steady-state) + SSH (bootstrap)
- Router CRUD at `/admin/routers`
- Credentials encrypted with AES-256-GCM
- Peer management via RouterOS API
- Speed limits via queue tree
- Usage sampling from interface stats

**Components**: `RouterForm.vue`, `RouterList.vue`  
**Services**: `MikroTikEngine.ts`, `RouterOsApiTransport.ts`

### MikroTik Bootstrap Wizard
**Status**: ✅ Shipped | **Commit**: `fd51db4`

Zero-touch provisioning of vanilla MikroTik:
1. Create WireGuard interface
2. Assign IP addresses
3. Configure NAT/masquerade
4. Create API user with permissions

**Component**: `BootstrapWizard.vue`  
**Logic**: `bootstrap.ts`  
**Use Case**: Automated setup of fresh RouterOS devices

### wg-obfuscator Sidecar
**Status**: ✅ Shipped (partial) | **Commit**: `facfde5`

Automatic deployment of `wg-obfuscator` containers on RouterOS:
- Per-interface obfuscation config
- Stored in `wg_obfuscator_configs` table
- DPI evasion for censored networks

**Component**: `ObfuscationForm.vue`  
**Known Gap**: Client config generation not yet wired into download routes

---

## PHASE 2 — Multi-Engine & Federation (✅ Mostly Shipped)

Proving the abstraction with additional engines.

### AmneziaWG Engine
**Status**: ✅ Shipped | **Commit**: `d7b1338`

Promoted from build-time flag to runtime engine:
- Uses `awg`/`awg-quick` when available
- Falls back to `amneziawg-go` userspace
- Auto-generates obfuscation parameters (Jc, Jmin, Jmax, S1-S4, H1-H4, I1-I5)
- Docker fallback via transient container

**Config Generation**: Includes `[AmneziaWG]` section with obfuscation params

### BoringTun Engine
**Status**: ✅ Shipped | **Commit**: `7b4e711`

Userspace WireGuard via Cloudflare's `boringtun-cli`:
- Process manager handles daemon lifecycle
- UAPI socket communication
- Workaround for BoringTun's single-peer-set bug (uses `wg setconf`)
- Built from source in Docker

**Use Case**: Environments without kernel WireGuard support

### Engine Selection UX
**Status**: ✅ Shipped | **Commit**: `5c72363`

Admin interface for selecting VPN engine per interface:
- Shows capability hints (obfuscation, speed limits, live stats)
- Engine metadata API at `/api/admin/engines`
- Per-interface engine configuration

**Components**: `EngineSelector.vue`, `EngineCapabilityHints.vue`

### Integration & Bug Fixes
**Status**: ✅ Shipped | **Commit**: `b8f2410`

- **Config Generation Fix**: All download routes now use engine-aware config generation
- **Auth Hardening**: Fixed SSR auth middleware, principal resolution, session handling
- **Dashboard Fixes**: QR code routes, usage graphs, logout, i18n keys
- **SSH Passphrase Support**: Encrypted SSH keys for MikroTik management
- **Traffic Shaping Infrastructure**: `init-ifb.sh` for IFB kernel module

---

## PHASE 3 — Long Tail (🌑 Planned)

Future enhancements not yet implemented.

### Multi-Router Federation
**Status**: 🌑 Planned

Orchestrator + agent architecture for multi-node deployments:
- Agents make outbound mTLS connections to orchestrator
- Centralized management of distributed routers
- Load balancing and failover

### Admin Router ACL
**Status**: 🌑 Planned

Per-admin scoping to specific routers:
- Prerequisite for federation
- Fine-grained access control
- Multi-tenant support

### Multi-Path Routing
**Status**: 🌑 Planned

Exit-node selection per IP/subnet/client:
- Route policies with priority
- Policy-based routing
- Geographic routing

### Tailscale Integration
**Status**: 🌑 Planned

Interoperability with Tailscale mesh networks.

### SSO (OIDC/SAML)
**Status**: 🌑 Planned

Enterprise authentication integration (research phase).

---

## Known Gaps & Limitations

| Gap | Severity | Notes |
|-----|----------|-------|
| **MikroTik untested with live hardware** | Medium | Unit tests pass; no end-to-end verification against real RouterOS device |
| **MikroTik TLS fingerprint pinning (TOFU)** | Medium | No certificate verification; connects to any TLS-enabled RouterOS API |
| **MikroTik obfuscation not wired to client configs** | Medium | `generateClientObfuscatorConfig()` implemented but not integrated into download routes |
| **i18n incomplete** | Low | Many dashboard and engine capability keys missing from non-English locales |
| **Per-peer AmneziaWG parameter overrides** | Low | UI not implemented; parameters currently shared via interface-level defaults |

---

## Test Coverage

- **~165 unit tests** covering crypto, engine logic, API controllers, scheduler, services, middleware, composables
- **E2E integration tests** for WireGuard and MikroTik engines
- Test suite passes; CI/CD via GitHub Actions

---

## Deployment & Operations

### Docker Multi-Stage Build
Includes all engine binaries:
- `boringtun-cli` (Rust)
- `amneziawg-go` + `amneziawg-tools` (Go)
- `wg-tools` (C)

### Docker Compose Variants
- Default (WireGuard)
- Build-from-source
- AmneziaWG-focused

### Embedded DNS
`dnsmasq` on wg gateway (10.8.0.1 by default). Configurable upstream.

### Host-side Obfuscator Sidecar
Separate container for wg-obfuscator. Shared volume for config.

### Image Publishing
Published to `ghcr.io` with tags:
- `edge` (master branch)
- `vX.Y.Z` (releases)
- `sha-<short>` (commits)
- `manual-<sha>` (manual dispatch)

---

## Architecture Highlights

1. **Pluggable engines** via `VpnEngine` interface — enables WireGuard, AmneziaWG, BoringTun, MikroTik
2. **Multi-transport** — local shell, SSH, RouterOS API
3. **RBAC with audit logging** — five roles, per-router scoping (planned)
4. **User-facing features** — dashboard, QR login, quotas, speed limits, traffic groups
5. **Scheduler workers** — usage polling, quota enforcement, period reset, usage rollup
6. **Embedded DNS** — dnsmasq on wg gateway
7. **Host-side obfuscation** — wg-obfuscator sidecar for DPI evasion

---

## Upstream Contributions Merged

The fork also tracks upstream PRs merged into wg-easy:
- AWG: support for H1-H4 ranges
- Client Firewall
- CLI: Show QR code
- Copy QR code to clipboard / save as PNG
- Hooks as Textareas
- Update to Node Krypton (24)
- Mobile UI improvements

---

## Git History Summary

- **50+ commits** since fork point
- **Major milestones**:
  - `b1071fc` — Phase 0 foundation (engines, RBAC, auth, schema)
  - `f824ac2` — MikroTik driver
  - `b9903ed` — User dashboard + QR login
  - `61564a4` — Bandwidth quotas
  - `95a9a8f` — Speed limits
  - `d7b1338` — AmneziaWG promotion
  - `7b4e711` — BoringTun driver
  - `5c72363` — Engine selection UX
  - `b8f2410` — Integration & bug fixes
  - `4a72c63` — Build: ghcr image workflow, BUILD.md
  - `0015` migration — Traffic groups & sub-accounts

---

## Contributing

When adding new features:
1. Document in this file under appropriate phase
2. Update TESTING_GUIDE.md with test cases
3. Add migration if database changes required
4. Update i18n keys in all locales
5. Add unit tests for new services/components
6. Update BUILD.md if build process changes

---

## License

Same as upstream wg-easy (check LICENSE file).
