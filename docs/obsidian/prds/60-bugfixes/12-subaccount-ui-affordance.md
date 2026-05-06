---
id: PRD-60-12
title: Sub-accounts — surface the "+" button on each parent user row
status: shipped
phase: P1
priority: medium
severity: cosmetic + UX
depends_on: []
touches:
  - src/i18n/locales/en.json
  - src/app/pages/admin/users/index.vue
---

# Sub-accounts — surface the "+" button on each parent user row

> Status: `approved` · Phase: `P1` · Severity: cosmetic + UX (feature exists, not visible)

## Why

Sub-accounts are fully implemented (commit `28cfb08`):
- Backend: `users_table.parent_user_id`, `POST /api/admin/users/:id/sub-accounts`, list endpoint includes children.
- UI: `src/app/pages/admin/users/index.vue` already renders `<AdminSubAccountDialog>` per parent row (lines 101–110), and `src/app/components/Admin/SubAccountDialog.vue` exists.

But the user reports they "don't see anywhere to create a sub-account." Two real reasons:

1. **Missing i18n keys**: `admin.users.addSubAccount`, `admin.users.parentUser`, `admin.users.subAccountDescription`, `admin.users.subAccounts`, `admin.users.viewParent` are referenced by the UI but absent from `en.json` → buttons render either empty or as the raw key path, and are easy to miss.
2. **Visual affordance**: the trigger is currently a slot child of `<AdminSubAccountDialog>` rendering only the translated text `t('admin.users.addSubAccount')`. The user expects "a `+` near the account" — a small, recognisable icon-button at the row level.

## Scope

### In

1. Add the five missing i18n keys to `src/i18n/locales/en.json` under `admin.users`.
2. Replace the text-only sub-account trigger in `src/app/pages/admin/users/index.vue` (lines 101–110) with a compact icon-button: a `+` (plus) icon, sized to the row, with `title=` and `aria-label=` set to `t('admin.users.addSubAccount')` for accessibility. Place the button at the **right edge of the row**, in the actions column (next to the existing "Edit" link for that user). Only render it for parent rows (`v-if="!u.isSubAccount"`, unchanged).
3. Inside `src/app/components/Admin/SubAccountDialog.vue`: keep the dialog header text using `t('admin.users.addSubAccount')` and the descriptive paragraph using `t('admin.users.subAccountDescription')`.

### Out

- Other locale files (en-only first).
- Backend changes (none needed).
- Sub-account creation from the dashboard side (admin-only path stays the only entry).
- Restyling the sub-account *list* (already shown via the `↳` indent on line 74).
- Adding a confirmation step or any new fields beyond what `SubAccountDialog` already collects.

## Required i18n additions

Insert into the existing `admin.users` object in `src/i18n/locales/en.json`:

| Key | English value |
|---|---|
| `addSubAccount` | "Add sub-account" |
| `parentUser` | "Parent user" |
| `subAccountDescription` | "Create a sub-account attached to this user. Sub-accounts share their parent's traffic group and inherit their quota policy." |
| `subAccounts` | "Sub-accounts" |
| `viewParent` | "View parent" |

## UI changes

### `src/app/pages/admin/users/index.vue`

Current (lines 101–110, illustrative — Kimi should match the actual file):

```vue
<AdminSubAccountDialog
  v-if="!u.isSubAccount"
  :parent-id="u.id"
  @save="(data) => createSubAccount(u.id, data)"
>
  <button>{{ t('admin.users.addSubAccount') }}</button>
</AdminSubAccountDialog>
```

Replace the inner `<button>` with an icon trigger. Use the project's existing icon component pattern (check sibling pages — likely `<Icon name="...">` from Nuxt Icon, or an inline SVG; match what neighbouring rows already use for "Edit" / "Delete"). The button must:

