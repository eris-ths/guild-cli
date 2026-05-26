---
applies_to: swarm
---

# Substrate as replay corpus for self-optimization

**Records that outlive writers (principle 04), and coordination state stamped into substrate (principle 14), accumulate as a side-effect into a corpus that later agents can replay — re-walking the trace without re-invoking the original work. The audit-side of this property is already extensively engaged (cliff / past_cliffs / transcript / cross-session body switch). The self-optimization-side — substrate read by explorer agents to change the orchestrator's own future behavior — is the next axis this principle invites.**

## Statement

Principle 04 (records-outlive-writers) makes judgment artifacts survive their authors. Principle 14 (substrate engagement) extends the same shape to coordination state. This principle names a **second-order property** of the resulting substrate: it is not merely *read* by future agents — it is *replayable*. The same trace that lets a cold reader understand what happened lets a programmatic agent re-walk it.

A wave record contains enough structure (action, reason, executors, witness notes, lifecycle transitions, review verdicts, cliff prose, terminal state) that a later agent can:

1. **reconstruct the decision state** without asking the original actors — audit, learning, narrative continuity
2. **resume with intent** — cliff + past_cliffs let the next body pick up not just "what's open" but "what was deferred with intent" (Zeigarnik continuity made structural)
3. **evaluate alternative policies** — "what if a different lense had been applied here?" — by re-walking the trace under different assumptions, without re-running the actual work
4. **propose improvements to the orchestrator's own policies** — which lense to invoke when, which devil to chain, when to fast-track vs full lifecycle — by treating past waves as labeled data for an explorer agent

(1) and (2) are already extensively proven inside guild-cli — see the "In practice (already engaged)" section below. (3) and (4) are the **self-optimization axis** that the AutoTTS work (UMD/UVA/WUSTL/UNC/Google/Meta, 2026, "LLMs Improving LLMs: Agentic Discovery for Test-Time Scaling") demonstrated externally: a corpus of pre-saved inference traces became the Petri dish for an explorer agent that discovered a 70% token reduction algorithm in $39.90 / 160 minutes. The substrate's declarative-source + deterministic-interpreter + persisted-trace triple is what made the explorer cheap. The same triple is sitting inside `requests/completed/*.yaml` today.

## The triple that makes replay possible

A substrate is replayable when three properties hold together:

1. **declarative source** — the artifact that drove the work is first-class and re-readable (request YAML, Card definition, inference trace segments)
2. **deterministic interpreter** — given the same source, the interpreter produces the same observable behavior (guild-cli runtime, Atelier's Lua sandbox, AutoTTS's table-lookup replay environment)
3. **persisted trace** — the side-effects and transitions are written somewhere with the same continuity bar as principle 04 (`requests/completed/*.yaml`, witness records, lifecycle log, cliff prose)

When all three hold, "replaying" reduces to **table-lookup**, not re-execution. The cost of the second use is amortized against the first. This is why audit is cheap and why self-optimization can become cheap.

## In practice (already engaged — audit-replay axis)

The audit-replay side of this property is already extensively engaged in dogfood. The principle is naming what readers already do:

- **`gate transcript <id>`** (playbook G5) — walks a wave's full arc as prose for a re-entering instance. The cheapest way to *understand* a wave without reading status_log + reviews + messages separately. The transcript IS a replay surface.
- **`cliff` + `past_cliffs`** (eris-playbook Act IV) — the cliff field is forward-pointing intent the next agent picks up at `gate boot`. Re-rendered by voice plugins. Zeigarnik continuity made structural. "A reader doesn't reconstruct; they re-walk."
- **Cross-Session Body Switch** (playbook S2) — Body A opens a wave, Body B (later, different terminal, distinct session_id) reads the substrate and picks it up. The substrate IS the handoff, no out-of-band message required.
- **Agora-to-Gate Lift** (playbook S3) — agora play's cliff + invitation feed directly into a new `gate request`'s reason + action. One substrate's trace becomes another substrate's source. Replay across passages.
- **D4 dismissal/resolution as audit trail** — even rejected reviews stay in the record. The replay surface includes the *not-taken* paths, which is what makes audit honest.

eris-playbook's coda names the discipline that makes all of the above possible:

> *The craft is in choosing to make every move ledger-shaped — to ask "what would this look like read a week later, by someone who wasn't here?" and shape the action so the answer is "obvious."*

That craft IS the substrate engagement that makes replay possible. This principle puts a name on it.

## In practice (invited — self-optimization axis)

The audit-replay side is engaged. The self-optimization axis — using the same corpus to *change the orchestrator's future behavior* — is what this principle invites. What it would require:

