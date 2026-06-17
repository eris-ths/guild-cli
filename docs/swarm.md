# guild swarm — multi-agent coordination patterns

The swarm-specific content extracted from
[`docs/playbook.md`](./playbook.md). If you are a **solo** user
running a single executor at a time, you almost certainly do not
need this file — the 5-verb solo arc (`register` / `request` /
`review` / `execute` / `complete`) covers what you need; see
[`README.md`](../README.md) § "Solo flow (30 seconds)" and the
gate-only patterns in [`playbook.md`](./playbook.md#gate-only-patterns).

Reach for this file when:
- you orchestrate ≥2 parallel executors on one wave
  (`gate request --executors a,b`) or N parallel waves
- you use Claude Code's SubAgent harness with
  `isolation: "worktree"` and want the substrate trail to survive
- you ship N independent items that touch the same config sites
  and need an order
- you need to bundle N parallel PRs into one mergeable commit
- you keep tripping on the worktree-ledger blindspot
  (`gate witness` from inside `.claude/worktrees/agent-*`)

> **Audience.** Same shape as `playbook.md`: parseable substrate
> for AI agents (per
> [`lore/principles/11-ai-first-human-as-projection.md`](../lore/principles/11-ai-first-human-as-projection.md)).
> Each section is a recipe — *when* to reach for *what*, with
> concrete verb sequences.

---

## Ordering N independent items (agora + gate)

**Shape**: you have N independent issues / verbs / tasks to ship.
Each is doable solo. The question is *order*, not *whether*. The
deliberation deserves a record so the order isn't forgotten 30 min
later and so a cold reader can audit "why this order?".

```bash
# 1) Stand up the deliberation as an agora quest
agora new --slug ordering-<topic>-<date> --kind quest \
  --title "ordering for N issues" \
  --description "#A / #B / #C / #D ... — pick an order"
agora play --slug ordering-<topic>-<date> --by <you>
# → 2026-MM-DD-NNN

# 2) Deliberate with multi-voice (one move per voice / lense)
agora move <play-id> --by <you>   --text "candidates + dependencies"
agora move <play-id> --by <miki>  --text "size + conflict-surface analysis"
agora move <play-id> --by <noir>  --text "dependency graph: independent vs chained"
agora move <play-id> --by <devil> --text "what fails if order is wrong"
agora move <play-id> --by <you>   --text "decision: A → B → C → D, defer E"

# 3) Conclude with the order in the note (one-line audit trail)
agora conclude <play-id> --by <you> \
  --note "order locked: A → B → C → D; E deferred"

# 4) Stamp gate waves in the chosen order (one per item, or N parallel)
gate request --action "ship #A" --from <you> --executors <a> ...
gate request --action "ship #B" --from <you> --executors <b> ...
# ... approve / execute / complete as the ship plan dictates
```

**When to reach**: 3+ independent items, non-obvious order, or
multiple voices have something to contribute. **When to skip**: 1-2
items or order is forced by dependency; a 3-line code comment in
the first commit suffices.

---

## Bundle-PR recipe — N independent verbs touching the same config sites

**Shape**: a swarm shipped N independent verbs in parallel
(`gate request --executors a,b,c` or N separate one-actor waves
via the "Ordering N independent items" recipe above). Each
ended in its own PR. **All N PRs are MERGEABLE against current
main individually**, but they all touch the same coordination
sites (`index.ts` dispatcher, `verbs.ts` READ_VERBS, `schema.ts`
verb registry, `verbs-consistency.test.ts` GATE_ALL). The first
to merge conflicts the rest.

```bash
# 1) Identify the "anchor" PR — usually the largest or most-
#    independent change. Merge it first (touches the fewest of
#    the conflict sites, or none).
gh pr merge <anchor-pr> --squash

# 2) From updated main, create a single bundle branch.
git fetch origin main
git checkout main && git merge --ff-only origin/main
git checkout -b feat/bundle-<topic>

# 3) Cherry-pick each remaining PR's commit in turn. Conflicts will
#    happen at the shared sites and are mechanical (each PR appends
#    to the same lists). Resolve by keeping ALL entries.
git fetch origin feat/<pr-A> feat/<pr-B> feat/<pr-C>
git cherry-pick <pr-A-sha>
# resolve conflicts (preserve every PR's entries in the appended
# lists; CHANGELOG: keep one Added bullet per closed issue, tight)
git add -A && git cherry-pick --continue --no-edit
git cherry-pick <pr-B-sha>
# ... repeat

# 4) Build + test once on the bundle (catches "two PRs both added
#    'foo-bar' to GATE_ALL" duplicate-key races that individual
#    PRs couldn't see).
npm run build && npm test

# 5) Push + open ONE bundle PR. The body lists each commit ↔ issue
#    pair and the SubAgent / owner for each so credit survives.
git push -u origin feat/bundle-<topic>
gh pr create --title "feat: bundle N verbs (#A #B #C #D)" --body "..."

# 6) Note on the superseded PRs and close them. GitHub will NOT
#    auto-close because the bundle's cherry-pick SHAs differ from
#    the original branches' SHAs.
for pr in <A> <B> <C> <D>; do
  gh pr comment $pr --body "Superseded by #<bundle>. Closing manually."
  gh pr close $pr
done
```

**Why bundle**: avoids N-1 rebase rounds with mechanical conflicts.
Reviewer sees one PR with N preserved commits; CI runs once. The
4 issue → close-via-bundle pattern requires manual close after
merge (GitHub's "closes #X" auto-detection works on the bundle PR;
the *individual* PRs need a manual `gh pr close`).

**When to skip**: only 2 PRs, or PRs touch disjoint files (rare
when shipping N verbs of the same passage). Always bundle when
N ≥ 3 and ≥ 2 of them touch the same dispatcher / config-list site.

---

## Swarm × Claude SubAgent harness

When you orchestrate parallel implementation through Claude Code's
SubAgent system, **the SubAgent's `isolation: "worktree"` flag and
gate's `profile: swarm` are complementary, not redundant**. Skipping
the substrate side because the filesystem side is already isolated
produces a parallel implementation with **no audit trail** — gate
sees one terminal cwd, one author, no executor stamp, no witness
notes. The coordination state lives only in the orchestrator's
context window and dies at session end.

This is the load-bearing case of
[principle 14](../lore/principles/14-substrate-engagement-reduces-coordination-context-cost.md)
(substrate engagement reduces coordination context cost) — itself an
extension of principle 04 (records-outlive-writers) from judgment
artifacts to coordination state. Two axes of the same coordination:

| Axis | Mechanism | What it gives |
|---|---|---|
| **Filesystem** | Claude SubAgent `isolation: "worktree"` | each SubAgent works in a disjoint git clone; no file-write race |
| **Substrate** | `profile: swarm` on `guild.config.yaml` | `executors:[a,b]` stamped on the request, `requires_worktree_isolation: true` declared, `self_approve: forbidden`, witness notes per slice with `session_id` stamps, terminal lifecycle records each actor's arc |

Use both. The filesystem axis prevents file-write races; the
substrate axis records who-did-what for cold readers and lowers the
orchestrator's per-iteration context cost (the substrate becomes
the orchestrator's external memory — principle 04 + principle 12
combo / Flow vocabulary).

