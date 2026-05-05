---
id: PRD-10-07
title: Host-side wg-obfuscator sidecar (alternative to router-side container)
status: draft
phase: P1
depends_on:
  - "[[prds/10-mikrotik/03-mikrotik-obfuscation-refactor]]"
touches:
  - src/server/database/repositories/wgObfuscatorConfig/schema.ts
  - src/server/database/repositories/wgObfuscatorConfig/types.ts
  - src/server/api/admin/interface/[id]/obfuscation.put.ts
  - src/server/engines/mikrotik/obfuscator.ts (extract router-side flow into deployRouterObfuscator())
  - src/server/services/hostObfuscator.ts (new)
  - src/server/services/hostObfuscator.test.ts (new)
  - src/server/utils/config.ts (add HOST_OBFUSCATOR_* envs)
  - docker-compose.yml (new wg-obfuscator sidecar service)
  - src/app/components/Interfaces/ObfuscationForm.vue (add deployment-mode picker)
  - src/i18n/locales/en.json
---

# PRD-10-07 — Host-side wg-obfuscator sidecar

> Today the wg-easy fork only supports running `wg-obfuscator` *inside the
> MikroTik* via RouterOS containers. That works on x86 CHRs with
> `/system/device-mode container=yes` and enough RAM, but is fragile in
> practice: container support is locked behind device-mode flips, image
> pulls go through the router, the `/container/*` API surface drifts
> between RouterOS minor versions (`name=` rejected on `/container/add` in
> 7.22, `/container/mounts add` schema differences, etc.), and debugging
> requires SSH into the router to read container logs.
>
> A wg-easy *host-side* sidecar is a strictly better default for most
> deployments: clients hit `<wg-easy-host>:<obf-port>`, the host-side
> obfuscator decapsulates and forwards plain WG to `<mikrotik>:51820`, and
> the obfuscator runs as a normal Docker container in the same compose file
> as wg-easy itself. Router-side stays as an option for the case where the
> operator specifically wants the obfuscator to live on the same box as the
> WG terminator (no inter-host UDP hop).

## Why

- **Reliability:** standard Linux Docker is a far more uniform target than
  RouterOS container support. No device-mode flips, no image-pull-via-router
  failure modes, no ROS-version-specific schema drift.
- **Debuggability:** `docker logs wg-obfuscator` from manwehs is one
  command; the equivalent on a router requires SSH and a different log path
  per ROS version.
- **Independence from MikroTik versions:** new RouterOS releases that
  rename `/container/*` properties don't break the obfuscator deploy.
- **Data path is unchanged for clients:** they still see a single UDP
  endpoint; whether it lives on the wg-easy host or the router is opaque
  to them.

## User stories

- **As an operator deploying a new wg-easy + MikroTik combo**, I leave the
  default `obfuscation.deploymentMode = host` and the obfuscator sidecar
  comes up next to wg-easy via Docker Compose. No RouterOS container
  configuration required.
- **As an admin enabling obfuscation in the UI**, I pick "Host (sidecar)"
  or "Router (RouterOS container)". The form switches its hints
  accordingly. Either flow ends with a copy-paste client `.conf` and a
  working tunnel.
- **As an operator who does want everything on the router**, I can still
  pick "Router" and the existing flow runs unchanged — the host-side path
  is additive, not a replacement.

## Out of scope

- Replacing wg-obfuscator with a different obfuscation library. Keep
  `clustermeerkat/wg-obfuscator` as the upstream.
- Multi-host wg-easy (federated sidecars). Today's host-side flow assumes
  the obfuscator runs on the *same* host as wg-easy; cross-host sidecar
  routing is part of [[prds/40-multi-server/01-multi-router-federation|PRD-40-01]].
- Auto-discovery / port allocation. Operator picks the listen port; wg-easy
  validates it's free at write-time.

## Data model

```sql
ALTER TABLE wg_obfuscator_config ADD COLUMN deployment_mode TEXT NOT NULL DEFAULT 'router';
  -- 'router' = current behavior (container on MikroTik)
  -- 'host'   = sidecar on the wg-easy host
ALTER TABLE wg_obfuscator_config ADD COLUMN host_endpoint TEXT;
  -- The address clients should target for host-mode. Usually the
  -- public hostname/IP of the wg-easy box. Defaults to the value of
  -- WG_HOST env. Stored explicitly so multi-host deployments can override.
```

`router_queue_id` is unused for host mode; `key`, `dummy_padding_*`,
`listen_port`, `wg_target_port` keep their meaning across both modes.

## Architecture

### Host mode (`deployment_mode='host'`)

```
client ──udp:<obf-port>──▶ wg-easy host
                          (wg-obfuscator sidecar container)
                          ──udp:51820──▶ mikrotik wg0
```

- `clustermeerkat/wg-obfuscator` runs as a sibling service in
  `docker-compose.yml`, e.g.:

  ```yaml
  wg-obfuscator:
    image: clustermeerkat/wg-obfuscator:latest
    network_mode: host
    volumes:
      - ./obfuscator-config:/etc/wg-obfuscator:ro
    restart: unless-stopped
    depends_on:
      - wg-easy
  ```

- wg-easy writes
  `/etc/wireguard/obfuscator/<iface>.conf` (volume-mounted into the
  sidecar) on enable / config change. The sidecar watches the config dir
  and reloads (or wg-easy issues a `docker kill -s HUP wg-obfuscator`).

- wg-easy never `docker run`s the sidecar itself. The operator declares it
  in compose; we keep the orchestrator out of the docker control plane.
  Wg-easy only manages the **config** file.