- **structured state-space schema** — explorer agents want a typed view of wave state, not free-form reason fields alone. AutoTTS defines `s_t = (q, m_t, I_t, ℓ_t, Ω_t)` — a typed observation tuple at each timepoint. Wave records could expose an equivalent: which actors are active, which witnesses exist, which transitions remain, what the in-flight intent is. The fast-track shortcut (G2) bypasses this; the full lifecycle gives an explorer something structured to consume.
- **hold-out partitioning** — by default, every completed wave is visible to everyone. If a subset of waves were marked `replay_visibility: hold_out`, a proposer explorer could be denied view, and an evaluator could compare proposal accuracy against actual outcomes on the held-out set. Analog of AutoTTS's `test_environment/` kept hidden from the proposer.
- **explorer-shaped query verbs** — `gate transcript` is human-shaped; agents want `gate replay <id> --observe-as <slot>` that returns the typed observation tuple at a given point in the wave. A new playbook section ("R1: corpus-driven policy proposal" or similar) would name the recipe.
- **policy artifact format** — what does the explorer *output*? Analog of AutoTTS's `method.py` (an `OptimalController` class). In our world: a `policy.lua` Card (lense-selection policy, fast-track threshold, devil-chain trigger). Re-evaluated against hold-out corpus, iterated multi-round, persisted as wave chain.

## Why "self-optimization" is the right framing

"Substrate as audit corpus" would name only the audit use. The explorer use is structurally different: the substrate is being read **to change the orchestrator's future behavior**, not to confirm past behavior. That recursion — substrate teaches its own users how to engage it better — is what justifies the principle's name.

AutoTTS's `OptimalController` (CMC) was discovered by exactly this recursion: a corpus of past LLM inference traces taught an explorer agent how to *control* future LLM inference more efficiently. The substrate of past invocations became the substrate of future policy. The same shape applies inward: a corpus of past gate waves could teach an explorer how to *coordinate* future gate waves more efficiently (which lense earliest, which devil to skip, when to fast-track, when to close).

## Why parallel-execution and replay are different axes

Principle 14 named two complementary axes for parallel coordinated work: filesystem (worktree) and substrate (swarm). This principle names a **third orthogonal axis** for the substrate itself:

| axis | what it provides | what fails without it |
|---|---|---|
| filesystem (worktree) | parallel execution without write race | merge conflicts, lost commits |
| substrate (swarm) | coordination record that outlives the writer | hallucinated coordination state |
| replay (this) | second-order use of the substrate by future readers AND explorer agents | substrate becomes write-only-then-read-once; optimization stalls |

The third axis is already partially engaged on its audit side (cliff / transcript / cross-body switch). It can be retrofitted onto any principle-14 substrate. The self-optimization side is unlocked by the disciplines this principle invites (structured state-space, hold-out partitioning, explorer-shaped verbs, policy artifact format).

## Implications

- **Wave records should be queryable by typed view, not only by prose.** `gate transcript` is human-shaped; an explorer wants `s_t` shape. The transcript format and the explorer observation format are different views of the same record. The schema-as-contract discipline (principle 10) applies to both views.
- **The fast-track shortcut trades replayability for speed.** Acceptable for one-off coordination, but a substrate dominated by fast-tracks loses its corpus value for self-optimization. Use full lifecycle when the wave's *shape* (not just its terminal state) is what later agents — including explorer agents — should learn from.
- **Hold-out partitioning is opt-in, not default.** Most waves should remain visible to all readers. A small fraction marked `replay_visibility: hold_out` enables proposer/evaluator separation without changing the default narrative continuity.
- **The Explorer is swappable.** AutoTTS used Claude Code; an internal `yori-code` Agent backend (Gemini-bridged) could be swapped in for environments where Anthropic billing is off. The substrate's interface is what's load-bearing, not the identity of the proposer.
- **The audit-side already pays its rent.** Even if the self-optimization side is never built, naming this principle helps explain *why* cliff prose / transcript / cross-body switch are load-bearing (not optional decoration): they are the replay-axis engagement that makes the substrate worth more than a write-once log.

## Related

- `principles/04-records-outlive-writers.md` — the foundation: trace outlives writer.
- `principles/14-substrate-engagement-reduces-coordination-context-cost.md` — the immediate parent: this principle is its second-order property.
- `principles/10-schema-as-contract.md` — required for the typed observation tuple this principle invites; schema migration discipline applies.
- `principles/11-ai-first-human-as-projection.md` — explorer agents reading replay corpora are themselves projections; the substrate remains AI-first.
- `docs/playbook.md` § G5 (narrative reconstruction) — the existing audit-replay verb (`gate transcript`).
- `docs/playbook.md` § S2 (Cross-Session Body Switch) / § S3 (Agora-to-Gate Lift) — extensive proof of cross-body replay already in dogfood.
- `docs/eris-playbook.md` Act IV + Coda — the craft showcase of ledger-shaped moves; the principle behind "every move ledger-shaped" is what this principle names.
- (external) "LLMs Improving LLMs: Agentic Discovery for Test-Time Scaling" (arXiv 2605.08083, GitHub `zhengkid/AutoTTS`) — the external proof that a declarative-source + deterministic-interpreter + persisted-trace substrate enables cheap algorithm discovery by explorer agents. CMC (Confidence Momentum Controller) was found by a Claude Code explorer in $39.90 / 160 minutes against an offline replay corpus.
