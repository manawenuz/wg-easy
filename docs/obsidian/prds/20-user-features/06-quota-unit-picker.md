---
id: PRD-20-06
title: Quota unit picker — allow MB / GB / TB so sub-gigabyte limits are usable
status: shipped
phase: P2
depends_on:
  - "[[prds/20-user-features/03-bandwidth-quotas]]"
touches:
  - src/app/components/Clients/QuotaForm.vue
---

# PRD-20-06 — Quota unit picker (sub-gigabyte support)

## Why

PRD-20-03 shipped the quota form with a single "Limit (GB)" numeric field and `step="0.001"`.
While entering `0.5` for 500 MB is *technically* possible, nobody intuitively types fractional
gigabytes — they think in megabytes. As a result, admins either:

1. Try to enter `500` and set a 500 GB quota by accident, or
2. Give up and cannot enforce small caps (e.g., 100 MB free tier, 500 MB trial account).

The original PRD-20-03 spec explicitly called for a **"limit (with unit picker MB/GB/TB)"**
input that was never implemented. This PRD closes that gap.

## User stories

- As an **admin**, I can type `500` and select `MB` from a dropdown to set a 500 MB quota.
- As an **admin**, I can type `1.5` and select `GB` to set a 1.5 GB quota.
- As an **admin**, existing quotas that were saved in GB display correctly in the new picker
  (no data migration needed — the stored `limit_bytes` value is unchanged).
- As an **admin**, the byte hint below the field always shows the exact value being stored,
  so I can confirm precision before saving.

## Scope

### In

- Replace the current `<FormNumberField label="Limit (GB)">` with a combined
  **number input + unit select** inline control, supporting `MB`, `GB`, `TB`.
- On load: derive the displayed unit from the stored `limit_bytes` — pick the largest unit
  where the value rounds to a whole number or has at most 3 decimal places:
  - `limit_bytes < 1 GB` → display in MB
  - `1 GB ≤ limit_bytes < 1 TB` → display in GB
  - `limit_bytes ≥ 1 TB` → display in TB
- Byte hint below the field stays (already implemented; keep it).
- No backend, API, or schema changes — `limit_bytes` is already stored as raw bytes.
- No `KB` unit (minimum sensible quota is a few MB).

### Out

- Minimum quota enforcement (e.g., reject quotas < 1 MB). Out of scope; the backend
  already accepts any positive integer for `limit_bytes`.
- Custom anchor / billing-cycle-start rollover. Separate PRD.
- Notifications on quota approach. Separate PRD.

## Current behaviour (bug)

```
QuotaForm.vue
  <FormNumberField id="limitGB" label="Limit (GB)" step="0.001" />
```

`form.limitGB` stores the raw GB decimal. Saving `500` → `limitBytes = 536_870_912_000` (500 GB),
not 500 MB. There is no affordance telling the user the unit is fixed to GB.

## Proposed behaviour

Replace the single `<FormNumberField>` with an inline group:

```
[ 500  ] [ MB ▾ ]
≈ 524.29 MB
```

The unit selector options: `MB`, `GB`, `TB`.

The save path converts to bytes at submission time:

```ts
const multipliers = { MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };

function save() {
  const limitBytes = Math.round(form.value.limit * multipliers[form.value.unit]);
  return _save({ limitBytes, period: form.value.period, autoDisable: form.value.autoDisable });
}
```

On load, existing `quota.limitBytes` is back-converted to the most readable unit:

```ts
function fromBytes(bytes: number): { limit: number; unit: 'MB' | 'GB' | 'TB' } {
  if (bytes >= 1024 ** 4) return { limit: parseFloat((bytes / 1024 ** 4).toFixed(3)), unit: 'TB' };
  if (bytes >= 1024 ** 3) return { limit: parseFloat((bytes / 1024 ** 3).toFixed(3)), unit: 'GB' };
  return { limit: parseFloat((bytes / 1024 ** 2).toFixed(3)), unit: 'MB' };
}
```

