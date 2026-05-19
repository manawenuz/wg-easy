# Build & deploy guide — wg-easy-fork

This fork adds router-agnostic engines (MikroTik, AmneziaWG, BoringTun), a
multi-tenant client/dashboard model, embedded DNS, host-side wg-obfuscator,
and a number of operational fixes over upstream `wg-easy/wg-easy`. This
document covers everything an operator needs to build, deploy, upgrade, and
debug.

If you're just running the fork against the published image, jump to
**[Deploy from ghcr](#deploy-from-ghcr)**. If you've checked the source out and
want to build it yourself, **[Deploy from source](#deploy-from-source)**.

## Quickstart (host requirements)

| Requirement                     | Why                                                                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux host with Docker          | Container runtime for wg-easy + sidecar.                                                                                                                 |
| `network_mode: host`            | wg-easy manages WG interfaces on the host's network namespace.                                                                                           |
| `cap_add: NET_ADMIN`            | iptables/nft, interface bring-up.                                                                                                                        |
| `cap_add: SYS_MODULE`           | Loads the WireGuard kernel module if not already loaded.                                                                                                 |
| `devices: /dev/net/tun`         | Required for AmneziaWG / userspace fallback (`amneziawg-go`/`wireguard-go`).                                                                             |
| `iptables-nft` on the host      | Default on Ubuntu 22+, Debian 12+. The image itself uses `iptables-nft`; if your host runs `iptables-legacy`, see [iptables backend](#iptables-backend). |
| Public UDP port (default 51820) | WireGuard listen port. Open it in your edge firewall and forward to the wg-easy host if behind NAT.                                                      |

UDP 51821 (HTTP UI) is local-only by default. Put HTTPS in front of it for
remote admin (Caddy / nginx-proxy-manager / Cloudflare Tunnel).

## Deploy from ghcr

The fork's image is published as
`ghcr.io/<your-fork-owner>/wg-easy-fork`:

```yaml
# docker-compose.yml  (already in this repo, references the local build by
# default — for ghcr replace the image: line as below)
services:
  wg-easy:
    image: ghcr.io/manawenuz/wg-easy-fork:edge # or :latest, :v15.x.y
    # ...rest unchanged
```

Tags published:

| Tag                | When                            |
| ------------------ | ------------------------------- |
| `edge`             | Every push to `master`          |
| `vX.Y.Z`, `latest` | Every `git tag -a vX.Y.Z` push  |
| `sha-<short>`      | Every commit                    |
| `manual-<sha>`     | Manual `workflow_dispatch` runs |

Architectures: `linux/amd64` and `linux/arm64`. Build via the
[`Fork Image (ghcr)`](.github/workflows/fork-image.yml) GitHub Actions
workflow on push or via manual dispatch. The workflow is fork-only, uses
Node 24-compatible action majors, and publishes `edge` from `master`.

## Deploy from source

Useful when you want to test local changes before tagging an image.

```bash
git clone https://github.com/manawenuz/wg-easy.git wg-easy-fork
cd wg-easy-fork
docker compose -f docker-compose.build.yml up -d --build
docker compose logs -f wg-easy
```

`docker-compose.build.yml` carries the same service definitions as the
default compose file, but with `build: .` instead of `image:` so the image
is always built from your working tree.

To go back to the released image:

```bash
docker compose -f docker-compose.build.yml down
docker compose up -d   # uses ghcr image
```

## Deploy with AmneziaWG

For a deployment focused on AmneziaWG with obfuscation enabled out of the box, use the dedicated AmneziaWG compose file:

```bash
docker compose -f docker-compose.amnezia.yml up -d
```

This variant:

- Uses the ghcr.io published image (same as `docker-compose.yml`)
- Includes the wg-obfuscator sidecar pre-configured for host-side obfuscation
- Mounts `/var/run/docker.sock` for automatic obfuscator reload
- Exposes `/dev/net/tun` for AmneziaWG userspace fallback

After starting, switch the interface engine to AmneziaWG in the admin UI (see [Switch engine to AmneziaWG](#switch-engine-to-amneziawg)) and enable obfuscation (see [Enable obfuscation (host-side)](#enable-obfuscation-host-side)).

## What's in the box

The default compose ships **two** services:

1. **`wg-easy`** — the control plane + native engines (kernel WG, AmneziaWG,
   BoringTun) and the MikroTik driver.
2. **`wg-obfuscator`** — host-side wg-obfuscator sidecar
   (`clustermeerkat/wg-obfuscator:latest`). Used when an interface enables
   obfuscation in `host` mode (default). Inert until wg-easy writes a config
   into the shared volume `obfuscator_config`.

### Volumes

| Volume              | Mounts to (wg-easy)         | Mounts to (sidecar)     | Purpose                      |
| ------------------- | --------------------------- | ----------------------- | ---------------------------- |
| `etc_wireguard`     | `/etc/wireguard`            | —                       | DB + per-interface wg config |
| `obfuscator_config` | `/etc/wireguard/obfuscator` | `/etc/wg-obfuscator:ro` | Generated obfuscator configs |

### Devices and caps

- `cap_add: [NET_ADMIN, SYS_MODULE]`
- `devices: /dev/net/tun:/dev/net/tun` — **required** if AmneziaWG runs in
  userspace (host doesn't have the AWG kernel module). Harmless when not
  used.

### Environment variables

```yaml
environment:
  - INSECURE=true # serve HTTP on :51821 (use HTTPS via reverse proxy)
  - DEBUG=Server,WireGuard,Database,CMD,MikroTik,HostObfuscator,AmneziaWG
  - HOST_OBFUSCATOR_CONFIG_DIR=/etc/wireguard/obfuscator
  # Optional: SIGHUP-style reload after config changes (requires docker.sock mount)
  # - HOST_OBFUSCATOR_RELOAD_CMD=docker kill -s HUP wg-obfuscator
  # Optional: pre-seed a default MikroTik router (skipped if name already exists)
  # - MIKROTIK_DEFAULT_HOST=10.0.0.1
  # - MIKROTIK_DEFAULT_NAME=mikrotik-default
  # - MIKROTIK_DEFAULT_TRANSPORT=ssh        # ssh | routeros-api
  # - MIKROTIK_DEFAULT_SSH_USER=wg-easy
  # - MIKROTIK_DEFAULT_SSH_KEY_FILE=/run/secrets/mikrotik_ssh_key
  # - MIKROTIK_DEFAULT_API_USER=wg-easy
  # - MIKROTIK_DEFAULT_API_PASSWORD=changeme
  # - MIKROTIK_DEFAULT_TLS_REQUIRED=true
  # - MIKROTIK_DEFAULT_TLS_FINGERPRINT_SHA256=
```

## First-run

1. `docker compose up -d`
2. Open `http://<host>:51821/` — you'll be redirected to `/setup` if no
   admin exists.
3. Set host + port (use the public hostname/IP your clients will dial).
4. Create your admin. The first user is auto-promoted to **SUPERADMIN** if
   they're the only admin on the system.
5. Add a client → download config → import into the WireGuard /
   AmneziaWG / BoringTun client. Done.

## Common operator tasks

### Switch engine to AmneziaWG

By default the singleton interface uses the kernel WG engine. To switch:

1. Admin → Interface → Engine → **AmneziaWG**.
2. Save.
3. Admin → Interface → Restart.

If your host has the AWG kernel module, it'll be used (kernel-fast). If
not, wg-easy falls back to `amneziawg-go` userspace via `/dev/net/tun` —
make sure that device is mounted.

Re-download client configs after switching: AWG-mode configs include
`Jc/Jmin/Jmax/S1/S2/H1..H4` parameters that plain WG configs don't, and
`H1..H4` are regenerated on engine switch. Old plain-WG configs won't
handshake against an AWG server.

### Add a MikroTik router

1. Admin → Routers → Add Router. Pick mode (TLS API / plain API / SSH key).
   Fill in host + credentials.
2. Expand the **Bootstrap script** section. Click **Download .rsc**.
3. On the MikroTik: Files → upload the `.rsc` → Terminal:
   `/import file-name=<your-router>-bootstrap.rsc`. The script creates a
   `wg-easy` user/group, certificates, api-ssl service, firewall rules,
   and a `wg0` WireGuard interface.
4. Back in wg-easy: **Test Connection** → green → **Activate**. Clients
   are now provisioned to the MikroTik.

### Enable obfuscation (host-side)

For one of your MikroTik-bound interfaces:

1. Admin → Interface → Obfuscation → Enable, mode **Host**, listen port
   (e.g. 52000), forward port (51820).
2. Save. wg-easy writes
   `/etc/wireguard/obfuscator/<iface>.conf` and the sidecar picks it up.
3. Distribute clients an obfuscated config (downloaded from wg-easy);
   they connect to `<host>:52000` instead of `:51820`.

To switch to **router-side** obfuscation (RouterOS containers), pick mode
**Router**. Requires `/system/device-mode set container=yes` on the
MikroTik and is more fragile across ROS minor versions — host mode is the
recommended default.

### Embedded DNS

`embedded_dns_enabled` is on by default. wg-easy starts an in-container
`dnsmasq` that listens on the wg interface's gateway address (10.8.0.1 by
default, plus the IPv6 gateway). Clients receive `DNS=10.8.0.1` in their
config and resolve through the container's upstream
(`1.1.1.1, 1.0.0.1` by default; configurable via `dns_upstream` in the
`user_configs_table` row).

If your install needs to bypass embedded DNS (e.g. clients need a corp
resolver), set the user config column `embedded_dns_enabled=0` via SQLite
or the admin UI; clients will get `defaultDns` instead.

## Tagging a release & pushing to ghcr

```bash
git checkout master
git pull
git tag -a v15.4.0-fork.1 -m "Release v15.4.0-fork.1"
git push origin v15.4.0-fork.1
```

The `Fork Image (ghcr)` workflow fires on the tag push, builds amd64 +
arm64, and pushes:

- `ghcr.io/<owner>/wg-easy-fork:v15.4.0-fork.1`
- `ghcr.io/<owner>/wg-easy-fork:latest`
- `ghcr.io/<owner>/wg-easy-fork:sha-<commit>`

Manual dispatch (Actions → Fork Image (ghcr) → Run workflow) cuts a
`manual-<sha>` tag without a git tag.

## Troubleshooting

### "Tunnel up, internet broken" — clients ping the server but nothing else

Almost always one of three things:

1. **iptables backend mismatch.** The image installs both `iptables-nft`
   (default) and `iptables-legacy`. If your host's Docker uses one and
   wg-easy's hooks land in the other, the kernel filter chain has
   `policy drop` and your forwarded packets disappear.
   - Fix: keep the default. Override only if your host genuinely uses
     `iptables-legacy` _and_ Docker matches it. See
     [iptables backend](#iptables-backend).
2. **Wrong egress device.** wg-easy's hooks template `{{device}}` into
   `MASQUERADE -o <dev>`. Default is `eth0`. If your host's default route
   leaves via `br-lan`, `bond0`, `enp0s3`, etc., set the right device in
   Admin → Interface → Device, or override with `WG_DEVICE=<iface>`.
   See [PRD-60-10](docs/obsidian/prds/60-bugfixes/10-auto-detect-egress-device.md)
   for the planned auto-detection.
3. **DNS-only failure.** Clients connect, ICMP works, but DNS doesn't
   resolve. Check `docker exec wg-easy ss -ulnp | grep :53`. If dnsmasq
   isn't listening on the wg gateway IP, embedded DNS bind failed (likely
   address mismatch); check logs.

### iptables backend

```bash
# Inside the container, see which backend is active
docker exec wg-easy iptables --version
# v1.8.x (nf_tables)  -> iptables-nft  (default and recommended)
# v1.8.x (legacy)     -> iptables-legacy

# To override at runtime (use only if your host actually uses legacy):
docker exec wg-easy update-alternatives --set iptables /usr/sbin/iptables-legacy
docker exec wg-easy update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy
docker restart wg-easy
```

### MikroTik bootstrap fails on `/container/mounts`

Use the **.rsc download** path, not the SSH-driven bootstrap wizard, for
RouterOS 7.20+. The wizard's container-deploy step depends on schema
that drifts across ROS minor versions; the `.rsc` is idempotent and
hand-tested. The `.rsc` covers the same setup (user, group, certs,
api-ssl, firewall, wg0).

### Stale session / 401 on every request

After an image rebuild the in-memory session store is wiped. Old browser
cookies don't validate. Clear cookies for the wg-easy origin (or open
incognito) and log in fresh.

## Architecture map (quick)

```
                  ┌─────────────────────────┐
                  │     wg-easy (UI/API)    │
                  │   ┌─────────────────┐   │
                  │   │ Engine drivers  │   │
                  │   │  - WireGuard    │   │      ┌─────────────────┐
                  │   │  - AmneziaWG    │   │      │  MikroTik       │
                  │   │  - BoringTun    │   │ ←──→ │  RouterOS API   │
                  │   │  - MikroTik     │   │      │  /interface/wg  │
                  │   └─────────────────┘   │      └─────────────────┘
                  │   ┌─────────────────┐   │
                  │   │ dnsmasq         │←──┼─── clients (DNS=10.8.0.1)
                  │   └─────────────────┘   │
                  └────────┬────────────────┘
                           │ writes /etc/wireguard/obfuscator/<iface>.conf
                           ▼
                  ┌─────────────────────────┐
                  │  wg-obfuscator sidecar  │←── obfuscated UDP from clients
                  │  (host mode only)       │ ─→ plain WG to MikroTik wg0
                  └─────────────────────────┘
```

## Where to read more

- `docs/obsidian/architecture.md` — system overview & decisions
- `docs/obsidian/decisions/` — ADRs (rust-rewrite no, driver pattern, auth
  model, obfuscation strategy, no-ansible)
- `docs/obsidian/prds/` — feature/bug PRDs by phase
- `docs/obsidian/handoff/orchestration-handoff.md` — live state of the
  fork roadmap
