- **`gate issues promote` now accepts `--format json|text`.** It is a
  write verb but previously had no `--format`, so an agent couldn't
  receive the created request id as JSON — a schema-as-contract gap
  (principle 10), since every other write verb returns the unified
  `ok` / `id` / `state` / `message` / `suggested_next` envelope. promote
  now shares that envelope via `emitWriteResponse`, so its JSON shape is
  stable with `gate request`. The resolved-issue id rides in `message`
  (`✓ promoted i-… → … (issue resolved)`), so both the new request id and
  the resolved issue id stay greppable from the structured output
  (records-outlive-writers). Text output is unchanged; no `--format`
  defaults to text (back-compatible). Surfaced by a playbook dogfood pass.
