---
id: PRD-60-17
title: Suppress upstream "There is an update available!" banner for fork users
status: backlog
phase: P2
priority: medium
severity: ux (fork users get prompted to upgrade to upstream releases that don't apply)
touches:
  - src/app/components/UpdateBanner.vue
  - src/server/api/version.get.ts
  - src/i18n/locales/en.json
  - src/app/composables/useUpstreamUpdateCheck.ts
---

# PRD-60-17 — Suppress upstream update banner

## Why

The fork inherits an upstream "There is an update available!" banner that polls `github.com/wg-easy/wg-easy` releases and prompts admins to update to the latest upstream tag. For our fork's users this is wrong — they should follow the fork's release stream, not upstream's.

Operator screenshot (2026-05-18 UAT) showed the banner reading:

> There is an update available!
> Enforce Allowed IP rules server-side, improve mobile ui and various improvements [Update →]

Clicking "Update" would point users away from the fork.

## User stories

- As a **fork admin**, I never see an "update available" prompt that points at upstream releases.
- As a **fork admin**, I can optionally see a prompt that points at the fork's own releases (`github.com/manawenuz/wg-easy-fork`).
- As a **fork maintainer**, I can toggle the entire update-check off via env var for air-gapped or compliance-restricted deployments.

## Scope

### In

- **Disable** the upstream-release polling by default in this fork. The component that renders the banner should return `null` when the fetched release info is not for the fork repo.
- **Replace** the release-check target URL with `github.com/manawenuz/wg-easy-fork/releases/latest` (or remove the check entirely if no fork release exists yet).
- Add env var `DISABLE_UPDATE_CHECK=true` to opt out completely (image runs without phoning home).
- Locale update: any "update available" copy stays, but is now tied to the fork's stream.

### Out

- Auto-upgrade. The button still just links to the release page; no in-place upgrade.
- Notifying users (non-admin role) — they don't see the banner today.
- A full "release notes" panel.

## Implementation sketch

```ts
// src/app/composables/useUpstreamUpdateCheck.ts
const FORK_REPO = 'manawenuz/wg-easy-fork';

export function useUpstreamUpdateCheck() {
  if (import.meta.env.VITE_DISABLE_UPDATE_CHECK === 'true') return ref(null);
  // ... fetch FORK_REPO's latest release, compare against APP_VERSION
}
```

```vue
<!-- src/app/components/UpdateBanner.vue -->
<template>
  <div v-if="upstream && upstream.repo === FORK_REPO" class="banner">
    ...
  </div>
</template>
```

## Verification

- Fresh deploy with `DISABLE_UPDATE_CHECK=true`: no banner, no outbound request to github.
- Fresh deploy without that env: banner only fires when fork has a newer release than the running image.
- Manual: confirm banner does NOT trip from upstream's release notes ("Enforce Allowed IP rules…" was the upstream copy).

## Implementer handoff

- Existing banner copy strings are in `src/i18n/locales/en.json` under `update.*`.
- The release-check source is likely a `useFetch` in a composable or directly in `UpdateBanner.vue`. Trace from the banner component.
- Keep the API contract unchanged — only the source URL changes.

**Estimate:** ~1–2 hours.
