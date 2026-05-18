---
id: PRD-60-18
title: AmneziaWG interface edit form has invalid defaults; cannot switch engine to AmneziaWG
status: backlog
phase: P1
priority: high
severity: functional blocker (cannot use the fork's flagship obfuscation engine via UI)
touches:
  - src/app/pages/admin/interface.vue
  - src/app/components/Interface/AmneziaWGFields.vue
  - src/server/api/admin/interface/index.put.ts
  - src/server/database/repositories/interface/types.ts
  - src/server/engines/amneziawg/configgen.ts
---

# PRD-60-18 — AmneziaWG interface edit validation defaults

## Why

Operator-reported during 2026-05-18 UAT: after setup wizard creates a default `wireguard` interface, admin navigates to `/admin/interface`, picks `amneziawg` from the engine dropdown to switch obfuscation on, sees the AmneziaWG parameter block render with these defaults:

| field | default rendered |
|-------|------------------|
| Init magic header (H1) | `0` |
| Response magic header (H2) | `0` |
| Cookie reply magic header (H3) | `0` |
| Transport magic header (H4) | `0` |
| Init packet junk size (S1) | empty |
| Response packet junk size (S2) | empty |
| Cookie reply packet junk size (S3) | empty |
| Transport packet junk size (S4) | empty |
| Special junk packet 1–5 (I1–I5) | empty |

Saving fails with four toasts: **"must be a valid number or number range"** ×4 (likely the S1/S2/S3/S4 empty inputs hitting a number-or-range validator).

The admin is stuck — they cannot enable AmneziaWG via the UI without manually entering arbitrary values for parameters they don't understand. The fork's flagship obfuscation feature is effectively gated behind a wizard step that doesn't exist (see PRD-20-07).

## Root cause

The AmneziaWG params have two valid shapes:
- **Empty / null** → omit from generated `wg0.conf`, behaves like vanilla WireGuard for that field (server lets clients negotiate)
- **Specific number or `min-max` range** → AmneziaWG's `Jc`, `S1`, etc. params

The current form's validator treats empty inputs as invalid. It should treat empty as "leave unset" (which is the correct, common case for most operators).

For the H1–H4 fields, `0` is documented as "use AmneziaWG default magic header" — but the form should seed AmneziaWG's recommended default values, not 0, so a one-click save produces a working obfuscated tunnel.

## User stories

- As an **admin** switching an existing interface from `wireguard` → `amneziawg`, clicking Save with all-empty AmneziaWG fields produces a working interface using AmneziaWG's recommended defaults. The interface's clients reconnect with obfuscation enabled.
- As an **admin** who wants to tune parameters, I can override any field. Empty means "use default"; a value or range means "use this exact tuning".
- As an **admin**, if I enter something that's genuinely invalid (e.g., `foo` or `5-3` reversed range), the form rejects with a precise field-level error, not a generic "must be a valid number or number range" toast.

## Scope

### In

- **Validation fix**: empty input on S1–S4 and I1–I5 = valid; treat as null at the API layer. The PUT endpoint should accept missing/null/empty for these fields and persist them as null.
- **Seed defaults**: when switching engine to `amneziawg` for the first time (existing interface had `engineType=wireguard`), pre-populate H1–H4 with AmneziaWG's recommended random magic headers (canonical example values from the AmneziaWG project; or generate fresh randoms server-side). S1/S2 should default to small randomized junk-packet sizes (e.g., `15-30`).
- **Server-side configgen update**: when generating the wg0.conf for an AmneziaWG engine, omit any field that's null (vs. writing literal `0` or empty string).
- **Field-level errors**: the "must be a valid number or number range" toast should attach to the specific field that failed, not aggregate four toasts at the top.

### Out

- A dedicated "obfuscation tuning wizard" with explanations of each field. Out — operators who care can read AmneziaWG docs.
- Changing the engine model (still `wireguard` | `amneziawg` | `boringtun` | `mikrotik`).
- Default values for `Jmin`/`Jmax` (the most-obscure AmneziaWG params) — keep nullable.

## Implementation sketch

```ts
// types.ts — make all AWG fields nullable
amneziawgInitPacketMagicHeader: int().nullable(),
amneziawgInitPacketJunkSize: text().nullable(), // 'N' or 'min-max'
// ... etc

// AmneziaWGFields.vue
const validateJunkSize = (v: string | null) => {
  if (v === null || v === '') return true;           // empty = null = valid
  if (/^\d+$/.test(v)) return true;                  // single number
  const m = v.match(/^(\d+)-(\d+)$/);
  if (m && +m[1] <= +m[2]) return true;              // ordered range
  return 'Use a number (e.g., 20) or range (e.g., 15-30)';
};

// On engine switch wireguard -> amneziawg, seed:
function seedAmneziaDefaults(form) {
  form.amneziawgInitPacketMagicHeader   ??= randomMagic();
  form.amneziawgResponsePacketMagicHeader ??= randomMagic();
  // H3, H4 likewise
  form.amneziawgInitPacketJunkSize  ??= '15-30';
  form.amneziawgResponsePacketJunkSize ??= '15-30';
  // S3, S4, I1-I5 stay null
}
```

## Verification

1. Fresh setup wizard → default wireguard interface created.
2. Navigate to `/admin/interface`, switch engine dropdown to `amneziawg`. Form re-renders with H1–H4 populated, S1/S2 = `15-30`, S3/S4/I1–I5 empty.
3. Click Save. Interface persists; wg0.conf regenerated with the AmneziaWG params; clients reconnect (or admin downloads new configs).
4. Edit again, blank out S1. Save. wg0.conf no longer has S1; tunnel still works.
5. Enter `5-3` into S1. Save. Field-level error fires inline, no toast.

## Open questions

- Are existing clients valid against AmneziaWG without rotation of keys? (PRD-30-01 / 30-04 should already cover this — assume yes.)
- Should the H1–H4 defaults be **fixed** (deterministic, matches AmneziaWG examples for cross-implementation compatibility) or **random per server** (better obfuscation, but harder to debug)? Default to fixed canonical values; admins can rotate.

## Implementer handoff

- Read `src/server/engines/amneziawg/configgen.ts` for the canonical AmneziaWG param names.
- The validator may live in `src/app/composables/useFormValidation.ts` or be inline in the AmneziaWGFields component.
- AmneziaWG canonical recommended defaults: see `https://github.com/amnezia-vpn/amneziawg-go/blob/master/README.md`.

**Estimate:** ~half a day.
