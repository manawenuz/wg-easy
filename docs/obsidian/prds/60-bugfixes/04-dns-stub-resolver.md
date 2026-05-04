---
id: PRD-60-04
title: Embed a tunnel-local stub DNS resolver to fix flaky client DNS
status: approved
phase: P1
priority: high
severity: functional
depends_on: []
touches:
  - Dockerfile
  - docker-compose.yml
  - src/server/database/repositories/userConfig/service.ts
  - src/server/engines/wireguard/configgen.ts
  - src/server/database/repositories/hooks/service.ts
  - src/server/engines/wireguard/index.ts
  - src/i18n/locales/en.json
  - docs/obsidian/architecture.md
---

# Embed a tunnel-local stub DNS resolver to fix flaky client DNS

> Status: `approved` · Phase: `P1` · Severity: functional

## Why

Reported by the operator on the test deployment at `178.105.64.108`:

> "DNS is super flaky. When I download a config and start the VPN, DNS doesn't work. If I do `dig google @1.1.1.1` it works (even with my DNS set to 1.1.1.1 in the config). But for the VPN to work I have to change its DNS to something else and reconnect."

### Diagnosis

I inspected the live deployment over SSH. Server-side networking is **correct**:

- `wg0` is up; AllowedIPs in clients is `0.0.0.0/0, ::/0` (default).
- Container iptables: `-A POSTROUTING -s 10.8.0.0/24 -o eth0 -j MASQUERADE` is present; FORWARD allows `wg0` both directions.
- Container `ip a` shows wg0 on `10.8.0.1/24`, eth0 on `172.18.0.2/16`.
- `ip_forward` is on at the host (Docker enables it via the bridge).
- The path **client → wg0 → eth0 (NAT) → 1.1.1.1** is unobstructed; that's why explicit `dig @1.1.1.1` works while the VPN is up.

