- **`gate list --state <bogus>` now enumerates the valid states instead
  of dead-ending.** It errored with a bare `Invalid state: <x>` and no
  valid set, while sibling unknown-flag errors list their valid flags — an
  asymmetric touch-feel that violated the "error + recovery path" house
  style. `reqList` now validates `--state` at the interface boundary and,
  on a miss, names the full CLI-valid set: `pending, approved, executing,
  completed, failed, denied, all` (built from the domain's `REQUEST_STATES`
  ∪ the interface-only `all` sugar, so it can't drift from the enum) plus a
  note that omitting `--state` uses the verb's default. The app-layer guard
  in `RequestUseCases.listByState` stays as defense-in-depth. State
  vocabulary lives in the domain; the CLI-facing hint is an interface
  concern — same split as the deny/execute verb redirects. Pinned by
  `tests/interface/listInvalidState.test.ts`.
