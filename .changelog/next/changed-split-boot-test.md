- **Split `tests/interface/boot.test.ts`** (1444 lines, 42 tests — the
  last of the three oversized files, after #421/Request and #422/ax).
  Its seven helpers (`bootstrap` / `runGate` / `escapeRegex` /
  `bootstrapWithMembers` / `registerMember` / `makeRequestWithTarget` /
  `makeRequestSessioned`, plus the `GATE` path) were interleaved through
  the file; they're now centralized in `_bootHelpers.ts` and the tests
  split by concern:
  - `boot.test.ts` (trimmed) — JSON-shape stability, actor/role,
    misconfigured-cwd, content_root_health, content-root disclosure, tail
  - `bootReviewedAuthored.test.ts` — the reviewed-authored surface
  - `bootOverlap.test.ts` — `active_overlapping_targets` + same-actor
    parallel-session detection (#234 / #249)
  - `bootWarnings.test.ts` — the C3 silent-fallback warnings
  Same 42 tests, no behavior change. With this the three big test files
  (Request 1158, ax 1549, boot 1444) are all decomposed.