### Worked sequence (2-slice parallel-impl wave)

Below is the shape used in PR #291 (issues.ts hardening + hook bus
extension, 2026-05-11). Names are illustrative.

```bash
# 0) Substrate location — pick by audience
#    ✓ substrate/swarm-experiments/<topic>/   for demonstrations
#    ✓ <repo>/requests/                        for real waves on this repo
#    ✗ /tmp/<name>/                            NEVER — disappears between sessions
#                                               (principle 04 violation: the trail
#                                                that was supposed to make the
#                                                orchestrator's context redundant
#                                                has the lifespan of /tmp)
cd <real-substrate-dir>

# 1) profile: swarm + self_approve: forbidden + worktree required
cat > guild.config.yaml <<'YAML'
profile: swarm
host_names: [eris]
features:
  self_approve: forbidden
  worktree_required_for_parallel: true
YAML

# 2) register the orchestrator + each SubAgent identity as members
gate register --name eris --category host
gate register --name agent-issues
gate register --name agent-hookbus
gate register --name critic   # someone to approve, since self-approve is forbidden

# 3) one multi-executor request — the wave-shaped envelope
gate request \
  --from eris \
  --executors agent-issues,agent-hookbus \
  --action "ship #289 + #290 in parallel" \
  --reason "two independent slices; no file overlap" \
  --target "src/interface/gate/handlers/issues.ts, src/application/plugin/HookPlugin.ts"
# → 2026-05-11-0001

# 4) critic approves (self_approve: forbidden refuses eris approving their own)
gate approve 2026-05-11-0001 --by critic

# 5) each SubAgent witnesses the wave with its own session_id BEFORE writing code
#    (this is the part the worktree-only attempt skipped)
GUILD_SESSION_ID=agent-issues-2026-05-11   gate witness 2026-05-11-0001 --by agent-issues   --note "claim issues.ts slice"
GUILD_SESSION_ID=agent-hookbus-2026-05-11  gate witness 2026-05-11-0001 --by agent-hookbus  --note "claim hook bus slice"

# 6) Claude SubAgents run in their worktrees, implement, commit. Update witness
#    note as the slice progresses so cold readers can trace per-executor state.
GUILD_SESSION_ID=agent-issues-2026-05-11  gate witness 2026-05-11-0001 --by agent-issues   --note "executing slice — 2 commits cherry-pickable"

# 7) execute, then per-slice complete (#294: complete is per-executor).
#    Each executor closes its own slice; the wave transitions to
#    completed only once every assigned executor's slice is terminal.
gate execute  2026-05-11-0001 --by agent-issues
# … cherry-pick both SubAgents' commits into a single branch, push, open PR …
gate complete 2026-05-11-0001 --by agent-issues  --note "issues slice done; PR #291 opened"
gate complete 2026-05-11-0001 --by agent-hookbus --note "hook-bus slice done"
# → "open slices remaining" until the last --by closes; then the wave
#   auto-transitions to completed (no separate wave-level complete call).
```

