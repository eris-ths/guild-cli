- `delta` can now keep its deposits in a single human-editable markdown
  ledger instead of one YAML file per deposit. Point `GUILD_DELTA_LEDGER` at
  the file and every verb reads and writes it. The reason is the constraint
  the passage is built around: depositing must stay cheaper than the task it
  interrupts, and the cheapest surface that exists is a shell append —
  `printf -- '- [%s] %s\n' "$(date '+%m-%d %H:%M')" "..." >> ledger.md` — no
  process start, no id allocation, no destination decision. An operator who
  must run a CLI to deposit will, under load, simply not deposit. So the
  write path stays `>>` and the CLI takes the read and deliver side, where
  state transitions actually need recording: **deposit = append, routing =
  CLI.** The ledger's sections are found structurally rather than by heading
  text, because the invariant that matters is not lexical — appends land at
  the end of a file, so the outstanding-deposits section must be last, and a
  ledger whose sections are inverted swallows every future deposit into
  history while still parsing cleanly and printing plausible counts. That
  inversion is detected and refused with a recovery path rather than read.
  Ids are derived rather than stored, since writing ids into the file would
  tax the one surface that must stay free; derivation is ranked by
  `(time, text)` within a day so that appending a delivery annotation and
  moving the line out of the outstanding section — the only edits the ledger
  actually receives — renumber nothing. Editing a deposit's prose does
  renumber that day, which is the honest trade for a ledger that is the
  source of truth. A delivered line is moved, never deleted: a ledger that
  forgets where a deposit went cannot answer "have we already decided this?",
  which is the question it exists to answer.
