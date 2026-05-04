---
id: PRD-60-01
title: Dashboard i18n — missing `pages.dashboard` key
status: approved
phase: P1
priority: low
severity: cosmetic
depends_on: []
touches:
  - src/i18n/locales/en.json
  - src/i18n/locales/de.json
  - src/i18n/locales/es.json
  - src/i18n/locales/fr.json
  - src/i18n/locales/it.json
  - src/i18n/locales/pl.json
  - src/i18n/locales/pt.json
  - src/i18n/locales/ru.json
  - src/i18n/locales/tr.json
  - src/i18n/locales/uk.json
  - src/i18n/locales/zh-CN.json
---

# Dashboard i18n — missing `pages.dashboard` key

> Status: `approved` · Phase: `P1` · Severity: cosmetic

## Why

The user dashboard renders the literal string `pages.dashboard` in the page title and the layout header instead of "Dashboard". Reproduced in production at `http://178.105.64.108:51821/dashboard`. Root cause: the i18n key `pages.dashboard` is referenced in two Vue files but is not defined in any locale JSON. vue-i18n falls back to printing the raw key path when a key is missing.

Reference (rendered in screenshot): the header shows `pages.dashboard` and the panel head shows `pages.dashboard` instead of localized "Dashboard".

## Scope

### In

- Add the `dashboard` key under the existing `pages` object in **every** locale file under `src/i18n/locales/`.
- English value: `"Dashboard"`. For all other locales, use the locale's existing translation of "Dashboard" (each locale already translates "dashboard" elsewhere — e.g. `dashboard.noClients`, `dashboard.noUsageData` — match those translations).

### Out

- Refactoring the i18n key namespace.
- Adding new dashboard strings beyond the missing one.

## Data model changes

None.

## API changes

None.

## UI changes

The string "Dashboard" appears in:
- `src/app/layouts/dashboard.vue:11` — header title (links to `/dashboard`)
- `src/app/pages/dashboard/index.vue:7` — panel head title
- `src/app/pages/dashboard/clients/[id].vue:7` — breadcrumb link back to dashboard

No template changes needed. Just add the missing key.

## Verification

**Manual test plan:**
1. Start dev server (`pnpm dev` in `src/`).
2. Log in via dashboard QR/key login.
3. Navigate to `/dashboard`. Header and panel title MUST read "Dashboard" (or the locale equivalent), not `pages.dashboard`.
4. Switch language in `/admin/general` (or however locale is selected) — the same word MUST be translated, not show the key path.

**Automated check (optional):**
- Add a unit test under `src/i18n/locales/` that loads each JSON and asserts every key referenced in `src/app/**/*.vue` via `$t('...')` exists. Out of scope for this PRD if it adds friction; at minimum, eyeball that `pages.dashboard` exists in every locale.

## Open questions

None.

---

## Kimi handoff

**Read before implementing:**
- `src/app/layouts/dashboard.vue` (lines 1-32)
- `src/app/pages/dashboard/index.vue` (lines 1-15)
- `src/app/pages/dashboard/clients/[id].vue` (lines 1-15)
- `src/i18n/locales/en.json` (lines 1-50, observe `pages` block structure)

**Modify these files:**
- All locale files listed in `touches:` — add `"dashboard": "<translation>"` inside the `"pages"` object, alphabetically positioned (between `"clients"` and `"admin"` is fine).

**Do NOT modify:**
- Any `.vue` template (the keys are already correct in the templates — only the translations are missing).

**Acceptance tests** (Kimi must demonstrate these pass):
1. `grep -l '"dashboard"' src/i18n/locales/*.json | wc -l` returns the count of locale files (every locale has the key).
2. JSON validates (`pnpm exec jsonlint src/i18n/locales/*.json` or `node -e "JSON.parse(require('fs').readFileSync(...))"`).
3. Manual: visiting `/dashboard` shows "Dashboard" in the header.

**Self-test plan:**
```bash
cd src
node -e "for (const f of require('fs').readdirSync('i18n/locales')) { const j = JSON.parse(require('fs').readFileSync('i18n/locales/'+f)); if (!j.pages?.dashboard) { console.error('MISSING:', f); process.exit(1); } } console.log('all locales OK')"
pnpm dev
# manually visit /dashboard
```