### Router mode (`deployment_mode='router'`)

Unchanged from PRD-10-03. Still useful for ROS x86 with abundant
container resources or for operators who want zero traffic on the
wg-easy host's data path.

### Mode selection logic

If the operator hasn't picked a mode in the UI, default by router model
fingerprint:
- ROS x86 with container=yes and free-memory > 256MB → suggest `router`
- ROS ARM/MIPS or container=no → force `host`

Override always available in the UI.

## API

`PUT /api/admin/interface/:id/obfuscation` body gains:

```ts
{
  enabled: boolean;
  deploymentMode: 'router' | 'host';   // required when enabled=true
  listenPort: number;                  // applies to both modes
  wgTargetPort: number;                // applies to both modes
  hostEndpoint?: string;               // host-mode: defaults to WG_HOST env
  key?: string;
  dummyPaddingMin?: number;
  dummyPaddingMax?: number;
  // Removed for host mode (deploy is operator-managed):
  // deployEnabled — host mode has no per-call deploy toggle, only the
  // sidecar service's running state in compose.
}
```

Server side:

- `deploymentMode='host'` → call `hostObfuscator.writeConfig(iface, cfg)`
  to atomically write (`<dir>/<iface>.conf.tmp` → rename) the config and
  optionally `docker kill -s HUP <container>` if `HOST_OBFUSCATOR_RELOAD_CMD`
  is set. If the container isn't running, return success anyway — bringing
  the service up is the operator's concern.
- `deploymentMode='router'` → existing `engine.deployObfuscator()` flow.

## UI

`InterfacesObfuscationForm.vue` gains a deployment-mode select with two
options ("Host sidecar" / "Router (RouterOS container)") and:

- Hints under each option spelling out the trade-offs.
- For host mode: a read-only "Service status" badge (best-effort: green if
  the configured port is reachable from wg-easy, amber otherwise).
- For router mode: keep the existing `deployEnabled` toggle and warnings.

The generated client `.conf` block uses `hostEndpoint` (host mode) or
`router.host` (router mode) for the `target=` line — same client-side
script either way.

## Sequence: enable host-side obfuscation

```mermaid
sequenceDiagram
  Admin ->> UI: Enable obfuscation; mode=host; port=52000
  UI ->> Server: PUT /admin/interface/wg0/obfuscation
  Server ->> Server: write /etc/wireguard/obfuscator/wg0.conf
  Server ->> Sidecar: optional SIGHUP via docker kill (if available)
  Server ->> DB: upsert wg_obfuscator_config
  Server -->> UI: 200 ok
  Admin ->> UI: Download client .conf
  Admin ->> Client: install
  Client ->> Sidecar: udp:52000 (obfuscated)
  Sidecar ->> MikroTik: udp:51820 (plain WG)
  MikroTik ->> Client: WG handshake response (reverse path)
```

## Acceptance tests

1. **Host mode, fresh enable** — install a fresh wg-easy + obfuscator
   sidecar via `docker-compose up -d`. Enable obfuscation with
   `mode=host port=52000`. Verify a wg-obfuscator-enabled client
   completes the WG handshake and traffic flows.
2. **Host-mode key rotation** — toggle `key` in the UI, verify the
   sidecar config is rewritten atomically and the next handshake on the
   new key succeeds; the old key's handshake fails fast.
3. **Mode switch host → router** — switch a working host-mode interface
   to router mode. The router-side deploy flow runs; the host-side
   sidecar config is removed. Existing clients fail until reissued (this
   is expected: the obfuscation key may differ).
4. **Mode switch router → host** — reverse path. Router-side artefacts
   (container, veth, dstnat) get cleaned up by the existing
   `removeObfuscator` flow; host-side config is written.
5. **Sidecar absent** — host mode is enabled but the sidecar service
   isn't running in compose. PUT still returns 200 (config written), and
   the UI shows "Service unreachable" status. Documented as the
   operator's job to bring it up.
6. **MikroTik schema drift** — host mode is unaffected by RouterOS
   `/container/*` schema changes; an upgrade from 7.20 → 7.22 doesn't
   break a host-mode setup.

## Migration plan

- `0011_obfuscator_deployment_mode.sql` adds the columns and defaults
  `deployment_mode='router'` for existing rows so behavior is unchanged
  on upgrade.
- The new "Host (recommended)" radio in the UI is the default for fresh
  enables. Existing `router`-mode setups stay the way they are; switching
  is explicit.

## Risks & follow-ups

- **Config volume permissions.** The sidecar runs as a different uid
  than wg-easy by default; the shared volume needs `chmod` setup so both
  can read/write. Document in compose example; consider a one-shot
  `chown` init container if it bites.
- **Reload semantics.** If `wg-obfuscator` doesn't honor SIGHUP for
  config reload (older builds didn't), we may need to `docker restart`
  the sidecar — heavier but reliable. Investigate before merge.
- **Multiple interfaces, single sidecar.** wg-obfuscator's config is
  single-tunnel today. For wg-easy with multiple obfuscated interfaces
  we either run N sidecars or wait for upstream multi-tunnel support.
  PRD-30-05 (multi-interface) lands first; this PRD picks the single-
  sidecar path and revisits when wg-obfuscator gains multi-tunnel.
- **Public IP / DNS for hostEndpoint.** Most installs already have
  `WG_HOST` set; reuse it as the default. For split-horizon (internal
  vs. external clients), allow a per-interface override (already in the
  schema as `host_endpoint`).
