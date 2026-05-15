- **`gate boot --by <actor>` (and `--as` alias) now resolves identity
  for one invocation, overriding `GUILD_ACTOR`.** Pre-fix the
  muscle-memory `gate boot --by eris` bounced with
  `unknown flag: --by` because boot only consulted env. Lifecycle
  verbs all take `--by`; aligning boot removes the cross-verb
  surprise.
