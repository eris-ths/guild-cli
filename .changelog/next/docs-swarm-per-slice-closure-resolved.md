- **Docs: `docs/swarm.md` marked the "One lifecycle for N executors"
  limitation RESOLVED (#294).** The Known-limitations list still
  described `gate complete` as firing once for the whole wave with
  per-slice closure "not first-class" — but #294 (per-executor slice
  closure) shipped that since. Running the worked sequence for real
  surfaced the drift: `gate complete --by agent-alpha` on a two-slice
  wave reports `open slices remaining: agent-beta` and leaves the
  wave executing; only the final `--by` auto-transitions it to
  `completed`. Struck the limitation through (kept for the trail) with
  a note on the resolved behavior and the `executors` object-shape /
  `jq '.executors[] | (.name // .)'` migration. Also corrected the
  step-7 code comment in the worked sequence, which still read
  "one complete (lifecycle is wave-scoped, not per-executor)" — now
  shows the per-slice `complete --by <each>` shape.
