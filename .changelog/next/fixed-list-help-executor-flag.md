- **`gate --help` now advertises the `list` filter as `--executor <m>`,
  matching the runtime.** The BASE catalog line showed `gate list …
  [--executors a[,b,...]]` (plural, copied from `gate request`'s
  multi-executor flag), but the `list` verb accepts only `--executor`
  (singular — "match waves naming this one executor") and rejects
  `--executors` with "unknown flag". An agent copying the advertised flag
  from `--help` hit a wall — a help-text ↔ runtime drift (principle 10 /
  `trap_help_text_drift_on_new_verb`). Help line corrected; a regression
  test pins the help and the runtime KNOWN_FLAGS to the same singular flag.
