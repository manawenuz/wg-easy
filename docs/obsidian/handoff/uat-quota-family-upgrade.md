---
title: UAT — Quota family upgrade (PRD-20-06 + PRD-60-13 + PRD-60-14)
type: uat
covers:
  - "[[prds/20-user-features/06-quota-unit-picker]]"
  - "[[prds/60-bugfixes/13-per-user-aggregate-quota]]"
  - "[[prds/60-bugfixes/14-shared-quota-pool-subaccounts]]"
last_run: 2026-05-18
reproducible: true
---

# UAT — Quota family upgrade

Reproducible end-to-end test for the quota workstream:

- **PRD-20-06** — sub-gigabyte quotas via MB/GB/TB unit picker.
- **PRD-60-13** — per-user aggregate quota (one bucket per user, not per peer).
- **PRD-60-14** — shared family pool (sub-accounts share the root account's bucket).

The scenario also validates **smooth upgrade**: previously enabled clients on the
old per-client quota model must keep working after the migration to per-family.

## Success criteria

1. Upgrade from previous ghcr image (`sha-<prev>`) to the new build runs `0016` and
   `0017` migrations cleanly. No container crash. UI reachable within 30 s of
   container start.
2. Every pre-upgrade enabled client is still enabled and still routes traffic after
   the upgrade.
3. Admin can set a sub-gigabyte quota (e.g., 500 MB) **via the GUI** using the
   MB/GB/TB picker. Saved value matches input bytes-for-bytes.
4. Sub-accounts created before the upgrade now share the parent's bucket. Their
   admin page shows "inherited" and no editable quota form.
5. Driving traffic across the family trips the bucket; **every** family peer is
   disabled in one evaluator tick; audit log has one `family.quota.exceeded` event.
6. VM is torn down at end of run; no orphan Hetzner resources remain.

## Prerequisites (operator side)

| Item | Why |
|------|-----|
| `hcloud` CLI authenticated for the target project | VM provisioning |
| Hetzner SSH key named `wz` registered in the project, with the matching private key on the operator's machine | SSH into the VM |
| Local `docker` (with buildx) on a `linux/amd64`-compatible builder | Building the new image |
| ~5 GB free disk locally for the image tar | Side-load to VM |
| The orchestrator's working tree on the desired test commit | Image build source |

**No credentials in this doc.** All env vars, passwords, and image tokens are
operator-supplied at run time. Replace `<placeholders>` with operator values.

## Topology

```
operator's machine ── SSH (key: wz) ──> wgeasy-quota-uat (cx23 / Debian 12)
                                          │
                                          │  network_mode: host
                                          │  WG UDP 51820, UI TCP 51821 (local)
                                          │
                                          └── wg-easy container + obfuscator sidecar

                                          ▲
                                          │ WG UDP 51820 (public IP)
                                          │
operator's machine ── SSH ──> wgeasy-clients (cx22 / Debian 12)
                                          │
                                          └── 3× linuxserver/wireguard containers
                                              (manwe.conf, manwe-guest.conf, manwe-iot.conf)
                                              running curl-loop downloads
```

A second VM hosts the test clients to keep the server's traffic counters honest
(if clients ran on the same host, NAT loopback could skew accounting).

## Run script

### Phase A — Provision

```bash
# 1. Server (server side)
hcloud server create \
  --type cx23 \
  --image debian-12 \
  --ssh-key wz \
  --location nbg1 \
  --name wgeasy-quota-uat

SERVER_IP=$(hcloud server ip wgeasy-quota-uat)

# 2. Client driver VM
hcloud server create \
  --type cx22 \
  --image debian-12 \
  --ssh-key wz \
  --location nbg1 \
  --name wgeasy-clients

CLIENTS_IP=$(hcloud server ip wgeasy-clients)
```

### Phase B — Install Docker (both VMs)

```bash
ssh root@$SERVER_IP <<'EOF'
set -e
apt-get update
apt-get install -y curl ca-certificates
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg \
  -o /etc/apt/keyrings/docker.asc
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/debian bookworm stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
# AmneziaWG needs the tun module loadable; default Debian has it
modprobe tun || true
EOF

# Same for $CLIENTS_IP.
```

### Phase C — Deploy previous version

```bash
PREV_TAG="sha-5456d94"  # last commit before PRD-60-13/14 land; adjust if needed

scp docker-compose.amnezia.yml root@$SERVER_IP:/root/
ssh root@$SERVER_IP <<EOF
set -e
cd /root
sed -i "s|:edge|:$PREV_TAG|" docker-compose.amnezia.yml
# Generate a strong admin password locally; do NOT commit it
export WG_INITIAL_USERNAME=admin
export WG_INITIAL_PASSWORD="<operator-generates-random-password>"
docker compose -f docker-compose.amnezia.yml up -d
sleep 10
docker compose -f docker-compose.amnezia.yml ps
EOF
```

> The compose file's `image: ghcr.io/manawenuz/wg-easy-fork:edge` is rewritten in
> place to pin the previous SHA. If the image is private, the operator must
> `docker login ghcr.io` on the VM first (PAT held by the operator, not
> committed).

### Phase D — Open the UI

From operator's machine:

```bash
ssh -L 51821:127.0.0.1:51821 root@$SERVER_IP -N &
# Open http://127.0.0.1:51821 in the browser
```

### Phase E — Populate test fixtures (manual GUI)

Log into the admin UI with the initial admin password set in Phase C, then:

1. Create a WireGuard interface named `wg0` with the **AmneziaWG** engine.
   - Public endpoint host: the server's IP (from `$SERVER_IP`).
2. Create users:
   | username | role | parent |
   |----------|------|--------|
   | manwe        | user | —     |
   | manwe-guest  | user | manwe |
   | manwe-iot    | user | manwe |
   | bob          | user | —     |
3. For each user, create one VPN connection (peer). Download the `.conf` files
   to the operator's machine. Keep them out of any committed repo.
4. **Set per-client quotas (old form, GB only)** to validate migration:
   | client      | limit (GB)  | period  | auto-disable |
   |-------------|-------------|---------|--------------|
   | manwe       | 1           | monthly | yes          |
   | manwe-guest | 1           | monthly | yes          |
   | manwe-iot   | 1           | monthly | yes          |
   | bob         | 2           | monthly | yes          |
5. Optional sanity: drive a tiny bit of traffic (one client downloads ~10 MB) so
   the migration has non-zero `used_bytes` to fold.

### Phase F — Build new image locally and side-load

```bash
# On operator's machine, from the wg-easy-fork working tree:
git status  # confirm PRD-60-13 + PRD-60-14 changes are present

docker buildx build \
  --platform linux/amd64 \
  -t wg-easy-fork:uat-quota-family \
  --load \
  .

docker save wg-easy-fork:uat-quota-family \
  | gzip \
  | ssh root@$SERVER_IP 'gunzip | docker load'
```

### Phase G — Upgrade in place

```bash
ssh root@$SERVER_IP <<'EOF'
set -e
cd /root
# Back up the DB before the migration
docker compose -f docker-compose.amnezia.yml exec -T wg-easy \
  sqlite3 /etc/wireguard/wg-easy.db ".backup '/etc/wireguard/wg-easy.db.pre-upgrade'"
# Stop old, swap image, start new
sed -i "s|ghcr.io/manawenuz/wg-easy-fork:[a-z0-9-]*|wg-easy-fork:uat-quota-family|" \
  docker-compose.amnezia.yml
docker compose -f docker-compose.amnezia.yml down
docker compose -f docker-compose.amnezia.yml up -d
sleep 15
docker compose -f docker-compose.amnezia.yml logs --tail 80 wg-easy
EOF
```

Verification queries (run on the VM):

```bash
ssh root@$SERVER_IP "docker compose -f /root/docker-compose.amnezia.yml exec -T wg-easy \
  sqlite3 /etc/wireguard/wg-easy.db '
    SELECT name FROM sqlite_master WHERE type=\"table\" AND name=\"user_quota\";
    SELECT user_id, limit_bytes, period, used_bytes FROM user_quota ORDER BY user_id;
    SELECT name FROM sqlite_master WHERE type=\"table\" AND name=\"quota\";
  '"
```

Expected:
- `user_quota` table exists.
- One row per **root user** (manwe, bob). No row for sub-accounts (manwe-guest,
  manwe-iot) — their pre-upgrade per-client rows folded into manwe's row.
- `manwe` row: `limit_bytes ≈ 3×1024³` (sum of the three folded per-client limits)
  **— this surfaces a real quirk of the migration**: PRD-60-13 §Data model used
  `MAX(limit_bytes)` not `SUM`, but with three rows of 1 GB the result is 1 GB.
  Document whatever the migration actually produces in the run log.
- `quota` table: dropped.

### Phase H — Verify quota features via GUI (manual)

Re-open the SSH tunnel and the UI (browser tab from Phase D). Check:

1. **Sub-GB quota via picker (PRD-20-06).**
   - Open client `bob`. Quota section shows the new picker with default unit `GB`.
   - Change `bob`'s family bucket (his user row, not per-client) to **500 MB**.
     Save. Reload. Field shows `500 MB`, not `0.488 GB`.
   - Try **2 TB** and **1.5 GB** round-trips.
2. **Inherited sub-account view (PRD-60-14).**
   - Open `/admin/users/<manwe-guest-id>`. Quota panel says "Quota inherited
     from parent account" (or "from manwe" if PRD-60-15 has shipped). No
     editable form.
   - Try `curl -X PUT /api/admin/users/<manwe-guest-id>/quota` directly →
     expect HTTP 409.
3. **Family breakdown.**
   - Open `/admin/users/<manwe-id>`. Quota panel shows the family limit.
     The new "Family usage breakdown" panel lists `manwe`, `manwe-guest`,
     `manwe-iot` with their per-period contributions. Numbers sum to the
     family `used_bytes`.

### Phase I — Drive traffic and trip the bucket

On `wgeasy-clients`:

```bash
ssh root@$CLIENTS_IP "mkdir -p /etc/wg-clients"
scp manwe.conf manwe-guest.conf manwe-iot.conf root@$CLIENTS_IP:/etc/wg-clients/

ssh root@$CLIENTS_IP <<'EOF'
set -e
for name in manwe manwe-guest manwe-iot; do
  docker run -d --name wg-$name \
    --cap-add NET_ADMIN --cap-add SYS_MODULE \
    --sysctl net.ipv4.conf.all.src_valid_mark=1 \
    -v /etc/wg-clients/$name.conf:/config/wg_confs/wg0.conf:ro \
    -e PUID=0 -e PGID=0 -e TZ=Etc/UTC \
    lscr.io/linuxserver/wireguard:latest
done
sleep 5
# Drive ~400 MB per client; total 1.2 GB > manwe family bucket (1 GB)
for name in manwe manwe-guest manwe-iot; do
  docker exec wg-$name sh -c \
    'curl -s -o /dev/null https://speed.cloudflare.com/__down?bytes=419430400'
done
EOF
```

Then on the server side, wait one evaluator tick (~60 s, configurable), and
verify:

```bash
ssh root@$SERVER_IP "docker compose -f /root/docker-compose.amnezia.yml exec -T wg-easy \
  sqlite3 /etc/wireguard/wg-easy.db '
    SELECT user_id, used_bytes, disabled_by_quota_at FROM user_quota;
    SELECT id, name, enabled FROM clients_table WHERE user_id IN
      (SELECT id FROM users_table WHERE id IN (SELECT user_id FROM user_quota WHERE disabled_by_quota_at IS NOT NULL)
       OR parent_user_id IN (SELECT user_id FROM user_quota WHERE disabled_by_quota_at IS NOT NULL));
    SELECT action, target FROM audit_logs WHERE action = \"family.quota.exceeded\" ORDER BY id DESC LIMIT 5;
  '"
```

Expected:
- `manwe` row `used_bytes >= 1024³` and `disabled_by_quota_at` is non-null.
- All three family clients (manwe, manwe-guest, manwe-iot) have `enabled = 0`.
- `bob`'s client is still `enabled = 1` (separate family, hit no limit).
- One `family.quota.exceeded` audit row whose `target.disabledClientIds` lists
  exactly the three family client ids.

### Phase J — Tear down

```bash
hcloud server delete wgeasy-quota-uat
hcloud server delete wgeasy-clients
hcloud server list  # confirm both gone
```

Also remove the local `.conf` files (operator) — they contain peer private keys
and are not safe to retain after the test.

## Notes on credentials

- Admin password: set at first boot via `WG_INITIAL_PASSWORD` env var. Generate
  with `openssl rand -base64 24` on the operator's machine; never commit.
- ghcr pull: image is published publicly (per repo settings). If it ever
  becomes private, `docker login ghcr.io` with a personal PAT in the operator's
  hands.
- WireGuard peer private keys are written to the `.conf` files downloaded in
  Phase E. Treat as secrets; delete after the test.

## Quirks & known-fragile spots

- **Migration `0016` field semantics**: `limit_bytes = MAX(...)`, `period =
  MIN(...)`, `used_bytes = SUM(...)`. If admins set per-client quotas with
  *different* limits or periods before the upgrade, the merged row uses the
  largest limit and the alphabetically-first period (`daily` < `monthly` <
  `weekly`). Document what actually happened in the run log.
- **Per-client `PUT/DELETE /api/admin/clients/{id}/quota`** return HTTP 410
  after upgrade. Any external script that still hits these endpoints needs
  updating to the user-level endpoints.
- **NAT loopback if clients run on the same host as the server**: the kernel
  may take a shortcut that skews byte accounting. Always run drivers on a
  separate machine.

## Run log

### 2026-05-18 — initial run

Status: **PASS with bugs caught.**

**Result summary:**
- Provisioned `wgeasy-quota-uat` (cx23, Nuremberg, Debian 12). Docker installed cleanly.
- Deployed `ghcr.io/manawenuz/wg-easy-fork:sha-5456d94` with AmneziaWG compose. UI v15.3.0-beta.2 reachable.
- Operator (manual GUI): created users `manwe` (id=2), `bob` (id=3), `akbar` (id=4); peers `manwe`, `manwe-guest`, `manwe-iot` under user 2 plus `bob`, `akbar` under their own users. Traffic group "500MB" created and applied. No sub-account (`parent_user_id`) hierarchy created — the family scenario was exercised via the multi-peer-per-user model that PRD-60-13 covers; PRD-60-14 family-tree behavior was not exercised this run.
- Upgrade in-place: new image built on the VM (orbstack broken locally), pinned in the compose file, restart cycle.
- **PRD-60-13 + PRD-20-06 validated end-to-end:** manwe's family bucket set to 500 MB via the new MB unit picker. 3 docker WG clients drove 200 MB each (600 MB total) through the tunnel. Usage poller attributed all bytes to user_id 2. Within ~60 s the quota evaluator tripped: `used_bytes = 671 MB (128.1%)`, `disabled_by_quota_at` set, all 3 family clients toggled `enabled=0`, single audit event `family.quota.exceeded` with `disabledClientIds:[1,2,3]`. bob (id=3) and akbar (id=4) untouched.
- VM destroyed; no orphan Hetzner resources remain.

**Bugs caught (critical):**

1. **Migration 0016 missing `--> statement-breakpoint` markers.** Drizzle's libsql migrator runs each statement separately, using the marker as a separator. Without it, only the first statement (`CREATE TABLE user_quota`) ran; the `INSERT FROM quota` and `DROP TABLE quota` were silently skipped. **Fixed** in this run: added breakpoints to `0016_per_user_quota.sql` and added corrective migration `0018_fixup_quota_drop.sql` which drops the orphaned legacy `quota` table for installs already past broken 0016. New authoring rule: every multi-statement migration must use `--> statement-breakpoint` between statements (matches the convention from `0000`–`0015`).

2. **libsql migrator chokes on SQL comments preceding DDL.** Initial 0018 had a comment block at the top and ran with `SQLITE_UNKNOWN_0: not an error` — a generic libsql failure that surfaces when the migration text trips internal parsing. Simplified 0018 to a bare `DROP TABLE IF EXISTS quota;` to bypass. Worth filing a libsql upstream issue; in the meantime: migration files SHOULD be bare DDL/DML with no leading comment blocks before the first statement.

3. **Operator-reported during UAT (spun out to new PRDs, not blockers for the upgrade test):**
   - Upstream "There is an update available!" banner is leaking through; should be suppressed for fork users.
   - AmneziaWG: interface edit form has invalid default values for the obfuscation parameters (H1–H4 = 0, S3/S4/I1–I5 empty); save fails with "must be a valid number or number range" ×4. Operator could not switch from wireguard → amneziawg engine on an existing interface.
   - First-boot setup wizard does not let the admin pick an engine — defaults to `wireguard`. Engine selection is buried under `/admin/interface` after setup.
   - `/admin/users/{id}` occasionally 500s with `<SelectItem /> must have a value prop that is not an empty string` — a Reka UI dropdown is receiving an empty-value option (likely the traffic-group or speed-limit selector when the user has none set).
   - `BaseSelect` dropdown items render as `value - label` (e.g., `MB - MB`, `daily - Daily`) — pre-existing component template bug, now visible in two new places (quota period and quota unit dropdowns).
   - Period dropdown only offers `daily`/`weekly`/`monthly`. Operator wants a `lifetime` option ("never resets"; quota is one-shot for the user's account lifetime).
   - "Monthly" period currently means "rolling 30 days" (resets in 13d on day 17 of the month), not "1st of month". Operator considers this a documentation issue, not a defect — but worth surfacing.

**Recommended actions before pushing the proper ghcr image:**
1. Land the migration fixes (`0016` breakpoints + `0018` cleanup) as a single commit — they unblock every production upgrade.
2. Land PRD-60-18 (AmneziaWG validation defaults) — operator-flagged blocker for the fork's flagship engine.
3. Land the other operator-flagged fixes (60-17 update banner, 60-19 migration authoring guard, 20-07 wizard engine, 20-08 lifetime period) per priority.
4. Tag `v15.3.0-beta.3-fork` and let the GitHub Actions workflow build the proper multi-arch ghcr image.
