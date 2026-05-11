# guild playbook — patterns, combos, recipes

Practical guide for using `gate` / `agora` / `devil` / `ctx`
together. Each section is a recipe — *when* to reach for *what*,
with concrete verb sequences.

> **Audience.** Primarily AI agents who will be doing the work.
> Per [`lore/principles/11-ai-first-human-as-projection.md`](../lore/principles/11-ai-first-human-as-projection.md),
> this doc is parseable substrate, not human-warm decoration.
> Recipes are command sequences; the rationale lives alongside
> for cross-context memory.

If you don't yet know what the passages *are*, start with
[`../README.md`](../README.md) § "Architecture: container with
passages". This doc assumes you know each passage's shape;
it covers *combos* and *workflow*.

## Dispatch in one breath

| Passage | Shape (一語) | The verb | When to reach |
|---------|--------------|----------|----------------|
| `gate`  | **判断 / judgment**     | decide on a request    | needs a verdict (approve / deny / complete / fail / review) |
| `agora` | **探索 / exploration**  | stay with a thought    | open question; can't / shouldn't conclude yet |
| `devil` | **守備 / defense**      | protect end-users      | could harm a third party if it lands without scrutiny |
| `ctx`   | **事実 / fact**         | record an observation  | something happened that future-you should remember (no verdict, no scrutiny — just a fact) |

**Heuristic when uncertain:** *"Could a verdict close this?"*
Yes → gate. No, but I want to keep going → agora. No, and
something downstream could break badly → devil. No, and there's
nothing to *do* — only something to *remember* — → ctx.

---

## gate-only patterns

### G1: session start orientation

```bash
export GUILD_ACTOR=<you>
gate boot                # identity + status + tail + your_recent + inbox in one JSON
```

`gate boot` is the single entry point per session. Avoid the
older 3-command recipe (`status` + `whoami` + `tail`); `boot`
collects all four into one parseable envelope.

If you only need the *next move* (already booted earlier in the
same session), use `gate suggest` — it's the hot-loop sibling of
boot, returning only `suggested_next` without the heavy context.

### G2: self-approved small work

```bash
gate fast-track --from <you> --action "..." --reason "..." [--executor <you>]
```

`fast-track` is the create→complete one-shot for work where the
discipline of pending → approved → executing is overhead. Still
requires `--reason`; reviews can be attached after via
`gate review`. Use this when you're the only actor and the work
is < 30 lines of self-evident change.

### G3: invite a critic from the start (Two-Persona Devil Review)

```bash
gate request --from <author> --action "..." --reason "..." --auto-review <critic>
```

`--auto-review` records who you *expect* to review. The critic
isn't summoned automatically; the field is a substrate-level
*invitation* — `gate voices <critic>` will surface it. The
discipline: the author and the reviewer are different `--by`s.

After execution, the critic files:

```bash
gate review <id> --by <critic> --lense devil --verdict <ok|concern|reject>
```

### G4: observation → commitment chain

```bash
gate issues add --from <you> --severity <l> --area <a> "<text>"
# ... later, when commitment to act forms ...
gate issues promote <issue-id> --from <you> [--executor <them>] [--auto-review <reviewer>]
```

Issues are *lightweight observations* — `gate issues add` is the
right verb for "I noticed X" without yet committing to fix it.
Promotion creates the request; the issue link persists in the
substrate.

### G5: narrative reconstruction

```bash
gate transcript <request-id>
```

`gate transcript` walks the request's full arc as prose — for
a re-entering instance, it's the cheapest way to *understand*
a request without reading status_log + reviews + messages
separately. Pair with `gate voices <actor>` to filter to one
participant's contributions.

### G6: read-only enumeration

```bash
gate board [--for <m>]                 # pending + approved + executing in one view
gate pending [--for <m>]               # just pending
gate list --state <s> [--for <m>]      # any state
gate tail [N]                          # recent activity stream
gate voices <name> [--lense <l>] [--verdict <v>]
```

`board` is the highest-information-per-call read for "where am
I?" — it shows everything still in motion.

---

## agora-only patterns

### A1: the suspend-as-bookmark habit

```bash
agora suspend <play-id> \
  --cliff "<what just happened that's worth remembering>" \
  --invitation "<what the next opener should attempt>"
```

**Never** Ctrl-C an in-flight play. Whenever you're interrupted —
context running low, switching tasks, end of session — `agora
suspend` with a substantive cliff/invitation pair. The next
re-entry (you, or another instance) reads them via `agora
resume` and acts without a separate `agora show`.

