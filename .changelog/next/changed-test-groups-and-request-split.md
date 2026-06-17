- **Per-group test scripts.** `package.json` gains `test:domain`,
  `test:application`, `test:infrastructure`, `test:interface`,
  `test:passages`, and `test:e2e` — each builds then runs only that
  subtree via `node tests/run.mjs dist/tests/<group>` (the runner already
  accepted a root argument). Iterating on one area no longer requires the
  full ~1.8k-test suite. The default `npm test` is unchanged.
- **Split the largest domain test file.** `tests/domain/Request.test.ts`
  (1158 lines, 69 tests) is broken into focused files sharing one
  fixture module: `RequestId.test.ts` (id format), `RequestSlices294.test.ts`
  (the self-contained #294 per-executor slice-closure block), and the
  trimmed `Request.test.ts` (core lifecycle / serialization / actor
  stamps), with `_requestHelpers.ts` holding the shared clock + builder.
  Same 69 tests, no behavior change — just navigability. (Exemplar for
  the remaining large files; `ax.test.ts` is left untouched here to avoid
  colliding with an in-flight change.)
