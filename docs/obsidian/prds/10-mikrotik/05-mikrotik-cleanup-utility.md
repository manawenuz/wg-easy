---
id: PRD-10-05
title: MikroTik Resource Tagging & Cleanup Utility
status: draft
phase: P2
depends_on:
  - "[[prds/10-mikrotik/01-mikrotik-driver]]"
  - "[[prds/10-mikrotik/03-mikrotik-obfuscation]]"
touches:
  - src/server/engines/mikrotik/index.ts
  - src/server/engines/mikrotik/obfuscator.ts
  - src/server/engines/mikrotik/bootstrap.ts
  - src/server/engines/mikrotik/configgen.ts
  - src/app/pages/admin/routers/[id].vue
  - src/server/api/admin/router/[id]/cleanup.post.ts (new)
---

# PRD-10-05 — MikroTik Resource Tagging & Cleanup Utility

## Why

As `wg-easy` automates more of the MikroTik configuration (interfaces, peers, NAT, containers, firewall rules), it becomes difficult for an administrator to manually "undo" the changes if they decide to migrate or decommission a router. This can leave "orphaned" configuration fragments on the device. We need a reliable way to tag everything we create and a manual utility to purge those resources without affecting the rest of the router's configuration.

## User stories

- As an **admin**, I want every resource created by `wg-easy` to be clearly labeled so I can distinguish them in WinBox/WebFig.
- As an **admin**, I want a "Cleanup Resources" button in the router settings that removes all tunnels and rules created by this platform.
- As an **admin**, I want to be able to "Full Uninstall" which removes even the WireGuard interfaces and obfuscator containers, leaving only the API user.

## Scope

### In

- **Tagging Convention**: Standardize on a comment/tag: `managed-by-wg-easy`.
- **Instrumentation**: Update all MikroTik engine modules (Peers, Interfaces, Obfuscation, NAT) to include this comment in the `comment` field of every `write` operation.
- **Purge Engine**: A new service method `MikrotikEngine.purgeResources(routerId)` that:
  1. Scans `/interface/wireguard`, `/interface/wireguard/peers`, `/ip/firewall/nat`, `/ip/address`, `/interface/veth`, `/container`, and `/container/mounts`.
  2. Identifies any item where `comment` contains `managed-by-wg-easy`.
  3. Removes them in an order that respects RouterOS dependencies.
- **UI**: A "Maintenance" section in the Router Detail page with a "Cleanup Managed Resources" button.

### Out

- Automatic cleanup on router deletion (handled separately by the "Delete" flow).
- Cleanup of resources created by older versions of `wg-easy` that were not tagged (this is a forward-looking feature).
- Management of the API user/SSH keys themselves (these must be manually removed to avoid locking ourselves out mid-script).

## Technical Approach

### The Tag
Every command sent to the router that creates a resource should include:
`comment: "managed-by-wg-easy"`

### Purge Logic Order
To avoid "Resource in use" errors, the purge must follow this sequence:
1. Stop and remove Containers.
2. Remove NAT rules and Firewall rules.
3. Remove IP addresses.
4. Remove WireGuard Peers.
5. Remove WireGuard Interfaces and VETH interfaces.
6. Remove Container Mounts and Files.

## API Changes

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/admin/router/[id]/cleanup` | admin | Triggers the purge process for a specific router. |

## Verification

- **Unit**: Verify `purgeResources` logic correctly identifies tagged vs untagged items in a mock transport.
- **Integration**: 
  1. Bootstrap a router.
  2. Create 5 clients.
  3. Enable Obfuscation.
  4. Run Cleanup.
  5. Verify via WinBox that all `managed-by-wg-easy` items are gone, but the API user and system identity remain.

## Resolution log

- **Planned**: Initial PRD drafted to address long-term maintainability of MikroTik deployments.
