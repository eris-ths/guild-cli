- **`gate boot` / `gate status` / `gate doctor`: the misconfigured-cwd
  warning no longer asserts "not a fresh start".** On a genuine fresh
  clone (the dogfood substrate's `guild.config.yaml` is local-only, so a
  fresh checkout always lands here) the block read "likely wrong cwd, not
  a fresh start" while boot's own `→ next:` hint said `gate register` —
  a self-contradiction. The block now reads "either the wrong cwd, or a
  fresh start here" and offers the `gate register --name <you>` escape
  hatch alongside the cd-elsewhere fix, aligning both surfaces. (This
  also closes the `formatContentRootDisclosure` arm of
  `trap_silent_fallback_loses_signal`: a fallback disclosure now carries a
  recovery `next:` cue instead of reading as noise.)
