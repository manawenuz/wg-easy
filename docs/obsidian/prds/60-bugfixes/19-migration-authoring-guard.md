---
id: PRD-60-19
title: Migration authoring guard — breakpoints + bare-DDL lint to prevent silent upgrade failures
status: backlog
phase: P1
priority: high
severity: foot-gun (silent upgrade failures, recurring authoring lesson)
touches:
  - scripts/lint-migrations.sh (new)
  - .github/workflows/ci.yml
  - src/server/database/migrations/README.md (new)
---

# PRD-60-19 — Migration authoring guard

## Why

Three production-grade migration foot-guns have surfaced in the last two months. Each one silently broke fresh deploys and was only caught by live UAT or end-user error reports:

1. **2026-05-06** — Migration `0015_traffic_groups_and_subaccounts.sql` was added to disk but **not registered in `meta/_journal.json`**. Drizzle silently skipped it on every fresh deploy. Caught when the live server crashed with `no such column: default_traffic_group_id`. (See `handoff/orchestration-handoff.md`.)
2. **2026-05-06** — `src/server/database/sqlite.ts`'s `migrate()` was swallowing every migration error via `DB_DEBUG`. Fixed: now throws and logs to console.error.
3. **2026-05-18** — Migration `0016_per_user_quota.sql` was missing `--> statement-breakpoint` markers between its 3 statements. Drizzle's libsql migrator runs only the FIRST statement when breakpoints are absent. `CREATE TABLE user_quota` ran; the `INSERT FROM quota` and `DROP TABLE quota` did not. Result: post-upgrade DB had both an empty `user_quota` table and a stale `quota` table.
4. **2026-05-18** — Initial fixup migration `0018_fixup_quota_drop.sql` had a multi-line SQL comment block at the top. libsql migrator returned a generic `SQLITE_UNKNOWN_0: not an error` and refused to boot. Simplifying to bare `DROP TABLE IF EXISTS quota;` (no leading comments) fixed it.

Each failure is the same shape: **the migration file is valid SQL, but the framework's loader silently drops or chokes on it.** Reviewers can't catch these by eye. CI needs to catch them mechanically.

## User stories

- As a **PR author** adding a migration, CI tells me before merge if my file is missing the journal entry, missing breakpoints between statements, or starting with a comment libsql won't parse.
- As a **release engineer**, I know that every migration on `master` has been mechanically validated. No more "the migration on disk doesn't match what runs."
- As a **PRD author** referencing a migration in `touches:`, I trust that adding the `.sql` file is enough — the lint catches the journal/format gaps.

## Scope

### In

A new `scripts/lint-migrations.sh` invoked by CI that runs the following checks against `src/server/database/migrations/`:

1. **Journal sync**: every `NNNN_*.sql` file under `migrations/` must have a matching entry in `meta/_journal.json` with matching `idx` and `tag`. Files without entries fail. Entries without files fail.
2. **Sequential idx**: journal `idx` values are `0..N` contiguous, no gaps.
3. **Breakpoint check**: any migration file containing **two or more SQL statements** (heuristic: ≥2 semicolons at non-trivial positions, ignoring those inside string literals) must contain at least N-1 `--> statement-breakpoint` markers. (Use a simple parser; fail with a clear message naming the offending file.)
4. **Bare-DDL guard**: the first non-blank line of each migration file must be DDL/DML, not a `--` comment. The libsql migrator chokes on leading comment blocks for at least some statement shapes (precise pattern unclear; safest rule is "no leading comments").
   - Alternative formulation if the rule above turns out too strict for our existing valid migrations: explicitly test "every existing `0000–NNNN` parses and applies cleanly against a temp SQLite DB" as a CI smoke test.
5. **Hash check** (nice-to-have): re-compute the Drizzle hash of each migration file and assert it matches the recorded hash in the journal (Drizzle does this internally; if we shadow it, broken migrations are caught earlier).

CI wiring: add a `lint-migrations` job to `.github/workflows/ci.yml` that runs `bash scripts/lint-migrations.sh` and fails the PR on non-zero exit.

A `README.md` next to the migrations folder documenting the rules and pointing at this PRD.

### Out

- A `drizzle-kit generate` enforcement (the project already documents this in `handoff/orchestration-handoff.md`).
- Schema-snapshot diffing (Drizzle does this; not our job).
- Automatic fix-up of missing journal entries — author-side problem; the lint just surfaces it.

## Implementation sketch

```bash
#!/usr/bin/env bash
# scripts/lint-migrations.sh
set -euo pipefail
MIGR=src/server/database/migrations
J=$MIGR/meta/_journal.json

fail() { echo "[migration-lint] $*" >&2; exit 1; }

# 1. Journal sync
files=$(ls $MIGR/[0-9][0-9][0-9][0-9]_*.sql | xargs -n1 basename | sed 's|\.sql$||' | sort)
tags=$(jq -r '.entries[].tag' $J | sort)
diff <(echo "$files") <(echo "$tags") || fail "files vs. journal mismatch (left=files, right=journal)"

# 2. Sequential idx
jq -r '.entries[].idx' $J | awk 'BEGIN{e=0} $1!=e++{exit 1}' \
  || fail "journal idx values are not 0..N contiguous"

# 3. Breakpoint check
for f in $MIGR/[0-9][0-9][0-9][0-9]_*.sql; do
  # crude: count semicolons not inside single-quoted strings
  stmts=$(perl -e '$_=do{local $/;<>}; s/'"'"'[^'"'"']*'"'"'//g; print scalar(()=/;/g)' "$f")
  bps=$(grep -c -- '--> statement-breakpoint' "$f" || true)
  if (( stmts > 1 && bps < stmts - 1 )); then
    fail "$(basename "$f"): $stmts statements but only $bps breakpoints (need $((stmts-1)))"
  fi
done

# 4. Bare-DDL guard
for f in $MIGR/[0-9][0-9][0-9][0-9]_*.sql; do
  first_nonblank=$(grep -v '^\s*$' "$f" | head -1 || true)
  if [[ "$first_nonblank" =~ ^-- ]]; then
    fail "$(basename "$f"): starts with SQL comment; libsql migrator may reject. Move comments after first DDL."
  fi
done

echo "[migration-lint] OK"
```

## Verification

- Run `bash scripts/lint-migrations.sh` against current `master`: passes after the 0016+0018 fixes from this UAT.
- Add a broken-file fixture to a test branch and confirm CI fails.
- Add a `migration-lint` step to CI.

## Implementer handoff

- The existing migrations from `0000`–`0017` were authored to upstream Drizzle conventions; lint should pass on them after the UAT fixes are merged.
- See `handoff/orchestration-handoff.md` (2026-05-06 entry) for prior migration foot-guns.

**Estimate:** ~half a day for the lint script + CI wiring + README.
