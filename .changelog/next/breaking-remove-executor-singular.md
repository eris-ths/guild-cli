- **BREAKING (v0.6 cut, closes #239): `--executor` (singular) and the
  `executor` JSON alias are removed.** The multi-executor surface
  introduced in #230 carried both forms for a v0.6 deprecation
  window; 330 commits later the singular form is gone:
  - `gate request --executor <m>` → use `gate request --executors <m>`
  - `gate fast-track --executor <m>` → use `gate fast-track --executors <m>` (omit for self-execute)
  - `gate issues promote <id> --executor <m>` → `--executors <m>`
  - `gate show --format json | jq .executor` → read `.executors[].name`
  - `CreateRequestInput.executor: string` (domain/application) → use
    `executors: readonly string[]` (the only form accepted as input)
  Hydrate is unchanged: YAML records written before #230 with the
  legacy `executor: <string>` field still load via
  `YamlRequestRepository.hydrate` (records-outlive-writers per
  principle 04). Only the *input* surface is removed.

- **`Request.toRenderJSON()` removed.** It was a back-compat
  shim that copied `toJSON()` and added the deprecated `executor`
  key; callers (`gate show / list / board`, dry-run preview) now
  call `toJSON()` directly. The render-vs-persistence split was
  there to keep the deprecated alias from polluting on-disk
  records — with the alias gone, the separation has no reason to
  exist.

## Migration

If you have shell scripts using `--executor <m>`, replace with
`--executors <m>` (same value, plural flag). If you have tooling
parsing `gate show --format json | jq .executor`, switch to
`.executors[].name` — the field has been `executors[]` (an array
of `{name, status}` objects since #294) for the entire v0.5.x
range; the singular alias was the only thing keeping the old
shape compatible.

`agent-loop / SubAgent` callers already use `--executors` as of
PR #382 (the `executors-singular-to-plural-in-examples` sweep), so
no action is required there.
