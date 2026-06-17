- **Split `tests/interface/ax.test.ts`** (1549 lines, 56 tests — the
  largest test file) following the #421 exemplar. The four largest
  cohesive sections move into focused, well-named files sharing one
  fixture module:
  - `_axHelpers.ts` — the shared `bootstrap` + `runGate` + `rid`/`today`
  - `axSuggest.test.ts` — `gate suggest` tight-loop behavior
  - `axVerbsAvailableNow.test.ts` — `boot.verbs_available_now` discovery
  - `axVoiceCalibration.test.ts` — Two-Persona Devil voice memory
  - `axThank.test.ts` — `gate thank` appreciation primitive
  - `ax.test.ts` (trimmed, 648 lines) keeps the remaining AX affordances
    (suggested_next routing, JSON error envelope, board/show surfaces,
    advisory semantics, transcript, --plain, --dry-run, the text footer).
  Same 56 tests, no behavior change — navigability only. (`boot.test.ts`,
  the other 1.4k-line file, is the remaining follow-up.)