- Render a `+` glyph (any plus-style icon already used in the project; do **not** introduce a new icon library).
- Be ~24×24 px, padded for click target ≥ 32×32.
- Have `:title="t('admin.users.addSubAccount')"` and `:aria-label="t('admin.users.addSubAccount')"`.
- Sit in the row's actions column, to the right of the existing "Edit" affordance.
- On hover, show a subtle background (match existing button hover styles in the file).

### `src/app/components/Admin/SubAccountDialog.vue`

Add a one-line description paragraph near the top of the dialog body using `t('admin.users.subAccountDescription')`. No structural change otherwise.

## Data model changes

None.

## API changes

None.

## Verification

**Manual:**
1. Dev server, log in as superadmin, navigate to `/admin/users`.
2. Existing parent users (e.g. `admin`, `AAA`) must each show a `+` icon-button on the right side of their row, with tooltip "Add sub-account".
3. Click it → dialog opens with title "Add sub-account", description "Create a sub-account attached to this user…", and Name/Email fields.
4. Submit a sub-account; it appears in the list immediately under its parent, indented with `↳`.
5. Sub-account rows do **not** show the `+` button (because of `v-if="!u.isSubAccount"`).
6. Tooltip text and dialog text are real English — never `admin.users.addSubAccount` or similar.

**Automated:**
```bash
cd src
node -e "
const j = JSON.parse(require('fs').readFileSync('i18n/locales/en.json'));
const need = ['addSubAccount','parentUser','subAccountDescription','subAccounts','viewParent'];
const have = j.admin?.users || {};
const miss = need.filter(k => !have[k]);
if (miss.length) { console.error('MISSING:', miss); process.exit(1); }
console.log('all', need.length, 'keys present');
"
```

## Open questions

- The exact icon component to use depends on the project's current icon convention. Kimi: inspect 2–3 sibling .vue files in `src/app/pages/admin/` (e.g. `users/[id].vue`, `traffic-groups.vue`) and match whatever pattern is already in use. If none is consistent, fall back to an inline `<svg>` containing a 16×16 plus path. Do not add any npm package.

---

## Kimi handoff

**Read before implementing:**
- `src/app/pages/admin/users/index.vue` (full file, ~190 lines)
- `src/app/components/Admin/SubAccountDialog.vue` (full file)
- `src/app/pages/admin/users/[id].vue` (to see what neighbouring action-button styling looks like)
- `src/i18n/locales/en.json` (observe `admin.users` block structure)

**Modify these files:**
- `src/i18n/locales/en.json` — add the five keys above into `admin.users`.
- `src/app/pages/admin/users/index.vue` — replace the text trigger inside `<AdminSubAccountDialog>` with a `+` icon-button as specified.
- `src/app/components/Admin/SubAccountDialog.vue` — insert the description paragraph using `t('admin.users.subAccountDescription')`.

**Do NOT modify:**
- Any backend file (`src/server/**`).
- Any other locale file.
- Any other admin page or component.
- The `↳` indent rendering for sub-account child rows (already correct on line 74).

**Acceptance tests** (Kimi must show these pass):
1. The Node snippet under "Verification → Automated" prints "all 5 keys present" and exits 0.
2. `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/en.json'))"` succeeds.
3. Manual screenshot or description: each non-sub-account row in `/admin/users` has a visible `+` icon-button on the right; clicking it opens the sub-account dialog with translated labels.


## Resolution log (2026-05-06)

**Shipped**: Added 5 i18n keys (`addSubAccount`, `parentUser`, `subAccountDescription`, `subAccounts`, `viewParent`) to `admin.users` in `en.json`. Replaced text-only sub-account trigger with a compact "+" icon button using inline SVG (20×20px icon in 32×32px click target with hover background) positioned in the actions column next to the "Edit" link.

**Deviations**: SubAccountDialog.vue already had the description paragraph at lines 8-10, so no changes were needed to that file. Removed it from the `touches:` list in frontmatter.

**Follow-ups**: None.
