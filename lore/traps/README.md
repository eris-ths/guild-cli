# lore/traps/

Trap memory — pinned patterns that aren't yet `lore/principles/`-grade
but are load-bearing enough to surface in future review (devil-side
memory MCP lookup, post-PR review prompts).

A trap is a one-page markdown file that names a pattern, sketches the
mechanism, and lists the trigger conditions a reviewer would use to
flag it. Traps graduate to `lore/principles/` when two independent
observations clear the *felt-not-just-read* bar (see lore/README.md
for the promotion mechanism).

## Frontmatter

Each trap may declare a `relevant_until` field for retirement
(#327, axis 5 of the solo/swarm coexistence proposal):

```
---
relevant_until: 2026-08-01     # ISO date; gate doctor sweep-traps
                                # quarantines after this date
relevant_until: indefinite     # never auto-swept (default semantics
                                # when frontmatter is absent)
---
```

`gate doctor sweep-traps` (without `--apply`) lists which traps would
be retired. `gate doctor sweep-traps --apply` moves expired traps to
`<content_root>/trap-quarantine/` and appends a `quarantine` event to
`<content_root>/trap-retirement-log.yaml`. Revive a quarantined trap
with `gate doctor sweep-traps --revive <filename>` (records a `revive`
event in the same log).

Per principle 04 (records-outlive-writers), retirement is quarantine,
not deletion: a future reader can always reconstruct what the trap
said and why it was retired.

## When to use a date vs `indefinite`

Choose based on **why the trap exists**, not on how cautious you feel:

- **`indefinite`** — the trap names a pattern with no expected
  resolution event. Anti-patterns rooted in the medium (substrate,
  filesystem, AI session boundaries, etc.) belong here. A trap is
  also `indefinite` when it is a candidate for promotion to
  `lore/principles/`: if the pattern is felt-not-just-read enough
  to make it into principles, retirement is *graduation*, not
  expiry — and graduation has no calendar date.

- **`relevant_until: <YYYY-MM-DD>`** — the trap exists because of
  a specific in-flight situation. Use a concrete date when:
  - the trap pins a workaround for a bug being actively fixed
    (date ≈ the bug's expected fix-ship date plus a re-read buffer)
  - the trap surfaces a friction tied to a feature still in design
    (date ≈ design-lock date for that feature)
  - the trap captures a one-off lesson whose relevance fades as
    the codebase moves past the conditions that produced it
    (date ≈ "review me by then to decide if this is still load-
    bearing")

The default when frontmatter is absent is `indefinite` (safe,
principle-04-aligned). Reach for a date only when you can name the
event the date is tracking; if you cannot, the trap is `indefinite`
even if you feel uncertain.

## Naming

`trap_<short_pattern_slug>.md`. The slug should match the pattern
name as it would surface in a review comment: a reader cross-checking
"is this the silent-fallback-loses-signal pattern?" should be able
to find the file by name alone.
