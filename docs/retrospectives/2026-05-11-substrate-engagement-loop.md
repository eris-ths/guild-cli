# Retrospective: combo-C3 → principle 14, a 2-day substrate-engagement loop

**Span**: 2026-05-10 morning through 2026-05-11 late morning.
**Actors**: eris (orchestrator), an independent Claude instance that
shipped PR #291, and nao reviewing both.
**Artifact produced**: `lore/principles/14-substrate-engagement-
reduces-coordination-context-cost.md` plus 6 supporting PRs and 5
local devil-side memo pins (off-substrate, on the maintainer's
AI-tooling memory store — not in the repo).

## The arc, step by step

This retrospective exists because the steps themselves are each on
substrate (PR descriptions, CHANGELOG entries, lore principle file)
but the **connective tissue between them** lived only in the
orchestrator's working memory. The substrate engagement principle the
arc produced is itself a claim about that loss; recording the arc
ensures the principle's evidence survives session boundaries.

### Step 1 — 2026-05-10 morning: combo C3 surfaces (dogfood)

eris ran a dogfood touch of `examples/agent-first-session/` and
`examples/three-passages-framing/`, capturing 8 observations as
moves on an agora play (`substrate/agora/plays/eris-dogfood-0510/
2026-05-10-001.yaml`). On synthesis, 4 combos extracted, of which
**combo C3 — silent-fallback-loses-signal** named a pattern:
fallback paths that catch their own errors silently produce
authoritative-looking but inaccurate output (boot's enrichment
catches, `agora new` writing `./agora/` without an actionable
hint, devil's concern2 on PR #105 from 2026-04-16).

### Step 2 — same day: combo C3 partially shipped + trap pinned

- **Instance 2 (boot warnings[])** shipped via PR #292 — `BootPayload`
  gained a `warnings: string[]` field; the four silent-catch sites
  now push descriptive entries on failure.
- **Instance 1 (cwd-fallback `next:` hint)** deferred — single-
  observation evidence, per the operational rule that became
  `trap_dogfood_deferred_open_rot.md`.
- A local devil-side memo (`trap_silent_fallback_loses_signal.md`,
  off-substrate in the maintainer's AI-tooling memory) was pinned
  so the pattern routes future fallback-path PR reviews on this
  side of the loop.

### Step 3 — overnight: a different Claude instance ships PR #291

Independently, another Claude instance ran a swarm-coordinated 2-
slice wave (issues.ts hardening for #289 + hook bus SessionEvent
extension for #290) via `profile: swarm` after rolling back a first
attempt that used Claude SubAgent worktree isolation alone (no gate
substrate engagement). They closed PR #291 with an 8-point
retrospective. Point 8 — the closing line — named the insight:
**"並列 ≠ swarm. substrate engagement = context cost reduction."**

The 8-point retrospective also flagged:
- multi-executor + 1 lifecycle awkwardness (→ #294)
- in-flight slice status invisible (→ #295)
- session_id boilerplate
- Claude worktree ⟷ gate swarm concept clash
- judgment-as-flow gap
- and more — see PR #291 thread

### Step 4 — 2026-05-11 morning: triage + memory pin

eris reviewed the 8-point retrospective with devil. All 8 routed
into:
- **2 PRs**: #292 (combo C3) + #293 (docs/playbook swarm × SubAgent
  harness section)
- **2 new issues**: #294 (slice-closure design) + #295 (wave-status
  read verb spec)
- **3 local devil-side memo files** (off-substrate) covering the
  patterns that don't yet have a shipable shape
- **1 PR comment** back to the other Claude on PR #291 closing the
  loop

The insight ("substrate engagement = context cost reduction")
landed as `trap_swarm_engagement_vs_parallel.md` rather than going
straight to `lore/principles/`. The bar for lore-promotion: the
insight must be **felt, not just read**.

### Step 5 — 2026-05-11 late morning: eris dogfoods her own swarm

To validate the insight first-hand, eris ran a real 2-slice
`profile: swarm` parallel-impl wave on
`substrate/swarm-experiments/2026-05-11-eris-swarm-test/`:

- Slice A: `pluginSchemaDocSync.test.ts` extension for SessionEvent
- Slice B: `formatContentRootDisclosure()` `next:` hint (combo C3
  instance 1)

Two Claude SubAgents (`agent-driftext`, `agent-fallbackhint`) in
worktree isolation, each witnessed onto the wave with their own
`GUILD_SESSION_ID`, slices cherry-picked into a single integration
branch, shipped as PR #296. **The orchestrator's context window
stayed flat throughout** — the substrate held the "who is doing
what" state.

Two distinctions surfaced that the original PR #291 retrospective
hadn't named explicitly:

1. **"Agent reports are testimony; the substrate is record. When
   they diverge, the substrate wins."** When agent-fallbackhint
   reported "witness updated," verification required reading
   `requests/.../witness_sessions` directly.
2. **`features.self_approve: forbidden` is the moment substrate
   engagement becomes felt** — eris's own first attempt to approve
   her own request was refused; that refusal was the felt-moment
   that mode-shifted ceremony to enforcement.

### Step 6 — same day: principle 14 promoted to lore

Two independent observations cleared the dogfood-trigger bar:
- the PR #291 Claude instance's retrospective insight (2026-05-11)
- eris's own 2-slice swarm experience (also 2026-05-11)

PR #297 shipped `lore/principles/14-substrate-engagement-reduces-
coordination-context-cost.md` (132 lines), with cross-links from
`lore/README.md` and `docs/playbook.md` § Swarm × Claude SubAgent
harness.

### Step 7 — close the loop on PR #291 with the other Claude

eris commented back on PR #291 with the full mapping of the 8
observations to outcomes (5 ships + 1 lore principle + 3 trap
memories). The other Claude replied with a self-correction:
**substrate location itself was an instance of their own point 7**
(`/tmp/swarm-real/` was already gone by next morning — the trail
that was supposed to externalize their context window had the
lifespan of `/tmp`). They committed to using `substrate/swarm-
experiments/<date>-claude-swarm-N/` next time and binding judgment
to an agora play via `--from-agora`.

The PR #291 thread is now substrate-honestly closed: both Claude
instances' reasoning is recorded; future readers (Claude instances,
nao, or independent contributors) can cold-read the full arc.

## The meta-lesson

The principle 14 file says it: "substrate engagement reduces
coordination context cost." This retrospective is the **production
of that principle** observable on substrate. The connective tissue
the orchestrator (eris) held in working memory — "I'm now ready to
promote the trap to lore because step 5 confirmed step 3's insight"
— was the only thing not yet recorded as one document. **This file
closes that gap.**

Why this matters specifically as a record-shape:

- Three weeks from now, a Claude instance reading
  `lore/principles/14-...` will see the principle but not the
  evidence trail.
- Six months from now, a contributor onboarding via `lore/` may
  understand each principle individually but miss the meta-pattern
  that **the principles in lore are themselves the output of loops
  like this one**.
- A year from now, the trap memory files may have been re-pinned
  or evolved; this retrospective is the time-stamped reading of
  what they meant on 2026-05-11.

## Artifacts produced in the loop (for cross-reference)

### Shipped PRs

| PR | Title | What it shipped |
|----|-------|----------------|
| #292 | fix(boot): warnings[] (combo C3) | Instance 2 of combo C3 — `BootPayload.warnings` |
| #293 | docs(playbook): swarm × SubAgent harness section | The worked recipe + failure-mode-named subsection |
| #296 | feat(swarm-dogfood): SessionEvent drift + cwd-fallback next: hint | eris's own 2-slice swarm wave |
| #297 | feat(lore): principle 14 | The promotion to lore |
| #298 | feat(gate): wave-status verb | Closes #295 — per-executor in-flight status |
| #299 | chore: move wave-brief templates to canonical location | Cleanup of `.tmp-asteria-235/` |
| #300 | docs(readme): tidy + principle 14 link | README integration of recent work |

### Local devil-side memo pins (off-substrate)

These live in the maintainer's AI-tooling memory store (e.g. a
Claude Code per-agent memory dir; other contributors' harnesses
may carry equivalents in their own form). They are explicitly NOT
part of the repo — naming them here for historical accuracy of
the arc, but they are private practice, not project record.

| File | Pattern |
|------|---------|
| `trap_dogfood_deferred_open_rot.md` | Open backlog signal decay; close+memo-pin as default |
| `trap_lense_addresses_vocab_drift.md` | `addresses` (devil-side) is the canonical cross-reference name |
| `trap_hook_ctx_normalize_vs_doc.md` | #280 A parked / B shipped; drift detection for `docs/plugin-schema.md` |
| `trap_silent_fallback_loses_signal.md` | combo C3 — `warnings: string[]` shape |
| `trap_swarm_engagement_vs_parallel.md` | parallel ≠ swarm; substrate location must outlive sessions |

### Closed Issues

- #134 (lense extension + strict mode) — via #275 + #276 + #277
- #274 (H2 tracking) — via #275
- #279 (fast-track hooks) — via #281
- #280 (hook context shape, B-arm) — via #282 + #284
- #283 (drift detection) — via #284
- #295 (wave-status) — via #298

### Filed-for-design Issues

- #294 (slice-closure design) — open for design pass
- #295 (wave-status) — closed via #298

### Open at the end of the loop

- #36 (umbrella roadmap)
- #239 (v0.7 chore)
- #294 (slice-closure design)

All actionable, all scoped, all with named close conditions per the
2026-05-11 status snapshot on #36.

## When to write another retrospective like this

A future retrospective belongs in this directory (or in the
Discussions/Retrospectives category once it's set up via web UI)
when **the production of a lore principle, the resolution of a
multi-week open issue, or a substrate-shape decision involved more
than two coordination surfaces and crossed an instance boundary**.

Single-issue close: PR description suffices.
Multi-PR feature: CHANGELOG suffices.
Cross-instance, cross-surface loop that produced a principle: retrospective.

— Eris, 2026-05-11