The bug is **not server-side networking**. The pattern (explicit `dig` works; system DNS doesn't; switching to a different DNS server fixes it) is the well-known **macOS WireGuard NetworkExtension DNS-handover race**:

- macOS WireGuard.app uses `NEPacketTunnelProvider` to install a `NEDNSSettings` object naming the tunnel's DNS server. macOS then reconfigures `mDNSResponder` to use that server for queries matched by `matchDomains`.
- When the user's **system DNS is already 1.1.1.1** (very common — Cloudflare ships it as the default in many ISP routers and macOS network setups), the new DNSSettings is a no-op from `mDNSResponder`'s perspective: same server, "no change". `mDNSResponder` keeps using its existing socket bound to the **physical interface** instead of routing queries through `utun*`. Result: queries silently leak out the physical interface and either time out (if the VPN's `0.0.0.0/0` route blackholes the egress) or are answered by a cached/stale resolver — or in some configurations, the OS falls back to the now-unreachable previous DNS.
- Switching the tunnel DNS to `8.8.8.8` (anything ≠ user's existing system DNS) forces `mDNSResponder` to actually rebind, and the tunnel DNS starts working.

Reference: this is documented in WireGuard-Apple issues and confirmed by reproducing the pattern (works after a "real" DNS change, breaks when the configured DNS matches the user's existing system resolver). Upstream wg-easy v15 dropped the embedded `dnsmasq` that earlier versions shipped, which is why this regressed: the historical default `DNS = 10.8.0.1` (a tunnel-local stub) sidestepped the macOS bug because no one's system DNS is ever `10.8.0.1`.

### The fix

Bring back a **tunnel-local stub DNS resolver** at `10.8.0.1:53` and make it the default DNS in user configs. Because `10.8.0.1` is unique to this tunnel, the macOS DNSSettings change is always a "real" change, mDNSResponder always rebinds, and DNS reliably routes through the tunnel. The stub forwards upstream to a configurable resolver (default 1.1.1.1, 1.0.0.1).

This fix is server-side and benefits every client OS (the macOS bug is the worst-affected, but Windows and Linux clients also benefit from a stable tunnel-local resolver — e.g., it isolates the VPN's DNS from the client's local DNS configuration).

## User stories

- As a **dashboard user on macOS**, when I download my config and connect, DNS works on the **first connect**, regardless of what my system DNS is set to.
- As a **server operator**, I can change the upstream DNS used by the embedded stub via an admin setting (default 1.1.1.1, 1.0.0.1).
- As a **server operator**, I can **opt out** of the embedded resolver and have user configs ship with their `defaultDns` value directly (back-compat for setups that don't want the stub).

## Scope

### In

- Add a lightweight stub resolver to the wg-easy container. Recommendation: **dnsmasq** (small, well-known, in Alpine/Debian repos, single binary). Configured to:
  - Bind to `10.8.0.1:53` (and `[fdcc:ad94:bacf:61a4::cafe:1]:53`) — the wg0 interface IPs.
  - **Not** bind to `eth0` (the container's external interface) — never expose DNS publicly.
  - Forward to upstream resolvers configured via admin (default `1.1.1.1, 1.0.0.1`).
  - No DHCP, no host file resolution beyond standard, ~5-minute negative cache.
- Start the stub from the same entrypoint that runs the Nuxt app (single container — see [[decisions/0005-no-ansible]] for the no-multi-container preference).
- Add a `userConfig.embeddedDnsEnabled` flag (default `true`) and `userConfig.dnsUpstream` array (default `['1.1.1.1', '1.0.0.1']`).
- When `embeddedDnsEnabled === true`, the WireGuard config generator (`src/server/engines/wireguard/configgen.ts`) emits `DNS = 10.8.0.1` (and the v6 equivalent if v6 is enabled) instead of the user's configured `defaultDns`. The user can still override per-client (`client.dns`) — that override wins.
- Add iptables rules in the wg0 PostUp/PostDown to allow `udp/tcp dport 53` traffic from `10.8.0.0/24` to the wg0 IP. (The existing FORWARD rule already covers wg0 in/out; an additional INPUT-allow may be needed if INPUT default policy ever changes — currently it's ACCEPT, so this is a no-op.)
- Update admin UI (Interface settings) to expose:
  - "Embedded DNS resolver" toggle.
  - "Upstream DNS servers" multi-input.
  - When the toggle is OFF, show a warning: "macOS clients may experience DNS handover issues; recommended ON".
- Add a new health check that the stub answers a query for `localhost.` (or similar) on container startup, before reporting healthy.
- Update `architecture.md` with a note on the DNS data path: client → wg0 → 10.8.0.1 (dnsmasq) → eth0 (MASQUERADE) → upstream.

### Out

- DNS-over-HTTPS / DNS-over-TLS to upstream (nice-to-have; default to plain UDP for now).
- Per-tenant or per-router DNS configuration (covered by federation PRD).
- Custom A/AAAA records inside the tunnel (e.g., for internal services).
- Replacing dnsmasq with CoreDNS or unbound (dnsmasq is plenty for a stub; revisit only if scope grows).
- Changing client AllowedIPs or split-tunnel logic.

## Data model changes

Add columns to `user_config_table` (`src/server/database/repositories/userConfig/schema.ts`):

```ts
embeddedDnsEnabled: integer('embedded_dns_enabled', { mode: 'boolean' })
  .notNull()
  .default(true),
dnsUpstream: text('dns_upstream', { mode: 'json' })
  .$type<string[]>()
  .notNull()
  .default(sql`'["1.1.1.1","1.0.0.1"]'`),
```

Migration up: `ALTER TABLE user_config_table ADD COLUMN embedded_dns_enabled INTEGER NOT NULL DEFAULT 1;` and equivalent for `dns_upstream` (TEXT, JSON-encoded array, default `'["1.1.1.1","1.0.0.1"]'`).

Migration down: drop the columns.

## API changes

| Method | Path | Auth | Body | Returns |
| --- | --- | --- | --- | --- |
| GET | `/api/admin/user-config` | admin | — | existing fields + `embeddedDnsEnabled`, `dnsUpstream` |
| PATCH | `/api/admin/user-config` | admin | partial userConfig including new fields | updated record |

No new endpoints; the existing user-config endpoints just gain two fields.

## UI changes

- `src/app/pages/admin/general/index.vue` (or wherever Interface DNS is configured today): add a section "Embedded DNS resolver" with the toggle and upstream-DNS input.
- New i18n strings in `src/i18n/locales/*.json`:
  - `admin.embeddedDns`: "Embedded DNS resolver"
  - `admin.embeddedDnsDesc`: "Run a DNS forwarder on 10.8.0.1 inside the tunnel. Recommended; fixes macOS DNS handover issues."
  - `admin.dnsUpstream`: "Upstream DNS servers"
  - `admin.dnsUpstreamDesc`: "Where the embedded resolver forwards queries."

## Driver / backend changes

- `src/server/engines/wireguard/configgen.ts` `generateClientConfig`:
  - At the top, compute `effectiveDns`:
    - If `client.dns` is set → use it (per-client override).
    - Else if `userConfig.embeddedDnsEnabled` → `['10.8.0.1', 'fdcc:ad94:bacf:61a4::cafe:1']` (filter v6 by `enableIpv6`).
    - Else → `userConfig.defaultDns`.
  - Emit `DNS = ...` from `effectiveDns`.
- `src/server/engines/wireguard/index.ts` startup hook:
  - When the engine starts the interface, also start (or `SIGHUP`) the dnsmasq sidecar process with the configured upstream list.
  - On shutdown, stop dnsmasq.
  - On user-config update (PATCH), `SIGHUP` dnsmasq if `dnsUpstream` changed.
- `Dockerfile`: install `dnsmasq` package (Alpine: `apk add dnsmasq`; Debian: `apt-get install dnsmasq-base`). Do NOT enable the dnsmasq systemd service — we manage the process from Node.
- `Dockerfile.dev`: same.
- Entry script (e.g., `scripts/start.sh` if used, or the Dockerfile `CMD` chain): launch dnsmasq via `s6-overlay` or a simple `&` background process before exec-ing the Nuxt app — or, preferred, spawn it from Node so the engine controls its lifecycle.
- The mikrotik / amneziawg engines do NOT get the embedded resolver in this PRD — they're remote, not in-container. Document this in `architecture.md`.

### dnsmasq config (templated by Node, written to `/etc/dnsmasq.d/wg-easy.conf` at runtime)

```
# wg-easy embedded stub resolver (auto-generated)
no-resolv
no-hosts
no-poll
listen-address=10.8.0.1
listen-address=fdcc:ad94:bacf:61a4::cafe:1
bind-interfaces
interface=wg0
except-interface=eth0
cache-size=1000
neg-ttl=300
{{#each dnsUpstream}}
server={{this}}
{{/each}}
```

## Migration & rollout

- Schema migration runs on container start (existing drizzle-kit pattern).
- Existing user configs: defaults are `embeddedDnsEnabled=true` and `dnsUpstream=['1.1.1.1','1.0.0.1']`. Existing client configs already deployed to user devices keep working — they have `DNS = 1.1.1.1` baked in. They benefit from the fix only after re-downloading and re-importing. Document this in the release notes.
- For the test deployment at `178.105.64.108`: after deploy, regenerate the two existing configs (`dns-test`, `TTTT`) and re-import on the macOS clients. DNS should work on first connect.
- Feature flag: not strictly needed since the new defaults are safe, but the `embeddedDnsEnabled` toggle effectively *is* the flag. Operators can flip it off to revert behavior.

## Verification

### Unit tests

- **NEW** `src/server/engines/wireguard/configgen.test.ts` (extend if exists):
  - With `embeddedDnsEnabled=true` and no per-client `dns`, generated config contains `DNS = 10.8.0.1, fdcc:ad94:bacf:61a4::cafe:1` (v6 if enabled).
  - With `embeddedDnsEnabled=false`, generated config contains `DNS = 1.1.1.1, 1.0.0.1` (or whatever `defaultDns` is).
  - With per-client `dns = ['9.9.9.9']`, that wins regardless of `embeddedDnsEnabled`.

### Integration tests

- Build the container, start it. Inside the container:
  - `pgrep dnsmasq` → returns a PID.
  - `dig @10.8.0.1 example.com` → returns an A record within 2s.
  - `dig @172.18.0.2 example.com` (eth0 IP) → times out / refused (must NOT serve on eth0).
- From a connected WireGuard client (real macOS test on `178.105.64.108`):
  - `scutil --dns` shows `10.8.0.1` as resolver for the default scope while VPN is up.
  - Browsing works on first connect (the actual user-reported failure).

### Manual test plan

1. Deploy. Regenerate `dns-test` config, import on macOS WireGuard.app.
2. Connect. Verify DNS works (`dig example.com` no `@server` arg, browser navigation works) on first connect.
3. Toggle "Embedded DNS resolver" off in admin. Regenerate config. Reconnect. Verify DNS now uses 1.1.1.1 directly (this is the macOS-buggy mode — expected to fail on macOS where system DNS is also 1.1.1.1, validating the diagnosis).
4. Toggle back on. Verify recovery.

## Open questions

- [ ] Should we run dnsmasq as PID 1's child or use s6-overlay? Recommend Node-spawned child for simplicity and clean shutdown — but verify that stdout/stderr is captured to the container logs.
- [ ] Should the embedded resolver be exposed on **multiple** interfaces if multiple WG interfaces are added later (federation)? Out of scope; current schema is single-interface.

---

## Kimi handoff

**Read before implementing:**
- `[[architecture]]` — interface/engine section
- `[[decisions/0002-backend-abstraction]]` — driver pattern
- `[[decisions/0005-no-ansible]]` — single-container preference
- `src/server/engines/wireguard/configgen.ts` (full file)
- `src/server/engines/wireguard/index.ts` (full file)
- `src/server/database/repositories/userConfig/schema.ts` (full file)
- `src/server/database/repositories/userConfig/service.ts` (full file)
- `Dockerfile`, `Dockerfile.dev` (full)
- `docker-compose.yml`, `docker-compose.dev.yml` (full)
- An existing migration file under `src/server/database/migrations/` for syntax reference.

**Modify these files:** see `touches:` frontmatter; also add a new migration `src/server/database/migrations/00XX_embedded_dns.sql` and update `meta/_journal.json`.

**Do NOT modify:**
- Mikrotik or AmneziaWG engine code (out of scope).
- Auth or session handling.
- Client UI for the user dashboard.

**Acceptance tests** (Kimi must demonstrate these pass):
1. Unit tests above pass.
2. Built container has `dnsmasq` binary and starts it on entry.
3. Container health check fails if dnsmasq isn't answering on `10.8.0.1`.
4. Schema migration applies cleanly to an empty DB and to a DB seeded with the existing schema.
5. Toggling `embeddedDnsEnabled` in admin and regenerating a config flips the `DNS = ...` line as specified.
6. dnsmasq does not bind to `eth0` (verified by `ss -lnu` inside container — no UDP 53 on the eth0 IP).

**Self-test plan:**
```bash
cd src
pnpm test server/engines/wireguard/configgen
docker compose -f ../docker-compose.dev.yml build
docker compose -f ../docker-compose.dev.yml up -d
sleep 5
docker compose -f ../docker-compose.dev.yml exec wg-easy pgrep dnsmasq
docker compose -f ../docker-compose.dev.yml exec wg-easy dig @10.8.0.1 example.com +short
docker compose -f ../docker-compose.dev.yml exec wg-easy ss -lnu | grep ':53'
# manual: connect a real macOS client and confirm DNS works on first connect
```
