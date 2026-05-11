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

## Naming

`trap_<short_pattern_slug>.md`. The slug should match the pattern
name as it would surface in a review comment: a reader cross-checking
"is this the silent-fallback-loses-signal pattern?" should be able
to find the file by name alone.
