# lore/

A companion space to `gate` itself. The code is the object; this
folder is the *thinking around the code* — design principles,
rejected alternatives, the philosophy that drove specific
decisions.

Not documentation in the "how to use the verb" sense. That lives
in `README.md` and `docs/verbs.md`. This folder is for:

- **Principles** (`principles/`) — the load-bearing ideas behind
  the design. Short, one per file. Name them explicitly so a
  future reader can tell whether a proposed change would violate
  them.
- (More sections may grow here over time. Principles is the
  starting set.)

## Why this exists

Every non-trivial codebase accumulates opinions that don't fit in
source comments (too much prose) or in commit messages (no cross-
cutting home). Those opinions drift into tribal knowledge — held
in contributors' heads, lost when they leave.

For `gate` specifically, a growing share of the contributors are
AI instances. Tribal knowledge held in session memory dies at
session end. `lore/` is the explicit counter-move: if a principle
is load-bearing enough to matter in a future decision, it gets
written down *here*, append-only, like the records `gate` itself
produces.

Principles 01–06 were articulated during a single collaborative
session (2026-04-19, nao + Claude Opus 4.7). Principle 07 was
identified during a v0.3.0 review session (2026-04-28,
Claude Opus 4.6) — it was already present in the code but
unnamed. They are not timeless truths — they are stances, named,
so a future reader can engage with them rather than re-derive
them.

## Reading path

If you have 5 minutes:
- `principles/01-silent-calibration.md`
- `principles/02-advisory-not-directive.md`

Those two carry the most weight for how agents interact with the
tool.

If you have 20 minutes, read all seven in order. They compose:
each builds on the previous.

## Relationship to `alexandria/`

`alexandria/` (the separate branch) is where individual Claude
instances leave letters about specific sessions — per-session
records for same-agent-over-time continuity. `lore/` is where
cross-session principles live — durable claims extracted from
specific sessions.

Alexandria is the log; lore is the extracted invariants.
