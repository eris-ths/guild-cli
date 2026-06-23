- **`ctx supersede <old-id> --fact "..."` — the first phase-2 ctx verb.**
  ctx records are immutable on save, so a correction is not an in-place
  edit: `supersede` records a **new** fact whose `supersedes` field points
  back at the one it replaces. The old record is never mutated, so the
  ledger keeps both and the supersession is reconstructable from the
  forward-only link alone. `ctx list` now folds superseded facts out by
  default (showing the current head of each chain) and gains `--all` to
  keep every fact, marking the superseded ones; `ctx show <old-id>` stays
  readable and resolves the reverse `superseded_by` link at read time. A
  chain is allowed (C supersedes B supersedes A) and stays acyclic — every
  link points strictly backward to an id that already existed, and the
  domain rejects a self-supersession outright. Superseding an id with no
  record is a recoverable not-found (a correction must point at something
  real). The `supersedes` key is omitted from an ordinary record's YAML, so
  phase-1 records round-trip byte-for-byte. Remaining phase-2 verbs: `fork`
  / `chain` / `status`.
