- **`gate request` (text mode) now emits a `suggested_next` line for
  cross-actor waves, not only self-waves.** Previously a non-self-wave
  request dead-ended at `✓ created: <id> (state=pending)` with no pointer
  to the approve step, while every other write verb (and the JSON
  surface's `suggested_next`) left a next-line. It now prints
  `suggested_next: gate approve <id>`, pre-filling `--by <host>` only when
  exactly one host is configured — mirroring `deriveSuggestedNext`'s
  pending branch, where multiple hosts must be chosen explicitly so one
  operator isn't silently nominated.
- **`gate boot` / `gate status` / `gate doctor`: the misconfigured-cwd
  warning no longer asserts "not a fresh start".** On a genuine fresh
  clone (the dogfood substrate's `guild.config.yaml` is local-only, so a
  fresh checkout always lands here) the block read "likely wrong cwd, not
  a fresh start" while boot's own `→ next:` hint said `gate register` —
  a self-contradiction. The block now reads "either the wrong cwd, or a
  fresh start here" and offers the `gate register --name <you>` escape
  hatch alongside the cd-elsewhere fix, aligning both surfaces.