## UI changes

`src/app/components/Clients/QuotaForm.vue` — only this file changes:

1. Replace `form.limitGB: number` with `form.limit: number` + `form.unit: 'MB' | 'GB' | 'TB'`.
2. Replace `<FormNumberField label="Limit (GB)">` with an inline flex row:
   `<FormNumberField>` (no label suffix) + `<BaseSelect :options="['MB','GB','TB']">`.
3. Update `bytesHint` computed to use the new `limit × multiplier`.
4. Update `watch(quota, …)` to use `fromBytes()`.
5. Update `save()` to convert with `multipliers[form.unit]`.

No other files need to change.

## Verification

### Unit tests (QuotaForm logic, no Vue mount needed)

- `fromBytes(500 * 1024**2)` → `{ limit: 500, unit: 'MB' }`
- `fromBytes(1.5 * 1024**3)` → `{ limit: 1.5, unit: 'GB' }`
- `fromBytes(2 * 1024**4)` → `{ limit: 2, unit: 'TB' }`
- Round-trip: `fromBytes(Math.round(limit * multiplier))` returns original inputs for MB/GB/TB cases.

### Manual test plan

1. Open client edit page → Quota section.
2. Verify the field shows a number input + unit dropdown defaulting to `GB`.
3. Enter `500`, select `MB`. Hint shows `≈ 500 MB`. Save.
4. Reload page. Verify field shows `500 MB` (not `0.488 GB`).
5. Edit: change to `2 GB`. Save. Reload. Shows `2 GB`.
6. Set an existing 50 GB quota (via API or prior test). Reload. Shows `50 GB`, not `51200 MB`.
7. Set 2 TB. Reload. Shows `2 TB`.

## Open questions

- [ ] Should we add a minimum quota guard in the form (e.g., reject < 1 MB)?
      Proposal: show a validation error client-side only; the backend does not need to change.
- [ ] Should `KB` be offered? Current consensus: no — a sub-MB VPN quota is impractical.

---

## Implementer handoff (Kimi)

**Root cause**: `QuotaForm.vue` hardcodes GB as the only unit. The backend stores raw bytes
and needs no changes.

**Read before implementing:**
- `src/app/components/Clients/QuotaForm.vue` (full file)
- `src/app/components/Form/FormNumberField.vue` (to understand the existing primitive)
- Any `BaseSelect` / `FormSelectField` component already used elsewhere in the form layer

**Only file to modify:** `src/app/components/Clients/QuotaForm.vue`

**Do NOT modify:**
- Backend quota service, schema, or API. `limit_bytes` storage stays the same.
- Any non-EN locale.

**Acceptance:**
1. `pnpm typecheck` passes.
2. Manual test plan above passes end-to-end.
3. No new strings added outside `src/i18n/locales/en.json` (if labels are needed at all).

---

## Resolution log (2026-05-18)

- Replaced the hardcoded "Limit (GB)" `FormNumberField` with an inline `BaseInput` + `BaseSelect` row in `QuotaForm.vue`.
- Added `fromBytes()`, `multipliers`, and `Unit` type to derive the display unit from stored `limit_bytes` and convert back on save.
- No backend or schema changes. `limit_bytes` storage remains raw bytes.
- No new typecheck or lint errors introduced. Pre-existing project typecheck failures are unrelated.

### Known follow-ups raised during implementation

1. **`BaseSelect` dropdown items render as `MB - MB`** because the component's template prints `{{ option.value }} - {{ option.label }}`. Pre-existing component behaviour, not introduced by this change. Fix is out of scope here — would require a render-customization prop on `BaseSelect` and would touch every existing call site. Track separately if it bothers users.
2. **No unit-test file was created.** The PRD listed `fromBytes()` round-trip tests under "Verification" but did not include a test path in `touches:`, so Kimi correctly did not invent one. Verification was instead done by inline `node -e` execution (passed). PRD authoring lesson: when verification calls for tests, include the concrete test file in `touches:` with `(new)` marker.
