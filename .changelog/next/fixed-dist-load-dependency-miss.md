- **bin entries: a missing dependency is no longer misreported as an
  unbuilt `dist/`.** On a fresh clone where `tsc` had run (so `dist/`
  exists) but `npm install` had not (so `node_modules` is absent), the
  bare `yaml` import failed and every `gate`/`guild`/`agora`/`devil`/`ctx`
  invocation printed `dist/ not built (or out of date) … npm run build` —
  pointing the operator at a rebuild when the actual fix is installing
  deps. Node phrases the failure as `Cannot find package 'yaml' imported
  from <dist importer>`, so the old `/dist/` message scan misclassified
  it. The 5 inlined catch-blocks now delegate to a shared
  `bin/_lib/handleDistLoadError.mjs` that distinguishes a bare-specifier
  dependency miss (→ `dependency '<pkg>' is not installed … npm install`)
  from a genuine missing/stale `dist/` (→ unchanged build message +
  transitive-miss hint). New unit tests in
  `tests/interface/distLoadError.test.ts` pin both paths.
