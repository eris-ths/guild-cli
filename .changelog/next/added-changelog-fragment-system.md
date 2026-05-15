- **`.changelog/next/` fragment system replaces concurrent writes to
  `CHANGELOG.md`'s `[Unreleased]` block.** Each PR drops one file at
  `.changelog/next/<category>-<slug>.md`; at release time
  `npm run changelog:release -- <version>` collects fragments,
  groups by category, and rewrites the `[Unreleased]` block. Per-PR
  filenames make textual conflicts impossible — the previous "append
  to end of section" convention still produced duplicate `### Fixed`
  sub-headings when PRs raced. See `.changelog/README.md` for the
  format.
