- **`gate show` / `gate chain` / `gate wave-status`: not-found errors
  now honor `--format json` (#408).** Pre-#408 these surfaces
  emitted `not found: <id>\n  try 'gate list' or 'gate tail' ...`
  as free text even when the caller requested `--format json` —
  tool-use agents that pipe `gate show <id> --format json` into a
  JSON parser tripped on the prose. A new `notFoundEnvelope` helper
  in `src/interface/shared/notFoundHint.ts` renders the same
  information through the existing envelope shape used by `whoami`
  and the write-verb error path (issue #194 lineage):
  `{ok:false, error:{kind:'not_found', entity, id, message, hint}}`.
  Text and `--plain` formats are unchanged — the asymmetry the PR
  fixes is "format flag was ignored", not "format default changed".
  Unknown-command and `lore` not-found are out of scope (separate
  contract decisions; tracked in #408 discussion).
