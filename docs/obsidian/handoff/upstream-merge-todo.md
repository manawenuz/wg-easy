---
title: Upstream merge TODO — pulling improvements from wg-easy/wg-easy
type: handoff
last_updated: 2026-05-18
---

# Upstream merge TODO

The fork tracks `wg-easy/wg-easy` as the `upstream` git remote. Periodically we want to pull in upstream improvements that don't conflict with the fork's divergent feature set (multi-engine, multi-tenant, traffic groups, sub-accounts, quotas).

This document is a **scratchpad for the next merge pass**, not a PRD. Update it whenever an upstream release contains features we want.

## Pending pull (as of 2026-05-18)

Upstream banner copy spotted during the 2026-05-18 UAT advertised:

> "Enforce Allowed IP rules server-side, improve mobile UI and various improvements"

These are the most recent upstream improvements. Specific commits / PRs we want to evaluate:

- **Server-side AllowedIPs enforcement** — security hardening. Upstream PR ref TBD; identify via `git log upstream/master --grep "AllowedIPs"` or browse upstream release notes.
- **Mobile UI improvements** — Tailwind / responsive fixes. Low-risk to cherry-pick; high user value.
- **Various improvements** — generic; cherry-pick by inspection.

## How to do the merge

```bash
git fetch upstream master
git log --oneline master..upstream/master | head -40   # see what's new
git checkout -b upstream-merge-2026-05
# Cherry-pick safe commits one-by-one
git cherry-pick <sha>
# Resolve conflicts (touch points: src/app/*, src/server/api/*, locales)
# Run typecheck + tests after each
pnpm typecheck && pnpm test
```

Conflict-prone files (where fork diverges most from upstream):

- `src/server/database/repositories/quota/*` — fork has user-level model; upstream has client-level.
- `src/server/database/repositories/user/*` — fork added `parent_user_id`, `default_traffic_group_id`.
- `src/server/api/admin/clients/[id]/quota.*.ts` — fork returns 410; upstream still PUTs/DELETEs.
- `src/server/engines/*` — fork has the engine pattern; upstream has direct wireguard code.
- `src/app/components/UpdateBanner.vue` — fork suppresses upstream-pointed updates (PRD-60-17).
- `src/i18n/locales/en.json` — frequent conflicts; resolve by union, not by replace.

## Suppress upstream update banner first

Before pulling new versions in, land PRD-60-17 (suppress the upstream "update available" banner) so users don't get prompted to upgrade past the fork.

## Cherry-pick vs. merge

Default to **cherry-pick** for upstream changes. A full `git merge upstream/master` produces giant diffs that are hard to review and easy to mis-resolve. Cherry-picking commits one at a time keeps each merge surgical and reviewable.

## After merge

- Run full test suite.
- Update this file with what was pulled.
- Tag a new fork release (`v15.3.0-beta.X-fork`).
- Let GitHub Actions build the ghcr image.

## History

- (none yet — this doc was created 2026-05-18.)
