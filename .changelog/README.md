# `.changelog/` — fragment-based release notes

This directory holds one file per PR (or per landed change) instead
of all PRs editing the same `CHANGELOG.md` `## [Unreleased]` block.

## Why this exists

The previous convention asked every PR to append to one section in
`CHANGELOG.md`. Even with the *append-to-end-of-section* rule (see the
HTML comment at the top of `CHANGELOG.md`), concurrent PRs collided
on the section heading anchor and produced repeated `### Fixed`
sub-sections inside one `[Unreleased]` block. Worse, every PR touched
the same file, so any rebase across two open PRs forced a textual
merge. Conflicts here are pure overhead — the substance never
overlaps, only the file location does.

Per-PR fragment files make conflicts impossible (each PR's filename
is unique) and let a release script reconstruct the prose form at
release time.

## Filename convention

```
.changelog/next/<category>-<slug>.md
```

- `<category>` is one of: `fixed`, `changed`, `added`, `removed`,
  `deprecated`, `security`, `breaking`. Maps 1:1 to the
  `### Fixed / ### Changed / ...` sub-section the entry lands in at
  release time. `breaking` is rendered as `### ⚠ BREAKING` per
  existing `CHANGELOG.md` precedent.
- `<slug>` is a short kebab-case identifier — usually the PR
  number or branch slug. `387-gate-boot-by.md`, `voices-no-arg-index.md`.
  Uniqueness is enforced by filesystem; collisions surface immediately.

**docs-only changes do not get a fragment.** The CHANGELOG records
notable user-facing behavior; a `docs/` or README edit is recorded by
its PR + git history. There is intentionally no `docs` category. The
release script **refuses to run** (exit 1) if `next/` holds any file
whose category is not in the list above — a mis-categorized fragment
must be renamed or deleted, never silently dropped. (Surfaced by the
0.7.0 release dogfood, #441.)

## File contents

One or more markdown bullets. The release script concatenates
fragments per category in filesystem order (PR-merge order is close
enough; curators can re-sort during release if needed).

```markdown
- **`gate boot --by <actor>` now overrides `GUILD_ACTOR` for one-shot
  identity.** Pre-fix, the muscle-memory invocation bounced with
  `unknown flag: --by` because boot only consulted env. `--as` is
  accepted as a prose-natural alias.
```

Wrap prose at ~72 cols, matching the rest of `CHANGELOG.md`.

## At release time

A maintainer:

1. Runs `node scripts/changelog-release.mjs <version>` (or
   `npm run changelog:release -- <version>`). The script, in one step:
   - collects all fragments under `.changelog/next/`, groups by
     category, and prepends a `## [<version>] - <date>` block to
     `CHANGELOG.md`;
   - **bumps the `version` field in `package.json` and
     `package-lock.json`** (root + `packages[""]`) to `<version>`, so
     they never drift from the release (CI has a version-drift guard
     that fails the build otherwise — the trap that surfaced in the
     0.7.0 dogfood, #441/#442);
   - deletes the collected fragment files under `.changelog/next/`.
   It **refuses to run** if `next/` holds a file with an unrecognized
   category (see the filename convention above).
2. Commits all edits together (`CHANGELOG.md`, `package.json`,
   `package-lock.json`, removed fragments).
3. Tags the release commit: **`git tag -a v<version> -m "guild-cli
   <version>"` then `git push origin v<version>`**. Tags are annotated
   and `v`-prefixed (`v0.6.0`, `v0.7.0`), one per release.

`npm run changelog:preview -- <version>` (a `--dry-run`) prints the
block and the would-bump note without writing anything.

The `[Unreleased]` block in `CHANGELOG.md` becomes a placeholder
that points readers at this directory — it is no longer where
new entries land.

## When *not* to add a fragment

- Pure-internal refactors with no observable behavior change.
- Test-only or CI-only changes.
- Doc-only PRs that don't introduce / rename / remove a verb,
  flag, or substrate field.

If unsure, add one — false positives are cheap; false negatives
mean the next release notes silently miss a change.
