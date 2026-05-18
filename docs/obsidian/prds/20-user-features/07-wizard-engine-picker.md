---
id: PRD-20-07
title: First-boot setup wizard — let the admin pick the engine
status: backlog
phase: P2
priority: medium
severity: ux (engine selection buried; new admins default to wireguard then have to migrate)
touches:
  - src/app/pages/setup.vue
  - src/app/components/Setup/EnginePicker.vue (new)
  - src/server/api/setup/index.post.ts
  - src/i18n/locales/en.json
---

# PRD-20-07 — Wizard engine picker

## Why

Today, the first-boot setup wizard creates a default `wg0` interface with `engineType = 'wireguard'` and no choice. Admins who want to run the fork's flagship engine (`amneziawg`, `boringtun`, or `mikrotik`) have to:

1. Complete the wizard.
2. Navigate to `/admin/interface`.
3. Switch the engine dropdown.
4. Re-seed obfuscation / connection params.
5. Save, hope nothing breaks (see PRD-60-18 — switching to AmneziaWG via the edit form currently doesn't work cleanly).

This wastes admin time and pushes them through a broken path. The wizard should ask the engine question up-front.

## User stories

- As a **new admin** on first boot, after I set the admin password, the wizard shows me an engine choice: WireGuard (kernel), AmneziaWG (obfuscation), BoringTun (userspace), MikroTik (remote router). Each option has one sentence explaining when to pick it.
- As an **admin** picking AmneziaWG in the wizard, sensible defaults are seeded and the interface is created in one shot — no follow-up trip to `/admin/interface`.
- As an **admin** picking MikroTik, the wizard collects the router host / credentials inline (or links to the dedicated MikroTik setup flow if that's cleaner).
- As an **admin** in doubt, "WireGuard" is the recommended pre-selected default and the wizard finishes in one click.

## Scope

### In

- Add an "Engine" step to the setup wizard between "admin password" and "first interface". Options: `wireguard` (recommended), `amneziawg`, `boringtun`. Skip `mikrotik` from this picker for now (it has too many ancillary fields and warrants its own flow — out of scope).
- The wizard's interface-create call passes `engineType` based on the choice.
- For `amneziawg`, the wizard seeds AmneziaWG recommended defaults (depends on PRD-60-18 landing first — the defaults logic should be the same).
- For `boringtun`, no extra fields needed; just the engine flag.
- Locale keys under `setup.engine.*`.

### Out

- `mikrotik` engine in the wizard. Continue routing operators to the MikroTik setup at `/admin/routers/new` (already exists).
- Multi-interface support in the wizard (still one interface at first boot).
- Engine *switching* on an existing interface — that's PRD-60-18 territory.

## Implementation sketch

```vue
<!-- src/app/components/Setup/EnginePicker.vue -->
<template>
  <FormGroup>
    <FormHeading>{{ t('setup.engine.title') }}</FormHeading>
    <FormRadioGroup v-model="engine" :options="engineOptions" />
    <p class="text-sm">{{ t(`setup.engine.${engine}.description`) }}</p>
  </FormGroup>
</template>
```

```ts
// src/app/pages/setup.vue
const engine = ref<'wireguard'|'amneziawg'|'boringtun'>('wireguard');

async function finishSetup() {
  await $fetch('/api/setup', {
    method: 'POST',
    body: {
      admin: { username, password },
      interface: { name: 'wg0', engineType: engine.value, ...defaultsFor(engine.value) },
    },
  });
}
```

## Verification

- Fresh VM, fresh deploy, no DB. Open `/setup`. Wizard shows engine picker after admin step.
- Pick AmneziaWG, finish wizard. `/admin/interface` shows `engineType=amneziawg`, defaults populated, wg0 listening.
- Pick BoringTun, finish wizard. Same path, `engineType=boringtun`.
- Pick WireGuard. Behaves exactly like today's default.

## Open questions

- Should the wizard let the admin name the interface (`wg0` vs. `awg0` etc.)? Current proposal: no — always `wg0`. Renaming is a separate operation if needed.
- Where does MikroTik live? Today's wizard never offered it; keep that until a dedicated PRD covers the MikroTik first-boot flow.

## Implementer handoff

- Read `src/app/pages/setup.vue` and `src/server/api/setup/index.post.ts` for the current single-shot create.
- Engine defaults: factor out `defaultsFor(engineType)` so PRD-60-18 (edit-form engine switch) can use the same function.

**Estimate:** ~1 day after PRD-60-18 lands.
