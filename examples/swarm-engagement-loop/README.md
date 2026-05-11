# swarm-engagement-loop

This is a content_root — a substrate-tracked space, not documentation.

A real 2-day cross-instance arc preserved as an example. From
2026-05-10 morning through 2026-05-11 late morning, the production
of [`lore/principles/14-substrate-engagement-reduces-coordination-context-cost.md`](../../lore/principles/14-substrate-engagement-reduces-coordination-context-cost.md)
unfolded across three coordination surfaces (GitHub PRs/Issues, the
gate substrate, and local devil-side memo files) and crossed an
instance boundary (eris + an independent Claude that shipped
PR #291). Each individual step landed on its own surface; the
**connective tissue between the steps** — "why step 5 confirmed
step 3's insight enough to promote the trap memo to lore" — lived
only in the orchestrator's working memory and would have decayed
at session end.

The agora play in this content_root is **that connective tissue
preserved as substrate** — 7 moves capturing each step from combo
C3 surface (Step 1) through the final loop-closure on PR #291
(Step 7), concluded with a substrate-honest note. The play is
deliberately *the principle's own evidence trail* recorded using
the very primitive (agora) that principle 14 is about: parallel
to [`examples/three-passages-framing/`](../three-passages-framing/),
which records the production of the gate / agora / devil dispatch
framing using the agora primitive.

## Why this is here

Principle 14 names a problem: coordination state held only in the
orchestrator's working memory decays at session end. This example
is the principle applied to its own production. The principle
file in `lore/principles/` is the synthesis; this play is the
evidence. A reader visiting `lore/principles/14-...` six months
from now will see the rule; a reader visiting this play will see
how the rule came into being.

Most agora examples one might construct would be designed to
teach a verb. This one isn't. It's the actual trail of a
multi-PR, multi-instance arc preserved before the
orchestrator's working memory dropped it.

## Read it

```bash
cd examples/swarm-engagement-loop
GUILD_ACTOR=eris node ../../bin/agora.mjs show 2026-05-11-001 --format text
```

The output shows all 7 moves in chronological order with the
concluded_note summarizing the meta-lesson. Each move references
the concrete artifacts (PR numbers, file paths, observation
sequences) that landed on other surfaces — the play composes them
into a single readable arc.

## Structure

- `guild.config.yaml` — `host_names: [nao]`. nao is the human
  interlocutor for the arc; eris is the AI orchestrator.
- `members/eris.yaml` — the actor who authored the play (and
  wrote the moves describing what she observed and decided).
- `agora/games/swarm-engagement-loop.yaml` — the Sandbox game
  declaration.
- `agora/plays/swarm-engagement-loop/2026-05-11-001.yaml` — the
  concluded play. 7 moves; no suspensions (the arc didn't have a
  cliff-then-answer shape, it was a sustained production loop);
  `concluded_note` carries the meta-lesson.

## What this is not

- Not a tutorial for verbs — read [`docs/verbs.md`](../../docs/verbs.md)
  § Agora for that, or [`docs/playbook.md`](../../docs/playbook.md)
  § Swarm × Claude SubAgent harness for the worked recipe that
  this arc validated.
- Not the principle itself — read
  [`lore/principles/14-substrate-engagement-reduces-coordination-context-cost.md`](../../lore/principles/14-substrate-engagement-reduces-coordination-context-cost.md)
  for the rule. This play is the trail behind that rule.
- Not perpetually open — the play is **concluded**. The next
  observation that contests, extends, or breaks principle 14
  belongs in a new play that `--addresses` this one, not a
  mutation here.

## Cross-references (the artifacts the play points at)

### Shipped PRs

| PR | Title | What it shipped |
|----|-------|----------------|
| #292 | fix(boot): warnings[] (combo C3) | Instance 2 of combo C3 — `BootPayload.warnings` |
| #293 | docs(playbook): swarm × SubAgent harness section | The worked recipe + failure-mode-named subsection |
| #296 | feat(swarm-dogfood): SessionEvent drift + cwd-fallback next: hint | eris's own 2-slice swarm wave (the felt-not-just-read confirmation) |
| #297 | feat(lore): principle 14 | The lore promotion |
| #298 | feat(gate): wave-status verb | Closes #295 — per-executor in-flight status |
| #299 | chore: move wave-brief templates to canonical location | Cleanup of `.tmp-asteria-235/` |
| #300 | docs(readme): tidy + principle 14 link | README integration of recent work |

### Closed Issues

- #134 (lense extension + strict mode) — via #275 + #276 + #277
- #274 (H2 tracking) — via #275
- #279 (fast-track hooks) — via #281
- #280 (hook context shape, B-arm) — via #282 + #284
- #283 (drift detection) — via #284
- #295 (wave-status) — via #298

### Open at the end of the loop

- #36 (umbrella roadmap)
- #239 (v0.7 chore)
- #294 (slice-closure design)

All actionable, all scoped, with named close conditions per the
2026-05-11 status snapshot on #36.

## When another play like this belongs in `examples/`

A future arc earns a content_root in `examples/` (or via the
Discussions/Retrospectives category) when **the production of a
lore principle, the resolution of a multi-week design tension, or
a substrate-shape decision involved more than two coordination
surfaces and crossed an instance boundary**. Single-issue close:
PR description suffices. Multi-PR feature: CHANGELOG suffices.
Cross-instance, cross-surface loop that produced a principle:
this shape.
