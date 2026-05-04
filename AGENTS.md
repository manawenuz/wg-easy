# AGENTS.md — wg-easy

WireGuard VPN management platform with a Nuxt 4 fullstack app. Fork of [wg-easy](https://github.com/wg-easy/wg-easy) (`upstream/master`) with multi-engine support, RBAC, user dashboard, and quota/speed-limit features. Fork is at `origin/master` (manawenuz/wg-easy).

## Fork Development Status

All features are implemented and committed. Test status:

| Feature | Unit Tests | E2E / Live |
|---|---|---|
| WireGuard engine | Passing | Verified (`e2e-phase1-wireguard.cjs`) |
| AmneziaWG engine + obfuscation | Passing | Verified (Docker fallback) |
| BoringTun engine | Passing | Verified |
| MikroTik engine | Passing | **Untested on live hardware** |
| RBAC + Auth | Passing | Verified (Phase 1) |
| User Dashboard + QR Login | Passing | Verified |
| Bandwidth Quotas | Passing | Verified (usage injection) |
| Speed Limits | Passing | Verified (Linux tc integration) |

See `CHANGELOG.md` for a detailed per-commit breakdown of all fork changes.

### 16 Fork Commits (upstream/master..HEAD)

1. `f4c2746` — docs: planning vault for Phase 1
2. `b1071fc` — **Phase 0 Foundation:** VpnEngine abstraction, engine registry, transport layer, RBAC (5 roles), auth refactor (principal middleware, Basic/Bearer/session), database expansion (audit logs, API tokens, routers, quotas, speed limits, usage samples, etc.), WireGuard engine, admin user management
3. `7878979` — docs: architecture diagram
4. `f4435e1` — tooling: Kimi API implementation wrapper
5. `a887e12` — docs: PRD-20-01 (User Dashboard) shipped
6. `b9903ed` — **PRD-20-02 (QR Key Login):** Curve25519 ECDH + SHA-512 challenge-response, `wgKeyAuth.ts`, dashboard login pages, user session management
7. `61564a4` — **PRD-20-03 (Bandwidth Quotas):** Per-client daily/weekly/monthly data caps, scheduler (usagePoller, quotaEvaluator, periodResetter, usageRollup), auto-disable on exceed
8. `95a9a8f` — **PRD-20-04 (Speed Limits):** Per-client rate limiting, Linux `tc`/HTB/IFB integration, engine-aware speed limit service
9. `f824ac2` — **PRD-10-01 (MikroTik Driver):** Full VpnEngine for RouterOS via API + SSH, router CRUD, AES-256-GCM credential encryption, config generation, RouterOS queue tree speed limits
10. `fd51db4` — **PRD-10-02 (MikroTik Bootstrap):** Zero-touch 4-step wizard (WG interface, IPs, NAT, API user) via SSH, `BootstrapWizard.vue`
11. `facfde5` — **PRD-10-03 (wg-obfuscator Sidecar):** DPI evasion for MikroTik, `ObfuscationForm.vue`, per-interface obfuscation config
12. `d7b1338` — **PRD-30-01 (AmneziaWG Engine):** First-class engine with `awg-quick`, `amneziawg-go` userspace fallback, Docker fallback, auto-generated obfuscation params
13. `7b4e711` — **PRD-30-02 (BoringTun Engine):** Userspace WireGuard via `boringtun-cli` (Rust), process manager with UAPI socket handling, built in Docker multi-stage
14. `5c72363` — **PRD-30-03 (Engine Selection UX):** Admin engine picker with capability hints, `/api/admin/engines` metadata endpoint
15. `d378bf9` — docs: implementation audit and UAT documentation
16. `b8f2410` — **Final Integration:** Config generation fix (all routes now engine-aware), auth hardening, dashboard fixes, SSH passphrase support, IFB init script, Docker updates for multi-engine, ~165 unit tests

### Known Gaps

- **MikroTik engine untested on live hardware** — unit tests pass, needs real RouterOS device verification
- **MikroTik TLS pinning** not implemented — connects to any TLS RouterOS API without verification
- **MikroTik obfuscation** client config generation not wired into download routes yet
- **i18n** — dashboard and engine capability keys missing from non-English locales
- **Per-peer AmneziaWG parameter overrides** punted; params are interface-level defaults
- **`usage.get.test.ts`** reported as potentially flaky

## Commands

All commands run inside `src/` unless noted otherwise. The project uses **pnpm** (`pnpm@10.33.2`).

```bash
# Development (Docker — recommended, needs NET_ADMIN + Linux kernel modules)
pnpm dev                    # from repo root: docker compose -f docker-compose.dev.yml up --build

# If running outside Docker (requires Linux, wg tools installed):
cd src && pnpm install && pnpm dev

# Build
cd src && pnpm build         # nuxt build + CLI build

# Lint / Typecheck / Format
cd src && pnpm lint
cd src && pnpm typecheck
cd src && pnpm format:check
cd src && pnpm format        # write

# All checks at once
cd src && pnpm check:all     # typecheck + lint + format:check + build

# Tests
cd src && pnpm test:unit     # vitest run --project unit

# Database migrations (after schema changes)
cd src && pnpm db:generate   # drizzle-kit generate

# CLI tool
cd src && pnpm cli:dev       # tsx cli/index.ts (development)
# Built CLI is bundled into Docker image as /usr/local/bin/cli

# Docs preview (from repo root)
pnpm docs:preview
```

### CI (`.github/workflows/lint.yml`)

Runs on push to `master` and on PRs: `lint`, `typecheck`, `format:check` (matrix), plus docs formatting. Uses Node `lts/krypton`.

## Architecture Overview

```
src/
├── app/                  # Nuxt frontend (Vue 3 + Pinia + Tailwind)
│   ├── pages/            # File-based routing (admin/, dashboard/, setup/, clients/)
│   ├── components/       # Vue SFCs organized by domain (ClientCard/, Form/, Admin/, etc.)
│   ├── composables/      # useSubmit (typed API calls with toast feedback)
│   ├── stores/           # Pinia stores (clients, auth, global, toast, setup, dashboard)
│   ├── middleware/        # auth.global.ts — route guards based on principal/role
│   └── layouts/          # default.vue, dashboard.vue, setup.vue
├── server/               # Nitro server (auto-imported H3 event handlers)
│   ├── api/              # API routes — file-based (e.g. api/client/[clientId]/index.get.ts)
│   ├── database/         # Drizzle ORM + libsql/SQLite
│   │   ├── schema.ts     # Re-exports all repository schemas (NO path aliases here)
│   │   ├── sqlite.ts     # DBService class — the central database accessor
│   │   ├── migrations/   # Drizzle-generated SQL migrations
│   │   └── repositories/ # Per-entity: schema.ts, types.ts, service.ts
│   ├── engines/          # VPN engine abstraction layer
│   ├── scheduler/        # Background jobs (usage polling, quota evaluation, rollups)
│   ├── middleware/        # principal.ts — resolves auth on every request
│   ├── plugins/          # manager.ts — startup banner + graceful shutdown (bringDown)
│   ├── services/         # Cross-cutting business logic (quota, speed limit)
│   ├── transports/       # LocalShell, SSH, RouterOS API transports
│   └── utils/            # Shared server utilities
├── shared/               # Code shared between client and server
│   └── utils/
│       ├── permissions.ts # RBAC: roles, permissions matrix, hasPermissions()
│       └── time.ts        # isPeerConnected()
├── cli/                  # Standalone CLI (citty framework, bundled with esbuild)
└── i18n/                 # Locale JSON files + i18n config
```

## Key Design Patterns

### Path Aliases

| Alias | Resolves To | Notes |
|---|---|---|
| `#db` | `src/server/database/` | Configured in `nuxt.config.ts` (nitro.alias) AND root alias |
| `#shared` | `src/shared/` | Only in vitest config for tests |
| `~~/` | Repo root | Nuxt built-in |

**Important**: `src/server/database/schema.ts` must NOT use path aliases — it re-exports all sub-schemas with relative paths. This is explicitly noted in the file.

### `Database` Global (server/utils/Database.ts)

The server-side entry point. On startup it:
1. Runs Drizzle migrations
2. Auto-promotes single admin to SUPERADMIN
3. Migrates old AWG engine type if needed
4. Optionally runs initial setup from env vars
5. Brings up the VPN engine
6. Starts the scheduler

Exports a lazily-initialized `DBService` instance via a Proxy that throws if accessed before initialization. Import as `Database` and call `Database.clients.getAll()`, `Database.users.get(id)`, etc.

### Database Repository Pattern

Each entity under `server/database/repositories/<entity>/` has three files:
- **`schema.ts`** — Drizzle table definition + relations
- **`types.ts`** — TypeScript types (`InferSelectModel`) + Zod validation schemas
- **`service.ts`** — Service class with prepared statements, constructed with `DBType`

The `DBService` class in `sqlite.ts` aggregates all entity services as properties.

### API Route Handlers

Three handler types in `server/utils/handler.ts`:

1. **`definePermissionEventHandler(resource, action, handler)`** — For authenticated+authorized routes. Handler receives `{ event, user, checkPermissions }`. **You MUST call `checkPermissions(data)` inside the handler** or you get a 500 "Permission was not checked".

2. **`defineSetupEventHandler(step, handler)`** — For setup wizard routes. Only active when setup is not complete.

3. **`defineMetricsHandler(type, handler)`** — For Prometheus/JSON metrics endpoints. Validates bearer token.

### VPN Engine Abstraction (`server/engines/`)

`VpnEngine` interface with four implementations:
- **wireguard** — Kernel WireGuard via `wg`/`wg-quick` commands
- **amneziawg** — AmneziaWG with packet obfuscation (`awg`/`awg-quick`)
- **boringtun** — Userspace WireGuard via boringtun-cli
- **mikrotik** — Remote MikroTik router via RouterOS API + SSH

Engines are registered in `registry.ts` and retrieved via `getEngine(type)` or `getEngineForInterface(iface)`. Each engine declares capabilities (obfuscation, speedLimit, multiPeerSync, livePeerStats).

The `wg-like.ts` helper provides `parseWgDump()` shared by wireguard/amneziawg/boringtun engines.

### Auth & Principal System

`server/middleware/principal.ts` runs on every request and resolves the `Principal` to `event.context.principal`:
- Bearer token (API token)
- Basic auth (username:password)
- Admin session cookie (`wg-easy`)
- User (dashboard) session cookie (`wg-user-session`)

**Dashboard users** always get `role: CLIENT` regardless of the underlying user record's role. This prevents privilege escalation.

### Frontend Auth Flow

`app/middleware/auth.global.ts` is a global route middleware:
- Reads `event.context.principal` on SSR, falls back to `/api/session` on client
- Stores user data in `useAuthStore()` (Pinia)
- Redirects unauthenticated users to `/login` or `/dashboard/login`
- CLIENT-role users are blocked from admin routes (`/`, `/admin/*`, `/clients/*`)

### `useSubmit` Composable

Typed wrapper around `$fetch` with toast feedback and revert callbacks. Usage pattern in Vue components:

```ts
const submit = useSubmit('/api/client', { method: 'post' }, {
  revert: async (success, data) => { /* optimistic update revert */ },
  successMsg: 'Client created',
});
```

### Scheduler (`server/scheduler/`)

Runs background tasks on startup (via `setIntervalImmediately`) and then at intervals:
- **Usage poller** — every 60s, calls `engine.sampleUsage()` → stores usage samples
- **Quota evaluator** — runs immediately after polling, disables clients over quota
- **Period resetter** — every 60s, resets expired quota periods
- **Usage rollup** — every 1h, aggregates old usage samples

## Gotchas & Non-Obvious Details

- **`exec()` is a no-op outside Linux** (`server/utils/cmd.ts`). Commands return empty string on macOS/Windows. This is intentional — VPN operations only work in the Docker container.

- **Database schema files cannot use path aliases.** The `#db` alias works for imports elsewhere, but `server/database/schema.ts` and all repository `schema.ts` files use relative paths.

- **`checkPermissions` must be called** in every `definePermissionEventHandler` handler, even if the permission is a simple boolean. The framework enforces this at runtime (500 error).

- **`Database` is a Proxy** that throws "Database not yet initialized" if accessed before the async `connect()` promise resolves. This means top-level awaits in `Database.ts` run during server startup.

- **Test path aliases differ from app aliases.** Vitest config maps `#shared` and `#db` manually. New test files need these aliases to import shared/server code.

- **Nuxt compatibility version 4** (`future.compatibilityVersion: 4` in nuxt.config). This affects auto-imports and some conventions.

- **Nitro ignores test files**: `nitro.ignore: ['**/*.test.ts']` means test files are not bundled into the production server build.

- **The `old_env` PASSWORD/PASSWORD_HASH check** (`Database.ts`) will throw on startup if legacy v14 env vars are set, blocking the server with a migration guide URL.

- **Docker image runs `node server/index.mjs`** via dumb-init. The production build output is in `.output/` which gets copied to `/app` in the container.

- **AmneziaWG fields** on the client schema (`jC`, `jMin`, `jMax`, `i1`–`i5`) are nullable and only used when the engine is `amneziawg`.

- **i18n locale files** are in `src/i18n/locales/*.json`. The `scripts/i18n.sh` script manages them. Translation strategy is `no_prefix` (URLs don't include locale).

- **The `RELEASE` constant** (`server/utils/config.ts`) is derived from `package.json` version, not from git tags.

## Testing

Tests use **Vitest** with the `unit` project config. Test files live alongside source files (e.g., `server/engines/wireguard/index.test.ts`) or in `test/unit/`.

```bash
cd src && pnpm test:unit
```

The vitest config explicitly includes test paths:
- `test/unit/*.{test,spec}.ts`
- `test/ssr-auth.test.ts`
- `app/composables/**/*.test.ts`
- `server/engines/**/*.test.ts`
- `server/transports/**/*.test.ts`
- `server/database/migrations/**/*.test.ts`
- `server/utils/*.test.ts`
- `server/scheduler/**/*.test.ts`
- `server/services/**/*.test.ts`
- `server/middleware/**/*.test.ts`
- `server/api/**/*.test.ts`

Coverage is enabled by default.

## Database Schema

SQLite via **Drizzle ORM** + **libsql**. Migrations are in `src/server/database/migrations/`. Generate new migrations after schema changes:

```bash
cd src && pnpm db:generate
```

Key tables: `clients_table`, `users`, `wg_interface`, `hooks`, `one_time_links`, `routers`, `quotas`, `speed_limits`, `usage_samples`, `audit_logs`, `admin_router_acls`, `exit_nodes`, `route_policies`, `api_tokens`, `wg_obfuscator_configs`, `general`, `user_configs`.

## Environment Variables

Key env vars (set in Dockerfile or docker-compose):
- `PORT` (required, default 51821) — UI port
- `HOST` (default 0.0.0.0)
- `INSECURE` — set to `true` for HTTP (disables secure cookies)
- `DISABLE_IPV6` — strips IPv6 iptables rules from hooks
- `INIT_ENABLED` — enables first-run setup from env vars
- `INIT_USERNAME`, `INIT_PASSWORD`, `INIT_HOST`, `INIT_PORT` — auto-setup credentials
- `INIT_IPV4_CIDR`, `INIT_IPV6_CIDR`, `INIT_DNS`, `INIT_ALLOWED_IPS` — auto-setup network config
- `DATABASE_URL` — SQLite path (default `file:/etc/wireguard/wg-easy.db`)
- `DEBUG` — comma-separated debug namespaces (e.g., `Server,WireGuard,Database,CMD`)
- `EXPERIMENTAL_AWG` — legacy flag for AmneziaWG auto-detection (deprecated)

## Permissions / RBAC

Roles defined in `shared/utils/permissions.ts`:
- **SUPERADMIN** (3) — full access, auto-assigned to sole admin
- **ADMIN** (1) — full access
- **OPERATOR** (4) — client CRUD, no admin panel
- **VIEWER** (5) — read-only clients, no mutations
- **CLIENT** (2) — self-service only (own clients)

Permissions are checked with `hasPermissions(user, resource, action, data?)` or via the `definePermissionEventHandler` wrapper.
