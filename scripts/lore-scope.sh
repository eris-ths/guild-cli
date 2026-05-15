#!/bin/sh
# lore-scope.sh — filter lore/principles/ by `applies_to:` frontmatter.
#
# Usage:
#   lore-scope.sh <audience>
#
#   audience := solo | swarm | passage:<name> | all
#
# Convention (see lore/README.md § "applies_to: frontmatter convention"):
#   * Principle files MAY carry YAML frontmatter at the very top:
#       ---
#       applies_to: swarm
#       ---
#     or list form: applies_to: [swarm, passage:devil]
#   * No frontmatter present => applies_to: all (default).
#
# Filter semantics:
#   * solo            — files where applies_to is 'all' or absent.
#                       (Solo readers see the universal set.)
#   * swarm           — files matching audience 'swarm' OR 'all'.
#                       (Swarm readers see universal + swarm-only.)
#   * passage:<name>  — files matching audience 'passage:<name>' OR 'all'.
#   * all             — every principle file (no filter).
#
# Output: one path per matching principle, sorted, suitable for piping.
# Exit codes:
#   0 — success (zero or more matches; matching count is what the caller
#       inspects via stdout line count)
#   2 — invalid usage / unknown audience syntax
#
# Implementation: grep-based; reads only the frontmatter block (lines
# between the first '---' on line 1 and the next '---'). POSIX sh; no
# bash-isms. Depends on: grep, sed, sort, find.

set -eu

usage() {
  printf 'usage: %s <audience>\n' "$0" >&2
  printf '  audience := solo | swarm | passage:<name> | all\n' >&2
  exit 2
}

[ $# -eq 1 ] || usage

AUDIENCE="$1"

# Validate audience shape.
case "$AUDIENCE" in
  solo|swarm|all) ;;
  passage:*)
    rest=${AUDIENCE#passage:}
    [ -n "$rest" ] || usage
    # Accept lowercase alnum + dash/underscore for passage names.
    case "$rest" in
      *[!a-z0-9_-]*) usage ;;
    esac
    ;;
  *) usage ;;
esac

# Resolve principles dir relative to script location so the script works
# from any cwd.
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
PRINCIPLES_DIR="$REPO_ROOT/lore/principles"

if [ ! -d "$PRINCIPLES_DIR" ]; then
  printf 'lore-scope: principles directory not found: %s\n' "$PRINCIPLES_DIR" >&2
  exit 1
fi

# Extract the applies_to value(s) from a file. Returns one token per
# line on stdout. Empty output means "no frontmatter" (= default 'all').
#
# Frontmatter block is lines after a leading '---' on line 1 up to the
# next '---'. If line 1 is not '---', the file has no frontmatter.
extract_applies_to() {
  file="$1"
  # Bail fast if the file does not start with '---'.
  first_line=$(sed -n '1p' "$file")
  [ "$first_line" = "---" ] || return 0

  # Read lines 2..(next '---' or EOF), look for 'applies_to:'.
  raw=$(sed -n '2,/^---$/p' "$file" | sed -n 's/^[[:space:]]*applies_to:[[:space:]]*//p' | head -n 1)
  [ -n "$raw" ] || return 0

  # raw can be:
  #   swarm
  #   [swarm, passage:devil]
  #   "swarm"
  # Strip surrounding [] / quotes, split on commas, trim whitespace.
  cleaned=$(printf '%s' "$raw" \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
          -e 's/^\[//' -e 's/\]$//' \
          -e 's/"//g' -e "s/'//g")
  # Split on commas. Output one token per line, trimmed, no blanks.
  printf '%s\n' "$cleaned" | tr ',' '\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | grep -v '^$' || true
}

# Decide if a file matches the requested audience.
match_audience() {
  file="$1"
  audience="$2"

  tokens=$(extract_applies_to "$file")

  if [ -z "$tokens" ]; then
    # No frontmatter => default 'all'.
    tokens="all"
  fi

  # 'all' as a filter passes everything.
  if [ "$audience" = "all" ]; then
    return 0
  fi

  # Universal principles (applies_to: all) match every non-'all'
  # audience query — they are the floor.
  if printf '%s\n' "$tokens" | grep -qx 'all'; then
    # 'solo' filter excludes principles tagged 'swarm' (or any non-'all').
    # But since this file's token set contains 'all', it qualifies.
    return 0
  fi

  # 'solo' filter: only files whose token set is exactly {all} qualify.
  # (Already handled above; reaching here means tokens do not contain
  # 'all'.)
  if [ "$audience" = "solo" ]; then
    return 1
  fi

  # 'swarm' or 'passage:<name>': exact token match.
  if printf '%s\n' "$tokens" | grep -qx "$audience"; then
    return 0
  fi

  return 1
}

# Iterate principles (sorted, deterministic) and print matches.
# `find` with -print | sort is portable; using -maxdepth 1 to stay
# inside principles/ even if subdirs are added later.
find "$PRINCIPLES_DIR" -maxdepth 1 -type f -name '*.md' | sort | while IFS= read -r file; do
  if match_audience "$file" "$AUDIENCE"; then
    printf '%s\n' "$file"
  fi
done
