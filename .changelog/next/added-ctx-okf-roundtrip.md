- **`ctx export` / `ctx import` — Open Knowledge Format (OKF) round-trip.**
  ctx facts can now be projected to and recorded from
  [OKF](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/)
  bundles (a directory of `<id>.md` files: YAML frontmatter + fact prose,
  plus generated `index.md` / `log.md` views). `ctx export <dir>` writes
  the bundle; `ctx import <dir>` records it back. Guild-authored bundles
  round-trip losslessly — id, timestamp, author and tags survive, and a
  re-import is idempotent (existing ids skip). Foreign bundles import
  tolerantly: nested subtrees are walked, bare/prefixed tags are coerced
  to `prefix:value` (bare → `topic:`), a non-`Fact` type is preserved as
  an `okf:<type>` provenance tag, missing authors fall back to `--by`,
  and empty/unparseable documents are reported as skipped rather than
  failing the import. Prose dedup is on by default — a fact whose
  normalized prose is already recorded (under any id, or earlier in the
  same bundle) is skipped, so even an id-less foreign bundle re-imported
  is a no-op; `--allow-duplicates` opts out. OKF is an interchange
  *projection* (principle 11), not a storage change — the on-disk
  substrate stays YAML.
