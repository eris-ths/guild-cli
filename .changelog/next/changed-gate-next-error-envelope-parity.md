- **`gate next` setup-failure errors now flow through the structured
  JSON error envelope** instead of plain-text `error: <msg>` on
  stderr. Three sites (GUILD_ACTOR not set / actor not registered /
  --confirm but verb needs extra args) used to write
  `process.stderr.write('error: ...')` + `return 1`, bypassing the
  outer-catch's `emitErrorEnvelope` helper. JSON consumers got plain
  text where every other gate verb gives them
  `{"ok":false,"error":{"message":"...","field":"...","code":"..."}}`.
  After this PR, the first two throw `DomainError(field='GUILD_ACTOR')`
  and route through the standard envelope; the third (post-plan-emit
  failure) emits the plan with `dispatched: false` and confines the
  prose hint to text mode.

- **`gate next --confirm` on a verb-needing-args now emits `dispatched: false`**
  in the plan envelope (was `dispatched: true` — misleading, since
  nothing was dispatched). Consumers branching on `dispatched` to
  decide retry semantics were getting false positives.

  Follow-up to #400's success-path notice gating: same eris-first
  cleanup applied to error paths.
