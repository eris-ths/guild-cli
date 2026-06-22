- **`changelog-release` now refuses to run when `.changelog/next/` holds
  a file with an unrecognized category, instead of warning and silently
  leaving it behind.** A `docs-foo.md` (no `docs` category exists) used to
  be `warn`ed-and-skipped while the release still exited 0 — the entry was
  dropped on the floor and the orphan lingered for every future release
  ("silence reads as success"). The script now collects such files as
  *orphans* and exits 1 with a per-file list and the fix (rename to a
  valid category, or delete — docs-only changes have no fragment). The
  same guard fires under `--dry-run`/`changelog:preview`, so a
  mis-categorized fragment surfaces before release. `.changelog/README.md`
  documents that docs-only changes get no fragment. (#441, surfaced by the
  0.7.0 release dogfood.)
