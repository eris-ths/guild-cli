---
applies_to: swarm
---

# Substrate engagement reduces coordination context cost

**Coordination state held only in the orchestrator's working memory
decays at session end. The same state stamped in substrate becomes
external memory the orchestrator re-reads on demand. Parallel
execution alone does not provide this — the substrate engagement IS
the cost reduction.**

## Statement

Principle 04 (records-outlive-writers) names judgment artifacts as
the load-bearing thing the YAML must carry: a reviewer's verdict
written today must make sense to a cold reader next week. This
principle names the same shape applied **one layer up** — to the
*coordination* state that lives between judgment and execution.

When two or more actors run on a single multi-executor `gate request`
in parallel, the coordination state includes:

- *who* is doing *which slice* (the `executors:` field on the request)
- *what session_id* each executor stamped (per-actor witness session
  records)
- *what the in-flight progress is* (witness notes, status_log entries)
- *whether the wave has overlap with another active wave* (#234
  cross-request overlap surface)
- *what the recovery path is if a slice fails*

If the orchestrator holds this state only in their working memory —
say, by tracking "agent-A is on the test extension, agent-B is on
the helper improvement" in their head — the state evaporates at
session end. The next instance (orchestrator + N hours later, or a
different agent entirely) has nothing to read. The same shape as
principle 04, applied to coordination instead of judgment.

When the state is stamped in substrate (executors stamped on the
request at file time, witness notes per actor with their own
`session_id`, lifecycle records on each transition), the substrate
becomes **external memory the orchestrator re-reads on demand**. The
orchestrator's context cost stays flat across many parallel
coordinated SubAgents — `gate transcript <id>` returns the wave's
shape in one command, regardless of how many slices the wave had.

## Why parallel execution alone does not provide this

The most common failure mode (named by the 2026-05-11 PR #291
swarm dogfood retrospective):

- Claude SubAgent `isolation: "worktree"` provides filesystem-axis
  parallelism — each SubAgent works in a disjoint git clone, no
  file-write race.
- Without `profile: swarm` (or any `gate request` at all), gate sees
  one terminal cwd, one author, no executor stamp, no witness notes.
  The coordination state lives only in the orchestrator's context.
- The implementation may ship successfully — code lands, tests pass
  — but the *audit trail* of the coordination is empty. A cold
  reader of `requests/` sees nothing about the wave.

The two axes — filesystem (worktree) and substrate (swarm) — are
**complementary, not redundant**. Using only one collapses the
coordination half of principle 04: records that should outlive
writers stay in the writer's context window and die with it.

## Agent reports are testimony; the substrate is record

A SubAgent that reports "I witnessed onto the wave, started slice A,
committed at SHA X" is providing *testimony* — a narrative claim by
the actor about what they did. The substrate is *record* — what the
filesystem can confirm.

These usually agree, but they sometimes diverge:

- The agent reports a witness update; `gate show` doesn't show it
  (the witness call failed silently, or the agent confused which
  wave they were on).
- The agent reports completion; the commit isn't actually in any
  pushed branch yet.
- The agent reports a clean wave; the witness session_ids don't
  match the actors named in the report.

**When they diverge, the substrate wins.** Read it before trusting
the report. This is the principle that protects against
hallucinated coordination state — which is real, has been observed
in dogfood, and would otherwise compound silently because there's
nothing telling the orchestrator their working memory is wrong.

## In practice

- `profile: swarm` enables the substrate-axis side: `self_approve:
  forbidden`, `worktree_required_for_parallel: true`, multi-executor
  `gate request` with `executors:[...]` stamped at file time.
- `gate witness <id> --by <executor> --note "..."` stamps a
  per-actor record with the actor's own `GUILD_SESSION_ID`. The note
  has a small character cap (80 chars) — it is a status-pin, not a
  free-form journal. Pair with commits and PR descriptions for the
  longer-form context.
- `gate transcript <id>` returns the wave's arc as prose. A cold
  reader gets the coordination shape from one command.
- `gate boot`'s overlap surface (#234) detects cross-request overlap
  between active waves; a future `gate wave-status <id>`
  (issue #295) will surface in-flight per-executor status within a
  single wave.

The substrate location matters:

- ✓ The repo's `substrate/swarm-experiments/<topic>/` for
  demonstrations that future-self might re-read.
- ✓ `<repo>/requests/` for real waves on this repo.
- ✗ **Never `/tmp/<name>/`** for any coordination meant to be
  referenced later. `/tmp` is below the principle 04 continuity
  bar — the trail that was supposed to make the orchestrator's
  context redundant has the lifespan of `/tmp`. The 2026-05-11
  PR #291 substrate at `/tmp/swarm-real/requests/completed/
  2026-05-11-0001.yaml` was already gone by next-morning.

## Implications

- **`features.self_approve: forbidden` is not just a safety rail —
  it is the moment substrate engagement becomes felt.** An agent who
  files-and-approves their own request is operating in pure
  testimony mode; the substrate has nothing the agent doesn't
  already know. Forcing a second actor through approve turns the
  substrate into record from the first transition onward.
- **`witness --note` is idempotent on note text.** Repeating the
  same witness with the same note returns "no change" rather than
  appending. This keeps the substrate terse but means progress
  history requires note-text changes per update. Substrate engagement
  payoff is not "more entries" but "traceable transitions."
- **Schema changes to the coordination layer require migration.**
  Same as principle 04 for judgment. The `executors:` field's shape
  (currently flat `[name, name]`, possibly future
  `[{name, status}, ...]` per #294) is a contract; changing it
  silently breaks cold readers of historical waves. Hydrate
  tolerance is the load-bearing path.
- **Single-executor waves still gain from substrate engagement.**
  Even when only one actor implements, the request + execute +
  complete arc carries the *intent* shape. A fast-track shortcut is
  appropriate when the discipline is overhead; a full lifecycle is
  appropriate when the coordination state is what's load-bearing.

## Related

- `principles/04-records-outlive-writers.md` — the parent principle.
  This principle is its extension to coordination state.
- `principles/12-substrate-pure-module-in-projection-ecosystem.md`
  — the "Combo / Flow / Loop / Cycle" vocabulary inside which this
  coordination layer sits.
- `docs/playbook.md` § "Swarm × Claude SubAgent harness" — the
  worked sequence + failure-mode-named recipe.
- `substrate/swarm-experiments/2026-05-11-eris-swarm-test/` — the
  dogfood arc that validated this principle in eris's own hands
  before it was named. Two slices (SessionEvent drift extension,
  cwd-fallback `next:` hint) shipped via PR #296 after the
  substrate-engagement experience was confirmed felt-not-just-read.
