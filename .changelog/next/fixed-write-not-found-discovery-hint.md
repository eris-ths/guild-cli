- **Write-lifecycle not-found errors now carry the same discovery hint
  the read verbs already emit.** `gate approve` / `deny` / `execute` /
  `complete` / `fail` on a mistyped or stale id threw `Request not found:
  <id>` straight through the shared error envelope with no pointer to
  recovery — while `gate show <id>` (and the other read verbs) had carried
  `try 'gate list' or 'gate tail'` since the not-found-hint work. The two
  not-found surfaces disagreed; the write side was the worse touch-feel.
  `emitErrorEnvelope` now performs the wire-up sweep its own doc
  anticipated: a recognized `Request not found` gains the prose hint line
  plus, under `--format json`, an `error.hint` field and a structured
  `error.recovery` (`{verb: "list", …}`) — `error.message` stays clean so
  existing parsers are unaffected. Both the dry-run (plain `Error`) and
  real (`DomainError`) not-found paths are covered. Sibling passages
  (agora / devil / ctx) that share the envelope are untouched: the hint is
  attached only for the `request` entity, never stapled onto an unrelated
  `Play not found` / `Review not found`.
