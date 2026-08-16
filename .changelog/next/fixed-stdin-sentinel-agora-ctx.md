`--flag -` (read the value from stdin) now works on every prose flag in
`agora` and `ctx`, not just on `gate`.

The sentinel was wired handler-by-handler on `gate` — round 3 of the
dogfood sweep closed `gate message` and `gate broadcast`, which had been
accepting the token and storing the literal `-`. The same gap was still
open everywhere outside `gate`: `agora move --text -`,
`agora suspend --cliff -/--invitation -`, `agora conclude/resume
--note -`, and `ctx record/supersede --fact -` all wrote a one-character
body and exited 0.

That failure mode is expensive in proportion to how much the record
mattered. A downstream house used the convention for a day and lost 18
`agora` moves and 9 `ctx` facts — including the handoff move written for
a context compaction, i.e. the one record that existed *because* no
other copy would survive. Nothing surfaced at write time; `agora last`
after the compaction was the first signal.

`src/interface/shared/stdinSentinel.ts` now holds the shared resolver,
so a passage that grows a prose flag inherits the behaviour instead of
re-deriving it. It adds two guards over the plain `if (v === '-')`
shape:

- **at most one sentinel per invocation** — there is one stdin, and
  `agora suspend --cliff - --invitation -` cannot be satisfied; feeding
  the same bytes to both would be worse than refusing;
- **a blank body is refused** — an empty pipe would otherwise reproduce
  the silent-empty record the wiring exists to prevent.

`gate` is deliberately untouched in this change: `gate rom` and
`gate repair` already treat `-` as a *JSON* input they read themselves,
so they are not prose-flag surfaces. Their empty-stdin behaviour is a
separate question from this fix.