### What the substrate now carries (cold-reader audit)

```bash
gate transcript 2026-05-11-0001
# → "3 actors / 21min — eris filed, critic approved, agent-issues +
#    agent-hookbus witnessed with distinct session_ids, completed by
#    agent-issues with PR link in the note"
```

The cold reader gets the wave's coordination shape from one command.
That's the substrate engagement payoff: the orchestrator's working
memory of "who's doing what" was moved into a YAML file the audit
replay reads cleanly.

### Known limitations (as of 2026-05-11; #294 resolved 2026-06-17)

These are real, known, and tracked as separate issues for shipable
fixes. Items marked **RESOLVED** have since shipped and are kept
here (struck through) so the trail behind the rule survives:

- **~~One lifecycle for N executors~~ — RESOLVED (#294).** Per-slice
  closure is now first-class: `gate complete --by X` and `gate fail
  --by X` are per-executor operations on a multi-executor wave. Each
  executor's slice carries its own `status` / `completed_at`; the
  wave-level state transitions to `completed` only once every
  assigned executor's slice is terminal (any-fail-wave-fail is the
  phase-1 default — #235 phase 2 replaces it with template-bound
  policy). A `complete` while siblings are still open reports `open
  slices remaining` and leaves the wave executing. (JSON note: the
  `executors` field gains an object shape `[{name,status,...}]` on
  any wave that has seen a slice closure — `jq '.executors[] |
  (.name // .)'` reads both legacy and post-#294 records.)
- **In-flight slice status visible at two scales** — `gate
  wave-status <id>` returns per-executor progress inside one wave
  (witness notes, claim/witness occupancy, freshness band).
  `gate swarm-status [--orchestrating <m>] [--for <m>]` (#346)
  returns the same shape composed *across* every active wave in
  scope, so a director conducting multiple waves never has to chain
  `board` + per-wave `wave-status` reads. Alerts surface
  `stale_executor` / `overlapping_target` / `attribution_risk` as a
  flat array — one read closes the principle-14 loop.
- **Judgment trail is half** — the substrate captures who-did-what
  (operational) but not why-this-option-not-that (judgment). The
  per-slice agora play is the right home for the judgment layer;
  bind it via `--from-agora <play_id>` on the request to keep both
  axes linked. A swarm PR that doesn't bind an agora play is
  half-substrate.
- **session_id boilerplate** — each SubAgent prompt currently must
  `export GUILD_SESSION_ID=<role>-<wave_date>` explicitly. Auto-
  allocation is on the design backlog but has identification trade-
  offs (random hash defeats the human-readable-session-id purpose
  — a deterministic template like `agent-{role}-{wave_id}` is the
  candidate shape).
- **Worktree → parent-ledger blindspot** — see the dedicated section
  below; this is the single most-recurring friction so it gets its
  own heading for findability.

### Worktree-ledger blindspot

When SubAgent isolation uses a Claude Code worktree
(`.claude/worktrees/agent-*`), the SubAgent's cwd is outside the
parent session's substrate tree. By default `gate` walks up from cwd
to find `guild.config.yaml`; if the parent substrate lives at a
different filesystem path, the walk-up may find the wrong config (or
none) and the SubAgent's writes never reach the ledger.

**The bridge (#308 Layer A): `GUILD_CONFIG` env override.** When set
to an absolute path, `gate` skips the cwd walk-up and uses that
config directly. The orchestrator exports it before spawning the
SubAgent; every `gate` invocation in the SubAgent's shell writes to
the parent substrate without per-call boilerplate.

```bash
# Orchestrator side, before launching the SubAgent
export GUILD_CONFIG=/abs/path/to/parent/guild.config.yaml
export GUILD_WAVE_ID=2026-05-15-0001     # the wave the SubAgent owns
export GUILD_ACTOR=noir                  # the SubAgent's name
# launch SubAgent (it inherits these env vars)
```

```
# SubAgent brief snippet
The parent wave substrate is reachable via:
  - GUILD_CONFIG = $GUILD_CONFIG
  - GUILD_WAVE_ID = $GUILD_WAVE_ID
  - GUILD_ACTOR = $GUILD_ACTOR
Call `gate witness $GUILD_WAVE_ID --by $GUILD_ACTOR --note "..."` at
slice boundaries (start, midpoint, end) so the orchestrator sees
your progress without polling.
```

**Automated activity surfacing.** For SubAgents under Claude Code,
`examples/plugins/harness-wirings/claude-code/` carries a `PostToolUse`
hook that calls `gate witness` automatically on every tool call
(throttled to one call per 30s, dedup-safe per #246). Install
opt-in via `.claude/settings.json`; the script no-ops when
`GUILD_WAVE_ID` is unset so global installation is safe.

For harnesses other than Claude Code, an explicit `gate witness`
call inside the SubAgent's prompt at slice boundaries is the
portable equivalent. Cross-harness automation is the second-harness
threshold per [principle 15](../lore/principles/15-plugins-as-default-extension.md):
when two harnesses ship convergent wirings, the bus moves into
core.

### Failure mode: worktree-only ("ceremony swarm")

The original PR #291 attempt fell into this. 3 Claude SubAgents in
isolated worktrees, no `gate request`, no `executors:` stamping, no
witness notes. The implementation worked, but **gate's coordination
substrate stayed empty**: a cold reader of `requests/` would see
nothing about the wave. The orchestrator's context held the entire
state, and that state evaporated at session end.

Recovery shape: close the issues, throw away the worktrees, run the
sequence above against a fresh substrate (`substrate/swarm-experiments/`,
NOT `/tmp/`). Cost is real but bounded; the lesson — "parallel
execution alone is not swarm; substrate engagement = context-cost
reduction" — is one PR cycle to install permanently.

---

## See also

- [`./playbook.md`](./playbook.md) — gate / agora / devil / ctx
  combos for solo and pair-shaped work
- [`../AGENT.md`](../AGENT.md) — verb-by-verb reference, tiered
  by Common / Coordination / Boundary / Diagnostic
- [`../lore/principles/14-substrate-engagement-reduces-coordination-context-cost.md`](../lore/principles/14-substrate-engagement-reduces-coordination-context-cost.md)
  — the principle that motivates substrate engagement under
  parallel execution
- [`../examples/swarm-engagement-loop/`](../examples/swarm-engagement-loop/)
  — worked example of the engagement loop
