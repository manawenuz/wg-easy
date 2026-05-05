---
id: PRD-60-10
title: Auto-detect default egress device for MASQUERADE / hooks
status: draft
phase: P1
depends_on:
  - "[[prds/00-foundation/01-multi-engine-driver-pattern]]"
touches:
  - src/server/utils/netDetect.ts (new)
  - src/server/utils/netDetect.test.ts (new)
  - src/server/database/sqlite.ts (call netDetect during initialSetup)
  - src/server/database/repositories/interface/service.ts (defaultDevice helper)
  - src/server/utils/config.ts (WG_DEVICE env override)
  - src/server/engines/wireguard/index.ts (re-detect on bringUp if device is stale)
  - src/server/engines/amneziawg/index.ts (same)
  - src/app/pages/admin/interface.vue (show detected device + override)
  - src/i18n/locales/en.json
---

# PRD-60-10 — Auto-detect default egress device for MASQUERADE / hooks

> The interface row defaults `device='eth0'` because that's the convention
> on most cloud VMs. On hosts with a different WAN interface — bridged
> (`br-lan`), bonded (`bond0`), VLAN-tagged (`eth0.10`), or VPN-style
> (`wg-up`, `tun0`) — the default `iptables -t nat -A POSTROUTING -o eth0`
> rule never matches outgoing client traffic and clients connect to the
> server but get no internet. This bites every operator on a non-cloud
> host on first install and produces a confusing failure mode (tunnel
> negotiates, ICMP to 10.8.0.1 works, traffic to 1.1.1.1 silently drops).

## Why

- **Right answer is automatic on 95% of hosts.** The WAN interface is
  always the one carrying the default route; reading it is one syscall.
  Forcing every operator to discover this and override the form field is
  bad UX *and* a frequent support issue.
- **Failure mode is silent.** No error in wg-easy logs, no error in WG
  logs — the packets just leave with src=10.8.0.x and don't come back.
  Users debug for hours, blame the engine, blame the firewall, blame the
  app. The only signal is `iptables -L -n -v` showing zero packets matched
  on POSTROUTING.
- **Hooks templating is shared.** The same `{{device}}` value is templated
  into every hook (`PostUp`, `PreDown`, masquerade rules, FORWARD allow
  rules). Getting it right once at install time fixes everything
  downstream.

## User stories

- **As an operator running `docker compose up -d` on a non-cloud host**
  (homelab, MikroTik switch behind a Linux box, OpenWrt-on-x86, bridged
  Proxmox VM), the interface comes up with the correct `device` for my
  host's default route. I don't have to discover the iptables rule
  doesn't fire, then hunt for the form field, then restart.
- **As an admin in the UI**, I see "Detected: br-lan" next to the Device
  field, so I know what wg-easy chose and can override if it's wrong.
- **As an operator on a multi-WAN host**, I set `WG_DEVICE=eth0` in
  `docker-compose.yml` and that wins over auto-detect.

## Out of scope

- Multi-egress / policy routing (PRD-40-03 — multi-path routing).
  Today's PRD is single egress; if your host has two and you want
  different peers to use different ones, that's a different feature.
- IPv6 egress detection independent of IPv4. We assume the same device
  carries the v4 and v6 default routes, which is true on every common
  host. If they diverge, override manually.
- Detection of bridge members vs bridge itself. `br-lan` is the right
  answer for hosts where `br-lan` carries the default route, even if
  `eth0` is the underlying physical port.

## Detection algorithm

```ts
// src/server/utils/netDetect.ts
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

export async function detectDefaultEgressDevice(): Promise<string | null> {
  // Source of truth: the device on the IPv4 default route.
  // `ip route show default` output: "default via 1.2.3.4 dev eth0 proto dhcp ..."
  const { stdout } = await promisify(exec)('ip route show default', { timeout: 2000 });
  const match = stdout.match(/\bdev\s+(\S+)/);
  return match?.[1] ?? null;
}
```

Resolution order at install time:

1. `WG_DEVICE` env var (operator override) — highest priority.
2. `detectDefaultEgressDevice()` — set during `initialSetup` if it
   returns a non-null value.
3. `'eth0'` — last resort, matches today's behavior.

The detected value is written to `interfaces_table.device` once during
initial setup. After that, the operator's stored value wins on every
restart — auto-detect doesn't fight admin overrides.

## Re-detection on engine bringUp

Hosts can change WAN interfaces (DHCP renew swaps device names on some
distros, Ubuntu predictable names, network manager tweaks). If
`bringUp()` finds the stored `device` no longer exists on the system,
re-run detection and update the row before templating hooks. Log a
warning so the operator notices.

```ts
// inside engine.bringUp(), before applying iptables hooks:
if (!await deviceExists(iface.device)) {
  const detected = await detectDefaultEgressDevice();
  if (detected && detected !== iface.device) {
    console.warn(
      `[netDetect] stored device '${iface.device}' no longer exists; ` +
      `auto-detected '${detected}' from default route. Updating interface.`
    );
    await Database.interfaces.update({ device: detected });
    iface.device = detected;
  }
}
```

This is **only** triggered when the stored value is broken, not on
every bringUp — operators who explicitly chose a non-default-route
device (e.g., a secondary egress for a specific use case) keep their
choice.

## UI

`admin/interface.vue` Device field:

- Renders an info chip "Auto-detected: `br-lan`" next to the input when
  the stored value matches the live detection.
- Renders a warning chip "Override active (auto-detect would pick
  `br-lan`)" when they differ.
- Renders an error chip "Device not found on host" when the stored
  device doesn't exist (e.g., host's NIC was renamed).

The detected value is fetched from `GET /api/admin/interface/detected-device`
which returns `{ device: string | null }`. Cheap call, no caching beyond
HTTP.

## Acceptance tests

1. **Cloud install** — `eth0` carries the default route. Fresh wg-easy
   install picks `device='eth0'`. Existing setups upgrade unchanged.
2. **Bridged host** — `br-lan` carries the default route on a Proxmox /
   homelab box. Fresh install picks `device='br-lan'`. iptables
   POSTROUTING rule matches outgoing client traffic on first connection.
3. **Override** — `WG_DEVICE=ens3` in compose. Auto-detect runs, returns
   `eth0`, the env var wins, `device='ens3'` stored.
4. **Stale rebound** — install picked `eth0`, host rename to `enp0s3`.
   `bringUp()` detects mismatch, logs warning, updates to `enp0s3`,
   templates hooks with the new value.
5. **No default route** — install on a host with `ip route show default`
   empty (rare but possible during early boot). Detection returns null;
   we fall back to `eth0`. Operator sees the warning chip in the UI.
6. **Existing setup** — upgrades without re-detect: a working
   `device='eth0'` install stays as is. Auto-detect doesn't second-guess
   an admin choice.

## Migration plan

- No schema change. Existing rows keep their stored `device`.
- `initialSetup()` calls `detectDefaultEgressDevice()` only when
  inserting the *first* interface row. Subsequent installs don't change
  existing rows.
- Operators with a stuck wrong default can clear the field via the UI
  or set `WG_DEVICE` and restart.

## Risks & follow-ups

- **`ip route` not in PATH inside the container.** It's already there
  (iproute2 package is installed for `wg-quick`), but worth a runtime
  check; fall back to `eth0` and log if missing.
- **Misleading detection on dual-stack hosts where v4 and v6 default
  routes go via different devices.** Rare in practice; document the
  WG_DEVICE override as the answer.
- **Sub-interfaces on bonded NICs.** Bonded `bond0` is fine; VLAN
  `eth0.10` is fine. Anything more exotic (FDB-based VRF, namespaces)
  needs a manual override.
- **Host network mode assumption.** wg-easy runs with
  `network_mode: host`, so we read the host's routes. If someone runs
  wg-easy in bridge mode (PRD-40-01 federation case), this detector
  reads the wrong host. Documented as a host-network requirement.
