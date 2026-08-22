- **`gate doctor --format json` now carries `content_root` and
  `config_file`.** The text and `--summary` surfaces disclose the
  resolved root only when it is surprising (cwd outside the root, or
  no config found); a structured consumer has no such notion and
  needs to know which root produced the counts on every run. Both
  fields are unconditional; `config_file` is `null` on the
  cwd-as-fallback path, matching `gate boot`'s `hints.config_file`.
  Additive — `gate doctor --format json | gate repair` is unaffected.
