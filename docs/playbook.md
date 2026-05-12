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

> **Migrated to [`docs/swarm.md` § Ordering N independent items](./swarm.md#ordering-n-independent-items-agora--gate).**
> This anchor (`#c5-agora--gate--ordering-n-independent-items`) is
> kept so existing deep links still resolve. Reach for this recipe
> when you have 3+ independent items and a non-obvious order;
> read the full sequence in `docs/swarm.md`.

### C6: bundle-PR recipe — N independent verbs touching the same config sites

> **Migrated to [`docs/swarm.md` § Bundle-PR recipe](./swarm.md#bundle-pr-recipe--n-independent-verbs-touching-the-same-config-sites).**
> This anchor (`#c6-bundle-pr-recipe--n-independent-verbs-touching-the-same-config-sites`)
> is kept so existing deep links still resolve. Reach for this
> recipe when N parallel PRs all touch the same dispatcher /
> config-list sites; the full cherry-pick-and-bundle sequence
> lives in `docs/swarm.md`.

---

## Synergies

The combos above are *recipes for situations* — when a bug appears,
when a PR needs review, when a wave needs ordering. **Synergies** are
the other direction: pairings of verbs that, once you've seen them,
start to feel less like ceremony and more like a move you reach for.
Each one pins a small principle of the substrate in a single arc.

Three things each synergy ships with:

- **Purpose** — what becomes legible afterward that wasn't before.
- **Trade-off** — what's preserved vs what's traded for the ergonomic shape.
- **E2E test** — the synergy's contract is pinned by a runnable test
  under `tests/e2e/`, so the doc and the substrate stay synced.

### S1: Mirror Persona Loop — two `--by` names, one body of work

```bash
# Two registered names, one person:
gate register --name <you>
gate register --name <you-mirror>

# Author, approve (by mirror), review (by mirror), execute, complete.
gate request  --from <you>     --executors <you>           --action "..." --reason "..."
gate approve  <id> --by <you-mirror>
gate review   <id> --by <you-mirror> --lense user --verdict ok --note "..."
gate execute  <id> --by <you>
gate complete <id> --by <you> --note "..."
```

**Purpose.** Stamp authorship and review on the *same body of work*
under *different `--by` names*. The substrate ends up carrying two
distinct perspectives on one request — author and mirror — without
inflating ceremony to a multi-actor wave. This is the minimal
expression of Two-Persona Devil discipline
([principle 02](../lore/principles/02-advisory-not-directive.md) +
[principle 08](../lore/principles/08-voice-as-doctrine.md)) when
you're solo.

**Trade-off.** Review depth is operator discipline, not enforced.
The mirror is the same actor wearing a different hat; if the
hat-swap is shallow, the discipline degrades to a self-stamp. The
`self_approve: allowed` default on the solo profile means a flat
`--by <you>` arc *also* succeeds (just with a "notice: claude
approved their own request" surfaced on the approve event). The
synergy is the *practiced shape*, not a code-enforced one. Flip to
`profile: swarm` and `self_approve: forbidden` makes the separate
`--by` mandatory — same arc, different enforcement.

**E2E test.** [`tests/e2e/synergy_s1_mirror_persona_loop.test.ts`](../tests/e2e/synergy_s1_mirror_persona_loop.test.ts)
pins three contracts:

1. The mirror arc completes (`state: completed`, both personas
   recorded on `status_log[]`, one review by the mirror).
2. The same-actor degenerate arc *also* completes — documenting the
   trade-off surface (substrate cannot tell after the fact whether
   the operator exercised the discipline).
3. The swarm-profile flip refuses self-approve, requires the mirror.

If you change the verb surface in a way that breaks any of those
three, the test fails loud. The doc and the substrate move together.

### S2: Cross-Session Body Switch — one actor, distinct session_ids per body

```bash
# Same actor name. Two sessions, two GUILD_SESSION_ID values:
export GUILD_ACTOR=<you>

# Body A (e.g. terminal A, early-day) opens the wave.
GUILD_SESSION_ID=<you>-terminal-a-2026-05-12 \
  gate request --from <you> --executors <you> --action "..." --reason "..."
# → 2026-05-12-0001

# (Optional) Critic approves so the wave is claim-eligible.
gate approve 2026-05-12-0001 --by <critic>

# Body B (e.g. terminal B, later in the day) picks the wave up.
GUILD_SESSION_ID=<you>-terminal-b-2026-05-12 \
  gate claim 2026-05-12-0001 --by <you> --note "body B picks up"
```

**Purpose.** Pin *which body* of an actor did *which move* on the
same record. The substrate then carries `opened_by_session` and
`claimed_by_session` side-by-side under one `--by` — a cold reader
sees "claude in terminal A opened this, claude in terminal B
claimed it" without having to ask. This is the smallest expression
of [principle 14](../lore/principles/14-substrate-engagement-reduces-coordination-context-cost.md):
two bodies of one actor coordinate through the record, not through
shared working memory.

**Trade-off.** Session_ids are hand-named (`<role>-<wave_date>` is
the suggested template, but no enforcement). Auto-allocation is on
the backlog and would lose the human-readable property; until then,
the operator picks names that survive being re-read 30 days later.
`witness_sessions[<actor>]` is a single-value map: re-witness from
a new session_id *overwrites* the previous one. The trade is
explicit — the substrate carries "current body" per actor, not
"history of bodies." Most coordination flows want the former; if
the history matters, log it in an agora play or add explicit
`gate message` entries.

**E2E test.** [`tests/e2e/synergy_s2_cross_session_body_switch.test.ts`](../tests/e2e/synergy_s2_cross_session_body_switch.test.ts)
pins three contracts:

1. `opened_by_session` and `claimed_by_session` are distinct stamps
   when the same actor opens-then-claims across two sessions.
2. Re-witness with a new `GUILD_SESSION_ID` overwrites
   `witness_sessions[<actor>]` and the matching `witness_notes`
   entry (latest body wins).
3. A malformed `GUILD_SESSION_ID` (whitespace / capital letters /
   any value failing `SESSION_ID_RE`) surfaces a `notice:` on
   stderr and proceeds with the session unstamped — silent strip is
   refused.

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

> **Migrated to [`docs/swarm.md` § Swarm × Claude SubAgent harness](./swarm.md#swarm--claude-subagent-harness).**
> This anchor (`#swarm--claude-subagent-harness`) is kept so existing
> deep links still resolve (notably from `AGENT.md`, `README.md`,
> and `lore/principles/14`). The full worked sequence, the
> known-limitations checklist, the worktree-ledger blindspot recipe,
> and the "ceremony swarm" failure mode all live in `docs/swarm.md`.

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