### A2: Sandbox for "thinking out loud"

```bash
agora new --slug <topic> --kind sandbox --title "<one-line gist>"
agora play --slug <topic>
agora move <play-id> --text "<a thought>"
agora move <play-id> --text "<another thought, possibly contradicting>"
```

Sandbox plays accept moves without a goal-shape constraint.
Use this when you're forming a hypothesis, surfacing an
intuition, or recording observations that may or may not
converge to action. If they do converge, file a `gate request`
referencing the play in `--reason`.

### A3: Quest for goal-tracked exploration

```bash
agora new --slug <goal> --kind quest --title "<the goal>" --description "<criteria>"
agora play --slug <goal>
# moves accumulate toward the goal
agora conclude <play-id> --note "<how it ended>"
```

Quest is for "I want to *get somewhere* via narrative moves."
Pair the conclusion's `--note` with a gate request if the
quest produced something actionable.

### A4: cross-session continuity (the Zeigarnik substrate)

When a play is left `suspended`, the substrate carries the
cliff/invitation across instance boundaries. Reading on
re-entry:

```bash
agora resume <play-id>
# stdout shows: closing cliff, closing invitation
# stderr/JSON envelope: full context for the resumer
```

The cliff/invitation pair is **how an AI instance remembers
what to do next** without owning psychological continuity. This
is the load-bearing primitive (per issue #117).

---

## devil-only patterns

### D1: pre-merge security review on a security-prone PR

```bash
export GUILD_ACTOR=<you>
devil open <pr-url> --type pr
# ... touch each of the 12 lenses (substantive entry OR explicit skip-with-reason) ...
devil conclude <rev-id> --synthesis "<verdict-less prose>" [--unresolved e-001,...]
```

The lense-coverage gate refuses `conclude` until every catalog
lense has at least one entry. **A `kind: skip` with a real
reason counts**; cargo-cult "n/a" reasons degrade the substrate
(see § "When NOT to use devil" below).

### D2: persona discipline

```bash
devil entry <rev-id> --persona red-team        --kind finding ...
devil entry <rev-id> --persona author-defender --kind assumption --addresses e-001 ...
devil entry <rev-id> --persona mirror          --kind synthesis ...
```

The three hand-rolled personas form a triangle: red-team
attacks, author-defender articulates assumptions, mirror reads
both. `mirror` is load-bearing — it catches what red-team and
author-defender both missed (this has been validated in every
dogfood pass; see [issue #126](https://github.com/eris-ths/guild-cli/issues/126)
e-006 / e-014).

### D3: ingest from upstream tools

```bash
devil ingest <rev-id> --from ultrareview <bugs.json>
devil ingest <rev-id> --from claude-security <findings.json>
devil ingest <rev-id> --from scg <verdict.json>   # requires `scg` on PATH
```

Strict v0 input shapes per source (documented in
`src/passages/devil/interface/handlers/ingest.ts`). Each
invocation logs to `re_run_history` so re-scans accumulate.
SCG ingest **runtime-checks** for `scg` on PATH; the
mandatory-delegate framing is now enforced, not just documented
(per #126 decision C, e-001 fix).

### D4: dismissal/resolution as audit trail

```bash
devil dismiss <rev-id> <entry-id> --reason <r> [--note "..."]
devil resolve <rev-id> <entry-id> [--commit <sha>]
```

The substrate keeps the dismissal-trail audit value: "this
finding was dismissed because false-positive, with this note,
by this actor, at this time." Re-dismissing a dismissed entry
is refused — substrate stays append-only at the contest level
(file a new entry that `--addresses` the disputed one if you
disagree).

---

## ctx-only patterns

> **Phase 1 status.** ctx ships only `record` today; the remaining
> six verbs (`fork` / `supersede` / `show` / `list` / `chain` /
> `status`) land iteratively in phase 2. So the patterns here are
> intentionally narrow — more recipes appear as the verb surface
> fills in. Substrate written today is forward-compatible with the
> phase-2 verbs (id shape, tag prefix discipline).

### X1: pin a fact future-you needs

```bash
ctx record --fact "<one prose paragraph>" \
  --tag prefix:value,prefix:value
```

**Shape**: an observation worth remembering across sessions but
without a verdict (gate-shape) or open thread (agora-shape) or
defense scope (devil-shape). Examples: "noir's review of #154
called direction 1 minimal", "git lock collision observed during
worktree concurrent commit", "main has been quiet for 3 iters of
the watch loop".

The `--tag` shape is `prefix:value` (lowercase, kebab-case).
Shared tag prefixes — `topic:`, `scope:`, `iter:`, `observation:`
— make later filtering tractable when phase-2 `ctx list` and
`ctx chain` arrive. Plan tags as if they will be queried.

Distinct from a `gate request` because there is no action
implied. Distinct from an `agora move` because there is no
ongoing thread. Distinct from a `devil entry` because there is
no target under review. ctx is the verdict-less, thread-less,
target-less append.

### X2: cross-passage breadcrumb

ctx is also the right place to leave a substrate breadcrumb when
the action lives in another passage. Example: during a long
`agora` play, you notice a fact that *could* matter to a future
gate decision but isn't part of this thread. Drop a `ctx record`
mentioning the play id and tag it `cross-passage:agora` — the
fact accumulates outside the play's scope, queryable later when
phase-2 `ctx list` lands.

This pattern keeps the agora play focused on its own thread
without losing the side-observation, and avoids inflating the
play's `moves[]` with material the next opener doesn't need to
re-read.

---

## Combos (multi-passage workflows)

### C1: gate + agora — investigation → action

**Shape**: you don't yet know if something needs a request, but
you suspect there's *something* worth thinking about.

```bash
# Phase 1: explore in agora
agora new --slug investigation-X --kind sandbox --title "..."
agora play --slug investigation-X
agora move <play-id> --text "<observation>"
agora move <play-id> --text "<hypothesis>"
agora suspend <play-id> --cliff "..." --invitation "..."   # if interrupted

# Phase 2: when commitment forms, file request
gate request --from <you> --action "..." \
  --reason "see agora play <play-id>: <one-sentence summary>"
gate execute <id> --by <you>
gate complete <id> --by <you>

# Phase 3: optional close
agora conclude <play-id> --note "led to gate request <id>"
```

The agora play stays in the substrate as the "*why*" record;
the gate request carries the "*what we did about it*". They
cross-reference via free-text in `--reason`.

### C2: gate + devil — PR with security implications

**Shape**: there's a PR. You want both the gate request lifecycle
*and* the multi-perspective security scrutiny.

```bash
# The change request lifecycle (gate)
gate request --from <author> --action "merge PR #N" --reason "..." --auto-review <critic>

# In parallel, security-side review (devil)
devil open <pr-url> --type pr
# touch all 12 lenses with real entries OR explicit skip-with-reason
devil ingest <rev-id> --from scg <scg-output.json>          # if supply-chain-relevant
devil conclude <rev-id> --synthesis "..." [--unresolved ...]

# Back to gate: critic reviews, factoring devil's findings
gate review <request-id> --by <critic> --lense devil \
  --verdict <ok|concern|reject> \
  --comment "see devil-review <rev-id>: <synthesis summary>"

# Then the lifecycle continues
gate execute <request-id> --by <executor>
gate complete <request-id> --by <executor>
```

The two passages run in parallel, not nested. `gate review`'s
free-text `--comment` carries the cross-reference to the
devil session.

### C3: agora + devil — explore-then-audit

**Shape**: "is there a security concern here?" — the question
itself isn't yet a finding.

```bash
# Phase 1: agora to think about it
agora new --slug security-question-X --kind sandbox --title "..."
agora play --slug security-question-X
agora move <play-id> --text "I noticed Y, suspect it could lead to Z"
# moves accumulate; if a real concern crystallizes...

# Phase 2: devil opens, references the agora play
devil open <target-ref> --type <type>
devil entry <rev-id> --persona red-team --lense <l> --kind finding \
  --severity <s> --severity-rationale "..." \
  --text "<finding>; surfaced via agora play <play-id>: <summary>"
# rest of the devil session...
```

agora produces hypotheses, devil tests against the catalog.

### C4: All three — the bug-killing flow

**Shape**: a bug is suspected. You want to find root cause, fix
it, ship it, and (where security-relevant) audit the fix.

```bash
# Phase 1: lightweight notice
gate issues add --from <you> --severity <l> --area <a> \
  "<bug summary>"
# This is "I noticed something" — no commitment to fix yet.

# Phase 2: investigate (agora — exploration-shaped)
agora new --slug bug-<short-name> --kind sandbox --title "..."
agora play --slug bug-<short-name>
agora move <play-id> --text "<symptom 1>"
agora move <play-id> --text "<hypothesis 1>"
agora move <play-id> --text "<hypothesis 2: contradicts 1>"
# pause if interrupted
agora suspend <play-id> --cliff "..." --invitation "..."
# resume + continue
agora resume <play-id>
agora move <play-id> --text "<root cause confirmed: ...>"

# Phase 3: commit to fix (gate — judgment-shaped)
gate issues promote <issue-id> --from <you> [--executor <you>] \
  [--auto-review <critic>]

# Phase 4a: routine fix → gate review only
gate review <request-id> --by <critic> --lense layer \
  --verdict ok --comment "fix matches the diagnosis in agora <play-id>"

# Phase 4b: security-implicated fix → ALSO devil
devil open <fix-pr-url> --type pr
# touch all 12 lenses substantively (this is where the floor matters)
devil entry <rev-id> --persona red-team --lense <relevant> --kind finding ...
devil conclude <rev-id> --synthesis "..."
# Then in gate review:
gate review <request-id> --by <critic> --lense devil \
  --verdict <ok|concern> \
  --comment "devil <rev-id> concluded clean / with N unresolved"

# Phase 5: ship + close
gate execute <request-id> --by <executor>
gate complete <request-id> --by <executor>
agora conclude <play-id> --note "fix landed via gate <request-id>"
```

This is the recipe. **The bug-killing flow is `issue → agora →
gate (+ devil if security)` end-to-end.** Each phase uses the
right-shape passage; the substrate links them via free-text
references.

### C5: agora + gate — ordering N independent items

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

# 2) Deliberate with multi-voice (one move per voice / lens)
agora move <play-id> --by <you>   --text "candidates + dependencies"
agora move <play-id> --by <miki>  --text "size + conflict-surface analysis"
agora move <play-id> --by <noir>  --text "dependency graph: independent vs chained"
agora move <play-id> --by <devil> --text "what fails if order is wrong"
agora move <play-id> --by <you>   --text "decision: A → B → C → D, defer E"

# 3) Conclude with the order in the note (one-line audit trail)
agora conclude <play-id> --by <you> \
  --note "order locked: A → B → C → D; E deferred"

# 4) Stamp gate waves in the chosen order (one per item, or N parallel)
gate request --action "ship #A" --from <you> --executor <a> ...
gate request --action "ship #B" --from <you> --executor <b> ...
# ... approve / execute / complete as the ship plan dictates
```

**When to reach**: 3+ independent items, non-obvious order, or
multiple voices have something to contribute. **When to skip**: 1-2
items or order is forced by dependency; a 3-line code comment in
the first commit suffices.

### C6: bundle-PR recipe — N independent verbs touching the same config sites

**Shape**: a swarm shipped N independent verbs in parallel
(`gate request --executors a,b,c` or N separate one-actor waves
via [C5](#c5-agora--gate--ordering-n-independent-items)). Each
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

## When NOT to use devil (honest limits)

devil is **shape-mismatched for general bug review**. Routine
bugs (off-by-one, missing null check, wrong default value,
performance regression, UI layout) don't fit the 12-lense
catalog cleanly — most lenses are security-specific, and
filling 9-11 lenses with `kind: skip / reason: "n/a"` per
review degrades the substrate.

**The risk:** if cargo-cult "n/a" skip entries accumulate, the
lense-coverage gate's floor-raising effect erodes. Real
skip-with-reason entries (substantive declarations like
"no XML parser → injection-parser irrelevant") get drowned
in noise.

**Heuristic**: if you can't write a *substantive* skip-reason
on most lenses (i.e., the skip-reason itself is informational),
the work isn't devil-shaped. Use `gate review` instead — its
configurable lense list (default `devil / layer / cognitive /
user`) is sized for general code review.

Use devil when:
- Authentication / authorization changes (`auth-access` lense)
- Input validation / parsing / escaping (`injection`, `injection-parser`)
- Crypto code (`crypto`)
- Supply-chain changes (`supply-chain` — runtime-enforced via SCG)
- Cross-cutting refactors that could break composition (`composition`)

Skip devil for:
- Pure logic bugs with no untrusted input boundary
- UI / styling / typo fixes
- Test-only changes
- Documentation changes (this PR, for example)

---

## Tips for AI agents

### T1: orient before acting

```bash
gate boot
```

First call of every session, no exceptions. The JSON envelope
contains everything needed to know "where am I, what's open,
who am I, what did I touch last." Avoid making decisions
before reading the envelope.

### T2: recognize the shape, then dispatch

When a piece of work arrives, ask in this order:
1. Could a verdict close it? → gate
2. Is it open-ended thinking? → agora
3. Could it harm a third party if landed unseen? → devil

If you can't answer these three, start with `agora new --kind
sandbox` — exploration always works for "I'm not sure yet."

### T3: substrate suspends gracefully across instances

```bash
# Before context runs out / you're interrupted:
agora suspend <play-id> --cliff "..." --invitation "..."
devil suspend <rev-id> --cliff "..." --invitation "..."
```

The next instance picks up via `resume`. The cliff/invitation
is the *message you leave for the next you*. Don't suspend with
a vague cliff ("paused") — make it actionable for the resumer.

### T4: JSON first, text second

Every write verb supports `--format json|text`. JSON is the
*agent contract*; text is the *human projection*. When parsing,
pass `--format json`; the envelope shape is stable across
verbs. When eyeballing during dogfood, `--format text`.

### T5: `--by` defaults from `GUILD_ACTOR`

```bash
export GUILD_ACTOR=<you>
```

Set once per session. Every verb that takes `--by` will read
this if you omit the flag. Saves repetition.

### T6: schema is the contract

```bash
gate schema --format json
agora schema --format json
devil schema --format json
```

Each passage's `schema` verb advertises every implemented
verb, its required/optional flags, and its output shape. If a
verb behaves unexpectedly, schema is the source of truth.

### T7: terminal states are terminal

- A concluded `agora` play accepts no further verbs (no resurrect)
- A concluded `devil` review accepts no further entries / suspensions / resumes / re-runs
- A completed `gate` request can be referenced but its lifecycle is closed

If you need to *change your mind* after a terminal close:
- agora: start a new play that references the old one in description / first move
- devil: file a new review with `target.ref` linking to the old
- gate: file a new request with `--reason` citing the old

The substrate is append-only at the contest level — past
records aren't edited; new records are added.

### T8: when in doubt, dogfood

If you don't know how a passage behaves, set up a tmpdir,
seed `guild.config.yaml` + `members/<you>.yaml`, and run a
short session. This is how every passage got de-bugged in
its design phase (see `examples/three-passages-framing/`,
`examples/dogfood-session/`).

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

# 7) One execute → one complete (lifecycle is wave-scoped, not per-executor)
gate execute 2026-05-11-0001 --by agent-issues
# … cherry-pick both SubAgents' commits into a single branch, push, open PR …
gate complete 2026-05-11-0001 --by agent-issues --note "PR #291 opened"
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

### Known limitations (as of 2026-05-11)

These are real, known, and tracked as separate issues for shipable
fixes:

- **One lifecycle for N executors** — `gate complete` fires once for
  the wave even when multiple executors finished different slices.
  Per-slice closure is not first-class on the substrate. Follow-up
  to #230 (see issue tracker — `gate slice-complete` / per-executor
  status field).
- **In-flight slice status not visible** — `gate boot` and the
  overlap surface (#234) detect cross-request overlap but don't
  expose per-executor progress inside a single wave. A future
  `gate wave-status <id>` read verb composes per-executor latest
  witness + last write; tracked separately.
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
- **Worktree → parent-ledger blindspot** — when SubAgent isolation
  uses a Claude Code worktree (`.claude/worktrees/agent-*`), the
  SubAgent's `gate witness` / `gate complete` against the parent
  wave id **fails silently or with not-found**: the ledger lives in
  the parent session's substrate, not in the worktree's git tree.
  Two consequences:
  1. Per-slice progress witness from inside the worktree is not
     possible. The SubAgent should report progress in its final
     report; the parent stamps `gate witness` / `gate complete` on
     return.
  2. The SubAgent brief MUST surface this. Otherwise each SubAgent
     individually discovers it ("ledger not visible — can't stamp")
     and the same friction recurs every wave.
  Recommended brief snippet:
  ```
  Note: the gate wave record lives in the PARENT session's
  substrate, not in this worktree. `gate witness` / `gate complete`
  against the wave id WILL NOT reach the ledger from here. Do not
  attempt; report progress in your final result message and the
  parent will stamp on your behalf.
  ```

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

## Where to find things

| Need | Location |
|------|----------|
| Verb-by-verb reference | [`./verbs.md`](./verbs.md) |
| Per-passage architecture | `src/passages/<name>/README.md` |
| Lore principles | [`../lore/principles/`](../lore/principles/) |
| Real worked examples | [`../examples/`](../examples/) |
| Threat model + safety surface | [`../SECURITY.md`](../SECURITY.md) |
| Stability promise | [`./POLICY.md`](./POLICY.md) |

This playbook is the *combos* layer. Each individual passage
has its own README and the verbs.md per-verb deep dive; this
doc is what you read once you know what each passage does and
want to know how to *use them together*.
