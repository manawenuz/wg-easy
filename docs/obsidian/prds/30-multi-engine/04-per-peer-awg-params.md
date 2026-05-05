---
id: PRD-30-04
title: Per-peer AmneziaWG parameters (Junk & Padding)
status: approved
phase: P2
depends_on:
  - "[[prds/30-multi-engine/01-amneziawg-promotion]]"
touches:
  - src/app/pages/clients/[id].vue
  - src/server/database/repositories/client/types.ts
  - src/server/database/repositories/client/schema.ts
  - src/server/engines/amneziawg/configgen.ts
  - src/i18n/locales/en.json
---

# PRD-30-04 — Per-peer AmneziaWG parameters

## Why

In high-censorship environments, having all VPN clients share the exact same junk packet count (`Jc`) and padding sizes (`I1–I5`) creates a fingerprint that DPI (Deep Packet Inspection) can potentially block. While the AmneziaWG "magic headers" must match the server, the junk packet sequence is handled independently by the initiator. Providing per-peer overrides allows admins to give different clients different "noise" profiles, making the overall VPN footprint harder to identify.

## User stories

- As an **admin**, I can open a specific client's settings and override the default junk packet count (`Jc`) or padding sizes specifically for that device.
- As a **user**, when I download my config, it includes the unique obfuscation parameters assigned to my device rather than the interface-wide defaults.

## Scope

### In

- **UI Exposure**: Add fields for `Jc`, `Jmin`, `Jmax`, and `I1`–`I5` to the `src/app/pages/clients/[id].vue` form (already partially present but needs wiring for saves).
- **API Support**: Update `ClientUpdateSchema` and `UpdateClientType` in `src/server/database/repositories/client/types.ts` to include these fields so they are no longer omitted during updates.
- **Client Service**: Ensure the `ClientService.update` method handles these fields correctly (Drizzle will handle this automatically once the type is updated).
- **Config Generation**: Verify that `src/server/engines/amneziawg/configgen.ts` correctly prioritizes client-level fields over interface-level defaults (currently implemented but requires testing).

### Out

- Per-peer overrides for `H1–H4` or `S1–S4`. (These **must** match the interface level for the connection to function).
- Bulk randomization of parameters across all clients (out of scope for this phase).

## Data model changes

The fields already exist in `clients_table` (`jC`, `jMin`, `jMax`, `i1`–`i5`). This PRD only involves exposing them to the application logic.

## Verification

- **Unit**: Verify that setting a value on a client and calling `generateClientConfig` results in a config file using the client's values instead of the interface's.
- **Manual**: Update a client's `Jc` to `100`, save, download the config, and verify the `Jc = 100` line is present while the interface default might be `4`.

## Resolution log (2026-05-05)

- **Planned**: Created PRD to formalize the "punted" per-peer parameters from the original AmneziaWG implementation.
