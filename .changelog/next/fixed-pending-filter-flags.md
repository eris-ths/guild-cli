- **Docs + touch-feel: `gate pending`'s filter surface is now accurate
  and self-directing.** `docs/verbs.md` had lumped `gate list` and `gate
  pending` together as accepting `--from / --executor / --auto-review /
  --for`, but `pending` is the lean "--for me" shortcut — its known flags
  are `{for, format}` and it rejects the richer filters (surfaced by a
  two-persona review red-teaming the #426/#427 docs work, which had
  reasoned about `list` in isolation). The doc now describes `list`'s full
  filter set and `pending`'s narrow one separately, pointing richer
  pending filtering at `gate list --state pending`. And the runtime
  matches the advice: `gate pending --executor <m>` (or `--from` /
  `--auto-review`) no longer dead-ends at "valid flags: --for, --format"
  — it appends `to filter pending by author/executor/reviewer, use: gate
  list --state pending …`. (`rejectUnknownFlags` gained an optional
  `hint`; only `pending` passes one, so every other verb's error is
  unchanged.) Pinned by `tests/interface/pendingFilterFlags.test.ts`.
