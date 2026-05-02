#!/usr/bin/env bash
# Assemble a complete, scope-locked Kimi prompt for one PRD.
#
# Usage:
#   scripts/assemble-kimi-prompt.sh <phase> <index> [-o output.md]
#
# Examples:
#   scripts/assemble-kimi-prompt.sh 0  1                # P0 PRD #01 (backend-abstraction) → stdout
#   scripts/assemble-kimi-prompt.sh 0  2 -o /tmp/p.md   # write to file
#   scripts/assemble-kimi-prompt.sh 10 1                # P1 MikroTik driver
#   scripts/assemble-kimi-prompt.sh 20 4                # speed limits
#
# Phase numbers map to vault directories:
#   0  → prds/00-foundation/
#   10 → prds/10-mikrotik/
#   20 → prds/20-user-features/
#   30 → prds/30-multi-engine/
#   40 → prds/40-multi-server/
#   50 → prds/50-integrations/

set -euo pipefail

# Resolve repo root (script lives in <repo>/scripts/)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VAULT="$ROOT/docs/obsidian"

# --- Args ---
if [[ $# -lt 2 ]]; then
  sed -n '3,21p' "${BASH_SOURCE[0]}" >&2
  exit 1
fi

PHASE=$(printf "%02d" "$1")
INDEX=$(printf "%02d" "$2")
shift 2

OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--output) OUT="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

# --- Locate PRD ---
PRD_DIR=$(find "$VAULT/prds" -mindepth 1 -maxdepth 1 -type d -name "${PHASE}-*" | head -1)
[[ -n "$PRD_DIR" ]] || { echo "No phase dir matches '${PHASE}-*' under $VAULT/prds/" >&2; exit 1; }

PRD_FILE=$(find "$PRD_DIR" -maxdepth 1 -name "${INDEX}-*.md" | head -1)
[[ -n "$PRD_FILE" ]] || { echo "No PRD matches '${INDEX}-*.md' in $PRD_DIR" >&2; exit 1; }

REL_PRD="${PRD_FILE#$ROOT/}"
echo "PRD: $REL_PRD" >&2

# --- Helpers ---

# Extract `touches:` list from YAML frontmatter. Append " __NEW__" to entries
# tagged "(new)" so we know to skip reading them.
extract_touches() {
  awk '
    /^---[[:space:]]*$/ { fm = !fm; next }
    fm && /^touches:/ { in_t = 1; next }
    fm && in_t && /^[A-Za-z]/ { in_t = 0 }
    fm && in_t && /^[[:space:]]+-[[:space:]]+/ {
      sub(/^[[:space:]]+-[[:space:]]+/, "")
      sub(/[[:space:]]+\(new\)[[:space:]]*$/, " __NEW__")
      print
    }
  ' "$1"
}

# Extract read-only file paths from the "Read before implementing:" block in
# the Kimi handoff section. Pulls every backtick-wrapped path that starts with
# src/ (skips wikilinks like `[[architecture]]` and external URLs).
extract_read_only() {
  awk '
    /^\*\*Read before implementing:\*\*/ { cap = 1; next }
    /^\*\*Modify these files:\*\*/        { cap = 0 }
    /^\*\*Do NOT modify:\*\*/             { cap = 0 }
    /^\*\*Acceptance tests/               { cap = 0 }
    cap {
      s = $0
      while (match(s, /`src\/[^`]+`/)) {
        p = substr(s, RSTART+1, RLENGTH-2)
        # Trim line ranges if any (we paste the whole file by default)
        sub(/[[:space:]]*\(.*\)$/, "", p)
        print p
        s = substr(s, RSTART + RLENGTH)
      }
    }
  ' "$1" | awk '!seen[$0]++'
}

# Print a file inside a delimited block. If the file does not exist, print a
# stub so Kimi sees the path was intentional.
print_file_block() {
  local path=$1
  local rel=${path#$ROOT/}
  if [[ -f "$ROOT/$path" ]]; then
    printf '===== FILE: %s =====\n' "$rel"
    cat "$ROOT/$path"
    printf '\n===== END =====\n\n'
  elif [[ -f "$path" ]]; then
    printf '===== FILE: %s =====\n' "$path"
    cat "$path"
    printf '\n===== END =====\n\n'
  else
    printf '===== FILE: %s =====\n' "$path"
    printf '(file does not exist in repo at this commit)\n'
    printf '===== END =====\n\n'
  fi
}

# --- Assemble to a tempfile, then ship it ---
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

{
cat <<'PROMPT_HEADER'
You are an implementation engineer working on the manawenuz/wg-easy fork.
You are NOT a designer. You are NOT a reviewer. You implement one PRD per session.

# Hard scope rules — read carefully, these are non-negotiable

1. The PRD below is your ONLY authority. Do not invent requirements.
2. You may READ any file in the "Read-only context" section. You may NOT modify them.
3. You may MODIFY only files listed in the PRD frontmatter `touches:` field, AND
   only those files. New files are allowed iff their path appears in `touches:` with the
   "(new)" marker.
4. If the PRD says "do X" and existing code does Y, do X. Do not "improve" Y while you're there.
5. NO refactors outside the PRD's scope. NO renames. NO unrelated dep bumps. NO comment cleanup
   in files you didn't have to touch. NO logging additions "for debugging" that survive the diff.
6. NO new top-level dependencies (`package.json` additions) without justifying each one in the
   diff message and confirming the PRD permits it. If unsure, list the proposed dep at the top
   of your reply and STOP.
7. NO "while I was here" fixes to unrelated bugs. File a follow-up note instead.
8. If the PRD is ambiguous on something you must decide to write code, list the ambiguities at
   the top of your reply and STOP. Do not guess. The orchestrator will resolve and re-prompt.

# Stack and conventions

- Nuxt 4 + Nitro server, Vue 3 (composition API + script setup), Pinia, Tailwind.
- TypeScript strict mode. No `any` unless the PRD explicitly allows it.
- Drizzle ORM, SQLite. Migrations are additive; never edit a shipped migration.
- pnpm. ESLint + Prettier configs already exist — match them.
- Tests: Vitest. Co-locate as `*.test.ts` next to the code, unless an integration suite exists.
- Match neighboring file style. Read 2–3 sibling files before writing a new one in the same area.

# Output format — exactly these sections, in this order

1. **Ambiguities** — list each one or write "None." If non-empty, STOP after this section.
2. **Plan** — bullet list, ≤10 lines, what you'll change and why. Cite PRD sections by header.
3. **Diff** — a single unified diff against the current tree. Include new files. The diff must
   apply cleanly with `git apply` from repo root.
4. **Self-test commands** — copy-pasteable shell block that exercises every acceptance test in
   the PRD's "Kimi handoff" section. Every command must actually run; do not invent flags.
5. **Open follow-ups** — items the PRD didn't cover but came up during impl. Tag each as
   "scope-creep-deferred" (you correctly didn't do it) or "PRD-gap" (PRD should be amended).
6. **PRD update** — a second unified diff that updates THE PRD ITSELF (same file shown under
   "# The PRD" below). Required edits, in this order:
   - Frontmatter `status:` → `shipped` ONLY if all acceptance tests pass. Otherwise leave it
     as-is and explain in §5.
   - Frontmatter `touches:` → reconcile with reality. Add any new files you actually created
     (with a trailing ` (new)` marker so the assembler skips pasting them next time); remove
     any listed files you did NOT touch.
   - Append a `## Resolution log (YYYY-MM-DD)` section at the bottom of the PRD body. Cover:
     what shipped, deviations from the spec and why, follow-ups filed, and the commit/PR ref
     if known. Keep under 20 lines. Write it for the next session, not for this conversation.
   - If you discovered a bug in ANOTHER PRD while implementing this one (wrong schema type,
     missing dependency, stale path), add a third diff patching that PRD. Cite the path. Do
     NOT silently work around upstream PRD bugs — surface them.

# The PRD

PROMPT_HEADER

cat "$PRD_FILE"
echo

echo
echo '# Architecture spine (reference — do not modify)'
echo
cat "$VAULT/architecture.md"
echo

echo
echo '# Glossary (reference — do not modify)'
echo
cat "$VAULT/glossary.md"
echo

echo
echo '# Read-only context (you may read; you may NOT modify)'
echo
RO_COUNT=0
while IFS= read -r path; do
  [[ -z "$path" ]] && continue
  print_file_block "$path"
  RO_COUNT=$((RO_COUNT+1))
done < <(extract_read_only "$PRD_FILE")
if [[ $RO_COUNT -eq 0 ]]; then
  echo '(no additional read-only files listed in PRD)'
  echo
fi

echo
echo '# Files you will modify'
echo
echo "The exhaustive list is the PRD's frontmatter \`touches:\` field. Existing files"
echo 'have their current contents below; new files are listed without paste (you'
echo 'will create them in your diff).'
echo
MOD_COUNT=0
NEW_COUNT=0
while IFS= read -r entry; do
  [[ -z "$entry" ]] && continue
  if [[ "$entry" == *" __NEW__" ]]; then
    path="${entry% __NEW__}"
    printf '===== FILE: %s (NEW — create in your diff) =====\n' "$path"
    printf '===== END =====\n\n'
    NEW_COUNT=$((NEW_COUNT+1))
  else
    print_file_block "$entry"
    MOD_COUNT=$((MOD_COUNT+1))
  fi
done < <(extract_touches "$PRD_FILE")

cat <<'PROMPT_FOOTER'

# Final reminder before you start

- The PRD's `touches:` list is your file allowlist. Anything outside it is out of bounds.
- If you reach a decision point not covered by the PRD, STOP and list it. Don't guess.
- Your diff is the artifact. It will be reviewed against the PRD line by line.
PROMPT_FOOTER

} > "$TMP"

# --- Stats (stderr) ---
BYTES=$(wc -c < "$TMP" | tr -d ' ')
LINES=$(wc -l < "$TMP" | tr -d ' ')
TOK_EST=$(( BYTES / 4 ))
{
  echo "----"
  echo "PRD:              $REL_PRD"
  echo "Read-only files:  $RO_COUNT"
  echo "Modify (existing): $MOD_COUNT"
  echo "Modify (new):      $NEW_COUNT"
  echo "Bytes:             $BYTES  (~$LINES lines)"
  echo "Token estimate:    ~$TOK_EST  (chars/4 — rough; Kimi window is 256K)"
  if [[ $TOK_EST -gt 120000 ]]; then
    echo "WARNING: prompt is large; consider splitting the PRD."
  fi
} >&2

# --- Ship ---
if [[ -n "$OUT" ]]; then
  cp "$TMP" "$OUT"
  echo "Wrote $OUT" >&2
else
  cat "$TMP"
fi
