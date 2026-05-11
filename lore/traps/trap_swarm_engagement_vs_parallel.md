---
relevant_until: indefinite
---

# trap: swarm engagement vs. parallel impl

**Pattern.** "Parallel ≠ swarm. Substrate engagement is what reduces
coordination context cost, not raw concurrency."

A wave that runs N executors in parallel without each writing back to
the substrate (claim, witness, status_log timestamps, agora suspensions
when judgment forks) leaves the orchestrator's working memory holding
all the cross-actor state. The orchestrator becomes the bottleneck;
context window fills with who-is-doing-what bookkeeping that should
have lived in records the substrate provides.

The trap surfaces as: "we ran 3 implementers in worktrees and merged,
why does the next session feel disoriented?" — because nothing on
disk explains *which* slice each implementer owned, *when* they
acknowledged blocking review, or *why* slice B was deferred. The PR
itself is testimony; the substrate is record. Re-reading PRs to
reconstruct context is the cost the substrate primitives exist to
avoid.

## Trigger conditions for review

A reviewer should flag a parallel-impl wave as falling into this trap
when ANY of:

- The wave has multiple executors but no `gate witness` records per
  executor — coordination state lives in chat / orchestrator memory.
- A retrospective talks about "what each Claude did" without pointing
  at substrate primitives that recorded it (claim notes, witness
  notes, agora moves, status_log timestamps).
- The next session needs an oral hand-off to know the wave's state.

## Promotion history

Promoted to `lore/principles/14-substrate-engagement-reduces-coordination-context-cost.md`
on 2026-05-11 after two independent observations cleared the dogfood
bar:

1. PR #291 retrospective from a different Claude instance naming the
   insight after a 2-slice swarm wave.
2. eris's own 2-slice swarm dogfood
   (`substrate/swarm-experiments/2026-05-11-eris-swarm-test/`) on the
   same day, surfacing the same gap from the orchestrator side.

The trap stays pinned so future review can name the pattern by file
even after the principle is internalised — naming is the affordance,
not the proof.
