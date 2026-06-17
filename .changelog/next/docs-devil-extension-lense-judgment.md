- **Docs: documented that devil's no-gaps coverage gate extends to
  judgment axes via content_root extension lenses (#134 G).** The
  `ComposedLenseCatalog` override path (`<content_root>/devil/lenses/
  <name>.yaml`, merged over bundled defaults at startup, wired in
  `interface/container.ts`) was shipped and wired but undocumented —
  every doc still framed devil as security-only. Dogfooding it for real
  (authored a `correctness.yaml` extension, opened a `--type system`
  review, filled the lense with zero skip-spam) confirmed the path
  works end to end. Added an "Extending the catalog per content_root"
  section to `src/passages/devil/README.md` (with a YAML example and the
  `LenseCollision` extend-only policy), an "Extending instead of
  skipping" subsection to the playbook's "When NOT to use devil"
  (the skip-spam warning is about the *bundled* catalog; an extension
  catalog removes the spam), and corrected the `CLAUDE.md` devil
  one-liner, which mislabeled gate's review lenses (devil/layer/
  cognitive/user) as devil's catalog and called devil security-only.
