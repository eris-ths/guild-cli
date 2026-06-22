- **`changelog-release` now also bumps the `version` field in
  `package.json` and `package-lock.json` (root + `packages[""]`) to the
  release version**, in the same step that rewrites `CHANGELOG.md`.
  Previously the script only touched the changelog, so a release had to
  remember to bump the manifests by hand — and the 0.7.0 release didn't,
  leaving `package-lock.json` at `0.6.0` until CI's version-drift guard
  caught it (#442). The bump is a byte-stable text replacement (only the
  version line(s) move), and `--dry-run`/`changelog:preview` reports the
  would-bump without writing. `.changelog/README.md` documents the new
  release step and the annotated `vX.Y.Z` tag convention. (#441/#442
  follow-up.)
