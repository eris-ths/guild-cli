- **`gate voices` (no positional) now emits a per-actor utterance
  index instead of a bare usage error.** Pre-fix the no-arg invocation
  returned `Usage: gate voices <name>` with no way to discover *which*
  actors had utterances to walk — a silent-fallback signal-loss
  against the discovery question (`trap_silent_fallback_loses_signal`).
  Index counts both authored requests and reviews, labels each row
  `member` / `host` / `historical`, and sorts by activity desc.
