- **Transition-redirect errors now carry `error.code` again, not just
  `error.recovery`.** `RecoverableError` (thrown by the verb-shape
  redirects: `execute`-from-pending → approve, `complete`-from-approved
  → execute, `deny`-from-executing → fail, `fail`-from-pending/approved)
  reworded the message away from the domain's "Illegal state transition"
  phrasing, so `deriveErrorCode`'s prose scan stopped classifying it and
  the JSON envelope emitted `recovery` but a `code: undefined`. An agent
  branching on `error.code` was blind to exactly the errors carrying the
  richest recovery hint (surfaced dogfooding the JSON surface as an
  orchestrator). `RecoverableError` now carries a `code` (default
  `illegal_transition`, overridable) and the envelope emits it — so every
  redirect error classifies as `illegal_transition` *and* ships a
  dispatchable `recovery`. `not_found` and the plain transition errors are
  unchanged.
