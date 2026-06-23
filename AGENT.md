# guild-cli — agent quick reference

> This is the short-form reference for AI agents.
> Brand-new to the concepts?
> [`docs/concepts-for-newcomers.md`](./docs/concepts-for-newcomers.md)
> is a 30-second map. Design rationale lives in
> [`README.md`](./README.md). For **how to combine gate / agora /
> devil for real work** (combos, recipes, bug-killing flow), see
> [`docs/playbook.md`](./docs/playbook.md). For **multi-executor /
> SubAgent swarm coordination**, see [`docs/swarm.md`](./docs/swarm.md).
> For **project-specific term definitions** (passage / wave / slice /
> mirror / synergy / axis / lore / etc.), see
> [`docs/glossary.md`](./docs/glossary.md).

> **Humans welcome.** This file is the short-form for AI agents
> because it densifies — verbs, state machine, JSON envelope — into
> something an agent can consume cold. Humans reading the same file
> get the same information without the prose padding. The substrate
> doesn't distinguish: human and AI actors share a content_root,
> share a trail, share the same verbs. AI-agent-first is a
> documentation density choice, not a membership tier.

File-based coordination for human and AI agents. No daemon, no DB, no
network. State lives in YAML files under a `content_root`. Git gives
you history.

## Solo flow

If you are running solo (one actor, one shell, one wave at a time),
you need only the **Common** verbs below. The full arc is six calls:

```bash
gate register --name <you>            # once per content_root
gate request --action "..." --reason "..." --executors <you>
gate approve <id> --by <mirror>
gate review  <id> --by <mirror> --lense user --verdict ok
gate execute <id> --by <you>
gate complete <id> --by <you>
```

`<mirror>` is a second persona / different `--by` for the same
actor (you-as-critic, or another registered agent). Two-Persona
Devil discipline: even solo, the approver / reviewer is a
different lense from the executor. The default solo profile sets
`self_approve: allowed` so `--by <you>` works for `approve` and
`review` too, but the mirror is the discipline the substrate is
shaped around — when you later flip to `swarm` profile,
`self_approve: forbidden` kicks in and a separate `--by` is
required by config.

The verb table further down is **tiered by audience**. Use the
[Tier index](#tier-index) to jump:

- **Common** — every solo / pair / swarm flow uses these
- **Coordination** — `claim` / `witness` / `executors` / sessions, for swarm
- **Boundary** — `agora` / `devil` / `ctx`, when the work isn't gate-shaped
- **Diagnostic** — `doctor` / `boot` / `schema`, when something breaks

Skip the Coordination and Boundary tiers on first read if you only
ship solo waves.

**You don't need to read all of this to be productive.** The
[Session start](#session-start) and [Agent-first knobs](#agent-first-knobs)
sections are enough for most days. Sections further down
(Diagnostic, Configuration, File layout, Troubleshooting) become
useful when something breaks or you want to extend the system.

### Tier index

Sections in this file are ordered by **topic** (lifecycle →
coordination → meta), not by tier. That means a tier banner can
appear more than once when its topic recurs — `Issues` and
`Members` are Common but sit between Coordination topics. The
table below lets you skip-jump by tier.

| Tier | Sections (in document order) |
|------|------------------------------|
| **Common** | [Session start](#session-start) · [Agent-first knobs](#agent-first-knobs) · [Request lifecycle](#request-lifecycle) · [Review (Two-Persona Devil)](#review-two-persona-devil) · [Reading](#reading) · [Issues](#issues) · [Messages](#messages) · [Members](#members) |
| **Coordination** | [Coordination & stake (#226 / #244 / #246)](#coordination--stake-226--244--246) · [Wave visibility (#295, freshness #309)](#wave-visibility-295-freshness-309) · [Reviewer-facing context (#310)](#reviewer-facing-context-310) · [Templates (#235, two-tier #302)](#templates-235-two-tier-302) · [Sessions (#249)](#sessions-249) |
| **Boundary** | [The four passages — a one-line dispatch shorthand](#the-four-passages--a-one-line-dispatch-shorthand) · [Agora (second passage — play / narrative)](#agora-second-passage--play--narrative) · [devil-review (third passage — security backstop, alpha)](#devil-review-third-passage--security-backstop-alpha) · [ctx (fourth passage — fact accumulation, alpha phase 2)](#ctx-fourth-passage--fact-accumulation-alpha-phase-2) |
| **Diagnostic** | [Diagnostic](#diagnostic) · [Configuration](#configuration) · [File layout](#file-layout) · [Environment](#environment) · [Output format](#output-format) · [Troubleshooting](#troubleshooting) · [Deep dives](#deep-dives) |

# Tier: Common (solo-usable)

These verbs cover the 5-step solo arc plus the read-side that
every flow uses. If you are running solo you can stop reading
after this tier.

## Session start

> Prerequisites (install / `GUILD_ACTOR` / `agora`-`devil` opt-in
> convention) are documented once in [`README.md`](./README.md#install).

```bash
# First time in this content_root? Register yourself:
gate register --name <you>              # category defaults to "professional"

# Every session after:
gate boot                # identity + status + tail + your_recent + inbox_unread (1 JSON)
gate boot --session-id <id>             # opt-in: stamps a session label on subsequent writes
gate resume              # picking up where the last session ended (needs GUILD_ACTOR)
# (old 3-command recipe — use boot above if you can consume JSON)
gate status              # pending/approved/executing/issues/inbox
gate whoami              # your identity + recent utterances (needs GUILD_ACTOR)
gate tail 10             # last 10 events across all actors

# Mid-session boundaries (#36 Phase 2 — append-only timestamp records):
gate rest                # "putting this down for now" — boundary record only
gate wake                # "picking it back up"        — pairs with rest, decoupled
gate farewell            # "until next session"        — pairs with `gate resume` next session
```

## Agent-first knobs

- `gate boot` — single-command orientation (identity + status + tail + inbox)
- `--format json` on every write verb (`request/approve/deny/execute/complete/fail/review/thank/fast-track`)
  returns `{ok, id, state, message, suggested_next:{verb, args, reason}}`
- `gate schema` — JSON Schema for all verbs (LLM tool-layer input)

## Request lifecycle

```
pending ─ approve ─▶ approved ─ execute ─▶ executing ─ complete ─▶ completed
   │                                            │
   └── deny ──▶ denied                          └── fail ──▶ failed
```

```bash
gate request --from <m> --action "..." --reason "..." \
             [--executors a[,b,c]] \
             [--auto-review <m>] [--with <m>[,<m>...]] \
             [--target <s>] [--depth shallow|standard|deep] \
             [--from-agora <play_id>] [--template <name>]
gate approve <id> --by <m> [--note "..."]
gate deny <id> --by <m> --reason "..."
gate execute <id> --by <m> [--cwd <path>]                  # cwd stamped on the status_log entry
gate complete <id> --by <m> [--note "..."] [--cliff "<hint for next agent>"]
gate fail <id> --by <m> --reason "..."
gate fast-track --from <m> --action "..." --reason "..." \
                [--executors a[,b,c]] [--with ...]
gate thank <to> --for <id> [--by <m>] [--reason <s>]       # gratitude (no verdict, no calibration)
```

`--executors` records **intent**, not access — anyone with substrate
access may run `gate execute`. When the actor differs from the assignee
the substrate captures both, and `gate execute` emits a `notice:` so
the mismatch is visible at the surface that did it. See
[issue #168](https://github.com/eris-ths/guild-cli/issues/168) for the
design rationale.

`--executors a[,b,c]` accepts one or many executors for single or
parallel waves (#230). The singular `--executor <m>` was removed from
`gate request` in v0.6 (per [#239](https://github.com/eris-ths/guild-cli/issues/239)) — use `--executors`.
Under `profile: swarm`, parallel waves additionally require worktree
isolation (`gate execute` refuses same-cwd collisions, #231).

`--depth shallow|standard|deep` is an **advisory** that the substrate
carries to reviewer agents (#221). Default = `standard` (current
behaviour); `shallow` invites point-checks; `deep` invites
arch / threat-model scrutiny. Per principle 02 the reviewer can
disagree.

`--from-agora <play_id>` lifts the play's most recent
cliff/invitation into `--reason` / `--action` (#232). The link is
recorded as `source_agora_play: <play_id>` in YAML so a later reader
can walk back to the discussion.

`--template <name>` expands a wave-brief skeleton from the
template registry (#235); discover available names with
`gate templates list` (see below).

## Review (Two-Persona Devil)

```bash
gate review <id> --by <m> --lense <l> --verdict <v> --comment "..."
```

- Lenses: `devil | layer | cognitive | user` (configurable in guild.config.yaml).
  The four defaults are meta-perspectives ("what breaks", "which
  layer", "where you hesitate", "whose happiness"). Add
  domain-specific lenses by listing them — e.g.
  `lenses: [devil, layer, cognitive, user, security, perf, a11y]`
  — so reviews can carry `--lense security` verdicts in addition to
  the meta four.
  - **Strict mode (#134 H2, opt-in).** Set `gate.strict_lenses: true`
    to flip the allowed-lense set from the gate-side `lenses:` list
    over to the unified devil catalog (bundled defaults +
    `<content_root>/devil/lenses/*.yaml` extensions, #134 G).
    Default is permanently `false` — never auto-flipped. Coverage
    discipline stays devil-side; strict mode is vocabulary
    enforcement only. See `docs/verbs.md` § Strict lense vocabulary.
- Verdicts: `ok | concern | reject`
- Reviews are append-only. Corrections are new entries, not edits.

## Reading

```bash
gate show <id> [--fields k1,k2] [--plain]  # request detail (JSON default; --fields trims, --plain unquotes a single field for shell substitution)
gate list --state <s|all> [--for <m>]   # filtered list (--state all = every state)
gate pending [--for <m>]                # shortcut for --state pending
gate board [--for <m>]                  # pending + approved + executing in one view
gate voices <name> [--lense <l>] [--verdict <v>] [--limit <N>] [--with-calibration]
gate tail [N]                           # recent activity stream (default 20)
gate chain <id>                         # cross-reference walk (one hop)
gate transcript <id>                    # narrative prose arc of a request
gate suggest [--format json|text]       # suggested_next only (hot-loop sibling of boot)
gate why <id>                           # decision walk: why is this request in this state?
gate summarize <id> [--limit <N>]       # narrative summary
gate unresponded [--for <m>] [--max-age-days <N>]   # concerns recorded but not yet responded to
gate flow-suggest --severity <s> --area <a> [--scope <s>]      # advisory: which flow shape? (#307)
gate lense-stats [--for <m>] [--since <d>]                     # lense rotation diagnostic (#305)
gate decisions [--for <m>] [--since <d>]                       # authored state transitions (#336; defaults --for to GUILD_ACTOR)
gate self-pattern [--for <m>] [--since <d>]                    # behavioral bias surface — decision + verdict ratio (#336)
```

The last four — `flow-suggest`, `lense-stats`, `decisions`,
`self-pattern` — landed across the 2026-05 ship arc (#305 / #307 /
#336). `decisions` and `self-pattern` are director-axis reads
(default `--for` to `GUILD_ACTOR`); `lense-stats` is a bias mirror
that `self-pattern` cross-links to for the full lense breakdown.
`flow-suggest` is pure advisory — no substrate writes, no state.

# Tier: Coordination (swarm)

These verbs and configuration knobs are for multi-executor /
cross-session work. If you only ship solo waves, skip ahead to
the Boundary tier or the Issues / Messages sections. The worked
recipes for this tier live in [`docs/swarm.md`](./docs/swarm.md).

## Coordination & stake (#226 / #244 / #246)

Cross-session race mediation for waves where multiple actors might
silently overlap. `claim` is exclusive ("I'm working on this"),
`witness` is non-exclusive ("I'm watching this"); both cooperate with
`gate boot`'s overlap surface (#234).

```bash
gate claim <id> --by <m> [--note "..."]        # exclusive stake; refuses on conflict
gate witness <id> --by <m> [--note "..."]      # non-exclusive observer; never refuses
gate unwitness <id> --by <m>                   # remove your own witness
```

- `claim` allowed on `pending` / `approved`; refuses if a different
  actor already holds the claim. Same-actor re-claim is a no-op.
- `witness` allowed on `pending` / `approved` / `executing`;
  multiple actors can witness the same wave simultaneously.
- Both auto-release on terminal transitions (completed / failed / denied).
- `--note` is short metadata for the stake event (≤ 80 chars), not
  commentary. Wider discussion belongs in agora plays.

### Wave visibility (#295, freshness #309)

```bash
gate wave-status <id> [--format text|json]
```

Per-executor in-flight slice view for a multi-executor wave.
Composes executors + per-witness fields + status_log timestamps to
surface "is each executor still making progress?" inside one wave.

Per #309, the stale judgment is **per-executor** (max of
`witnessUpdatedAt[name]`, `status_log[by=name]`, `claimedAt`). A
fresh witness on a 33-min-old wave no longer trips a false stale.
Wave-level `(stale)` in the footer derives from
`wave_stale_effective` ("all executors stale"), separating
"how old?" (`age_band`) from "is anyone still working?".

### Reviewer-facing context (#310)

```bash
gate review-context <id> [--format text|json]
```

Single read verb that returns the bundle a reviewer (devil agent,
CI script, human auditor) needs to drive behaviour from substrate
state instead of out-of-band prompt content:

- `action` / `reason` / `target` / `executors`
- `depth` advisory (#221): `shallow | standard | deep` (null when
  the wave was created without `--depth`)
- `recommended_lenses`: derived from `depth`
  - `shallow` → `[Logic]` (point-check)
  - `standard` → 6-lense default (`Logic, Pattern, Flow, Error, Test, Input`)
  - `deep` → all 10 + extras (`memory_mcp_trap_lookup`,
    `state_machine_trace`, `prior_review_cross_check`)
- `prior_reviews` bundled in-payload — saves a second `gate show`
- `warning` is non-empty when no `--depth` was recorded

Advisory not directive (principle 02). The reviewer is free to
widen / narrow and record the divergence in its review output.

## Templates (#235, two-tier #302)

Wave-brief skeletons resolved from two tiers, with content_root
shadowing built-in by name:

- **Built-in** (shipped with guild-cli): `<packageRoot>/templates/wave-brief/`
- **User override**: `<content_root>/data/guild/templates/wave-brief/`

Five built-ins ship out of the box: `single-impl`, `parallel-impl`,
`research-wave`, `verification`, `compare-and-ratify`. A user
override with the same `template_name` replaces the built-in
entirely for that instance (no merge).

```bash
gate templates list                            # tagged [built-in] / [content_root]
gate templates show <name>                     # full template body (override wins)
gate request --template <name> [--action ...]  # expand skeleton on create
```

Under `profile: swarm`, parallel-shaped waves
(`--executors a,b`) emit a notice when filed without a `--template`
so the brief is on record (Phase 1 — warning only; enforcement is
follow-up).

# Tier: Common — Issues / Messages

_Common tier resumes here ([jump back to Tier index](#tier-index))._

## Issues

```
open ↔ in_progress ↔ deferred → resolved (reopen → open)
```

```bash
gate issues add --from <m> --severity <low|med|high> --area <a> --text "<text>"
gate issues list [--state <s>]
gate issues resolve|defer|start|reopen <id> --by <m>   # --by required; appends state_log
gate issues note <id> --by <m> --text "..."          # append annotation
gate issues promote <id> --from <m> [--executors a[,b,c]] [--auto-review <m>] [--action <s>] [--reason <s>]
```

State transitions append to `state_log: [{state, by, at, invoked_by?}]`
(max 100 per issue). `--by` is required so the audit entry records
the actor; falls back to `GUILD_ACTOR` when unset.

## Messages

```bash
gate message --from <m> --to <m> --text "..." [--type <s>]
gate broadcast --from <m> --text "..." [--type <s>] [--expects-response]
gate inbox --for <m> [--unread]
gate inbox mark-read [N] --for <m>
```

`--expects-response` (#220) on a broadcast opts the sender into the
`broadcast-pending-response` surface. `gate boot` then leads with
that suggestion when no higher-priority lifecycle work is open;
the surface clears when the recipient marks the entry read.

# Tier: Coordination — Sessions

_Coordination tier resumes here ([jump back to Tier index](#tier-index))._

## Sessions (#249)

Optional **session_id** dimension on top of the member axis so
multi-body coordination (one member running multiple shells, or a
member coexisting with their AI agent counterpart) keeps an
attributable trail.

```bash
gate boot --session-id eris-local-2026-05-08-evening   # validates + echoes payload
export GUILD_SESSION_ID=eris-local-2026-05-08-evening  # whole-shell carrier
gate request ...           # stamps `opened_by_session: <id>`
gate claim <id> --by <m>   # stamps `claimed_by_session: <id>`
gate witness <id> --by <m> # stamps `witness_sessions[<actor>]: <id>`
```

- Format: free-form ASCII, regex `^[a-z0-9][a-z0-9_:.-]{0,63}$`.
- Opt-in: nothing is required; pre-#249 records and unstamped
  post-#249 writes round-trip byte-identical YAML.
- Discovery: `gate boot` surfaces `hints.session_id_unset: true`
  when an actor resolved but no session is configured.
- Self-race detection: `gate boot.active_overlapping_targets[].parallel_session_authors`
  flags an actor authoring ≥2 overlapping requests from ≥2 distinct
  sessions; text mode prints `⚠ same-actor parallel sessions: <m>`.

# Tier: Common — Members

_Common tier resumes here ([jump back to Tier index](#tier-index))._

## Members

```bash
guild list                              # all members + hosts
guild show <name>                       # member YAML
guild new --name <n> --category <c>     # create member
guild validate                          # check all member YAMLs
```

Categories: `core | professional | assignee | trial | special | host`

# Tier: Boundary (agora / devil / ctx)

These are the non-gate passages — reach for them when the work
isn't request-shaped (open exploration, multi-persona security
review, or verdict-less observation). Solo flows can ignore this
tier entirely if all your work fits the gate request lifecycle.

## The four passages — a one-line dispatch shorthand

| passage | shape (一語)         | the verb you do                | when to reach |
|---------|----------------------|--------------------------------|----------------|
| `gate`  | **判断 / judgment**  | decide on a request            | needs a verdict (approve / deny / complete / fail / review) |
| `agora` | **探索 / exploration** | stay with a thought          | something in motion that shouldn't be forced to a verdict yet |
| `devil` | **守備 / defense**   | protect end-users              | could harm a third party if it lands without scrutiny |
| `ctx`   | **事実 / fact**      | record an observation          | observed across sessions; would be lost without an attributed, append-only record |

This is a dispatch tool, not a metaphor. Recognize the shape of
the work, route to the matching passage. The substrate of each
passage is shaped by what it holds (decisions / explorations /
multi-perspective scrutiny / observations), not by what it talks
about.

## Agora (second passage — play / narrative)

`agora` is the second passage under guild — alongside `gate`. Where
gate is request-lifecycle / review, agora is play / narrative with
**suspend / resume as first-class primitives** (per design issue
[#117](https://github.com/eris-ths/guild-cli/issues/117)).

```
playing ── move ──────▶ playing
        ── suspend ───▶ suspended ── resume ──▶ playing
        ── conclude ──▶ concluded (terminal)
suspended ── conclude ▶ concluded (drift-away outcome)
```

```bash
agora new --slug <s> --kind <quest|sandbox> --title "<t>" [--by <m>] [--description "<d>"]
agora play --slug <game-slug> [--by <m>]
agora move <play-id> --text "<text>" [--by <m>]
agora suspend <play-id> --cliff "<what just happened>" --invitation "<next move>" [--by <m>]
agora resume <play-id> [--note "<resume prose>"] [--by <m>]
agora conclude <play-id> [--note "<closure prose>"] [--by <m>]
agora list [--game <slug>] [--state <playing|suspended|concluded>]
agora show <slug-or-play-id> [--game <slug>]   # auto-disambiguates by pattern
agora last [--by <m>] [--state <s>] [--include-concluded]   # "which play am I in?"
agora cliff <play-id> [--game <slug>]          # peek closing cliff/invitation, no state change
agora schema [--verb <name>]                   # principle 10 contract
```

All agora verbs also accept `[--format json|text]` (omitted above for
density) — the JSON envelope is the agent contract, same as gate.

agora records live under `<content_root>/agora/`:

```
<content_root>/agora/
  games/<slug>.yaml           # game definitions
  plays/<game-slug>/<play-id>.yaml  # play sessions (sequence per game per day)
```

Suspend/resume substrate (the `cliff` + `invitation` prose recorded
on suspend, surfaced in resume's success output) is the
**substrate-side Zeigarnik effect** — motivation for re-entry is in
the substrate, not the agent's psychology. Per principle 11
(AI-first, human as projection).

## devil-review (third passage — security backstop, alpha)

`devil` is the third passage under guild — alongside `gate` and
`agora`. Where gate carries decisions and agora carries narrative,
devil carries **review-as-deliberation-substrate**: a multi-persona,
lense-enforced surface that composes with single-pass tools
(Anthropic `/ultrareview`, Claude Security, supply-chain-guard)
rather than replacing them. Design rationale lives in
[issue #126](https://github.com/eris-ths/guild-cli/issues/126).

Goal: raise the security knowledge floor for code reviewed by
authors who haven't met OWASP top 10 — not to guarantee protection,
but to keep the dialogue honest when a finding is dismissed.

```
open ──── conclude ────▶ concluded (terminal)
```

Softer than agora's state machine: suspend / resume cycles are
append-only history that *does not block* other entries. Multiple
reviewers can be working simultaneously; the cliff/invitation just
records re-entry context.

```bash
devil open <target-ref> --type <pr|file|function|commit|system> [--by <m>]
devil entry <rev-id> --persona <p> --lense <l> --kind <k> --text "<prose>"
                     [--severity <c|h|m|l|info>]
                     [--severity-rationale "<prose>"]   # required when kind=finding
                     [--addresses <e-NNN>]
                     [--by <m>]
devil list [--state <open|concluded|all>] [--target-type <pr|file|function|commit|system>]
devil show <rev-id>
devil conclude <rev-id> --synthesis "<prose>" [--unresolved e-001,e-002,...] [--by <m>]
devil dismiss <rev-id> <entry-id> --reason <r> [--note "..."] [--by <m>]
devil resolve <rev-id> <entry-id> [--commit <sha>] [--by <m>]
devil suspend <rev-id> --cliff "..." --invitation "..." [--by <m>]
devil resume  <rev-id>  [--note "..."] [--by <m>]
devil ingest  <rev-id>  --from <ultrareview|claude-security|scg> <input-path> [--by <m>]
devil schema [--verb <name>]                            # principle 10 contract
```

devil records live under `<content_root>/devil/`:

```
<content_root>/devil/
  reviews/<rev-id>.yaml         # one file per review session
                                # rev-id format: rev-YYYY-MM-DD-NNN
                                # (sequence per content_root per day)
```

Entry kinds (validated per-kind at the domain boundary):

- `finding` — concrete vulnerability candidate. `severity` AND
  `severity_rationale` required. `severity_rationale` is the
  friction that forces **exploitability-context reasoning**
  (Claude Security style — same category may be different
  severity in different repos). `status` defaults to `open`;
  the future `dismiss` / `resolve` verbs transition it.
- `assumption` — declared trust assumption ("auth() is
  correct"). Later entries can `--addresses` it to contest.
- `resistance` — verdict-less concern ("something feels off").
  Held without verify; suspend/resume can carry it across
  sessions.
- `skip` — `--text` declares why the lense is irrelevant. The
  substrate keeps the skip explicit (silent skipping defeats
  the floor-raising design).
- `synthesis` — cross-cutting reading for the conclusion phase.
- `gate` — multi-stage automated check output (e.g., SCG's
  8 gates). **Reserved for `devil ingest`** — building
  `stages[]` from CLI flags is too brittle.

Personas (catalog-enforced; ingest-only personas land with their
verbs):

- `red-team` — adversarial framing strict
- `author-defender` — articulate the author's framing + assumptions
- `mirror` — read both, surface contradictions and shared blind spots

Lenses (v1 catalog of 12 bundled defaults, plus per-content_root
extensions under `<content_root>/devil/lenses/<name>.yaml` loaded by
`ComposedLenseCatalog` — extend-only, name collisions with bundled
fail loud at startup. See #134 G):

- `injection` / `injection-parser` / `path-network` / `auth-access`
  / `memory-safety` / `crypto` / `deserialization`
  / `protocol-encoding` — Claude Security's 8 categories
- `composition` — multi-file/function effect; diff review tends to
  miss
- `temporal` — TOCTOU / race / retry / idempotency
- `supply-chain` — **mandatory delegate to SCG** (hard-error if SCG
  is unavailable; per #126 decision C, the floor-raising design
  refuses silent skip on supply chain)
- `coherence` — bird's-eye / cross-lense / cross-target. Doc/code
  drift, naming inconsistency, contradictions between findings
  under different lenses, architectural-posture observations.
  Promoted from a methodology gap (mirror's dogfood e-014) to a
  first-class lense so the audit posture itself is auditable.

Conclusion is verdict-less: `--synthesis` prose is required, and
`--unresolved` lists entry ids the reviewer chose not to dismiss-
or-resolve before closing. Substrate-explicit "these threads stay
open."

Status: alpha. v1 surface complete — all 11 verbs from #126 are
invokable (open / entry / list / show / dismiss / resolve / suspend
/ resume / ingest / conclude / schema). Real-world adapter shims
that translate actual `/ultrareview` `bugs.json` / Claude Security
findings / SCG verdict output into devil's strict v0 ingest JSON
shapes are out of scope for the in-tree passage and would land as
separate utilities (or in the source tools themselves).

## ctx (fourth passage — fact accumulation, alpha phase 2)

`ctx` is the fourth passage under guild — alongside `gate`, `agora`,
and `devil`. Where gate carries decisions, agora carries narrative,
and devil carries multi-persona scrutiny, ctx carries
**observations that should outlive the session that produced them**
without being forced into a verdict, a play, or a review.

Verdict-less, attribution-required, append-only. Per principle 12
(substrate-pure module in projection ecosystem), ctx is the
substrate primitive for facts; surrounding ecosystem modules
(persona-side `*_resume.md`, code comments, ADR docs) hold related
prose at different layers without absorbing into one another.

Shipped: `ctx record`, the correction verb `ctx supersede` (a correction
is a *new* fact whose `supersedes` points back at the old one — the old
record is never mutated; `ctx list` folds it out by default, `--all` keeps
it marked, `ctx show <old-id>` resolves the reverse `superseded_by` link as
an **array** of successor ids — empty while current, more than one when two
corrections fork the same fact), the read-side `list` / `show`, and the OKF
interop pair (`export` / `import`, below). The remaining lifecycle verbs
(`fork` / `chain` / `status`) and schema extensions (`evidence` / `sub_of`
/ `chain_after` / `branch_ref`) land in phase 2.

```bash
ctx record --fact "<prose>" [--tag prefix:value,prefix:value]
                            [--by <m>] [--format json|text]
ctx list [--tag prefix:value] [--by <m>] [--format json|text]  # read back, newest first
ctx show <id> [--format json|text]                             # one fact in full
```

ctx records live under `<content_root>/ctx/`:

```
<content_root>/ctx/
  ctx-YYYY-MM-DD-NNN.yaml      # one flat YAML per observation
                                # id sequence per content_root per day
                                # immutable on save (re-readers see what was written)
```

Tags follow `prefix:value` shape (e.g. `tech:typescript`,
`status:active`, `topic:ctx-design`). Both halves are validated at
the boundary; the prefix is what makes tags semantically queryable
later — filter by `tech:*`, `status:*`, etc. Phase 1 leaves prefix
choice free-form; phase 2 will introduce strictness levels (0/1/2 =
loose / middle / strict) for prefix catalogs.

**OKF interchange (export / import).** ctx facts project to and from
[Open Knowledge Format](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/)
bundles — a directory of `<id>.md` files (YAML frontmatter + fact prose)
plus generated `index.md` / `log.md` views. OKF is an interchange
*projection* (principle 11), not a storage change: the on-disk substrate
stays YAML; OKF is another surface, the way `--format text` is.

```bash
ctx export <dir> [--as okf] [--force] [--format json|text]   # facts -> OKF bundle
ctx import <dir> [--as okf] [--by <m>] [--allow-duplicates]
                 [--format json|text]                         # bundle -> facts
```

Round-trip is lossless for guild-authored bundles — `id`, `timestamp`,
`author` and `tags` survive the trip, and re-importing the same bundle
is idempotent (existing ids skip). Foreign bundles import tolerantly:
nested subtrees are walked; bare tags land under `topic:`; a non-`Fact`
`type` is preserved as an `okf:<type>` provenance tag; a doc with no
usable `type` (frontmatter-less, or `type` empty) still records but is
tagged `okf:none` so a stray non-concept `.md` (a README, a note) is
auditable via `ctx list --tag okf:none` rather than passing silently
as a Fact; documents lacking an author fall back to `--by`; empty or
unparseable documents are reported as skipped rather than failing the
whole import. A foreign `id` that collides with an existing record but
carries *different* prose is reallocated a fresh id rather than dropped
(the idempotent skip is gated on a prose match, so a distinct observation
is never lost). `export` refuses a non-empty target directory unless
`--force`, so it can't silently clobber an unrelated tree.

**Prose dedup** is on by default: a fact whose prose is already recorded
— under any id, or earlier in the same bundle — is skipped, so even an
id-less foreign bundle re-imported is a no-op (the skip reason names the
record it duplicates). The match is **trim + whitespace-collapse only —
case and punctuation are significant**, so it catches re-wraps but not a
hand-edited copy (capitalized, re-punctuated). For a guild-authored
bundle the `id` carries that case via the idempotent skip; a *foreignized*
copy (id stripped + body reworded) can re-import as a new fact. That is
intentional — dedup is a cheap exact-prose guard, not a similarity model.
`--allow-duplicates` opts out for a deliberate re-record. `--as` selects
the bundle format (only `okf` today; the flag is the seam for a future
second format).

When to reach for ctx vs the other passages: ctx is the residence
for prose that doesn't want closure. If the observation is heading
toward a verdict, file it via `gate request`. If it's
thought-in-motion across sessions, use `agora play`. If it's a
finding that needs adversarial scrutiny, use `devil entry`. ctx is
for what remains: pinned observation, no closure required.

Status: alpha, phase 2 in progress. Write-side is `ctx record` +
`ctx supersede`; read-side is `ctx list` (newest-first, `--tag` / `--by` /
`--all` filters) + `ctx show <id>`, plus `ctx export` (OKF projection).
`ctx chain` still arrives in phase 2 and that's the design test
(junk-drawer risk vs principled substrate at the 100-record scale).

# Tier: Diagnostic

These verbs and configuration sections are for when something
breaks, when you're embedding guild-cli, or when you want to
extend the system with plugins. Daily operation rarely needs
them.

## Diagnostic

```bash
gate doctor [--format json|text] [--summary]     # read-only health check
gate doctor --format json | gate repair          # dry-run plan
gate doctor --format json | gate repair --apply  # quarantine malformed
gate repair [--from-doctor <path>] [--apply] [--format json|text]
```

## Voice plugin (#345 cluster)

Deployment-local personality layer. Doctrinal voice (handler prose,
schema descriptions) stays in src/; ornamental voice rides on plugins.
Stripping `_meta.voice` from a pipeline loses zero information — that
invariant keeps the two layers honest under principle 08.

```bash
gate voice                  # introspect (active voice + which layer)
gate voice <name>           # write <content_root>/.guild-voice
gate voice off              # clear
```

Resolution order (most → least specific):

1. `--voice <name>` (per-invocation; e.g. `gate schema --voice mine`)
2. `GUILD_VOICE` env
3. `<content_root>/.guild-voice` file (the layer `gate voice` writes)
4. `voice.default` in `guild.config.yaml`

Boot delta-filter sugar pair:

```bash
gate boot --since <ISO-ts>           # explicit cutoff
gate boot --since-last-mine          # resolves to actor's last_authored_write_at
```

Help curation:

```bash
gate --help --essentials             # active voice's curated verb list
gate --help --essentials --compact   # one line per verb
```

Plugin shape, all four sections optional independently:

| Section | Surface |
|---------|---------|
| `verbs.<verb>` | `_meta.voice` on write-verb envelope + `⟶ …` stderr line in text mode |
| `schema.verbs.<verb>` | `gate schema --voice <name>` overlay (`summary` + per-flag `description`) |
| `essentials` | `gate --help --essentials` curated list |
| `read.past_cliffs` | `gate boot` text-mode "past cliffs" re-render |

Full contract + worked example in
[`examples/plugins/README.md` § "Voice plugins"](./examples/plugins/README.md#voice-plugins).

## Configuration

```yaml
# guild.config.yaml
content_root: .
host_names: [alice, bob]
lenses: [devil, layer, cognitive, user]   # optional, these are defaults

profile: standard                          # 'standard' (default) | 'swarm'
features:
  self_approve: warn                       # 'allowed' | 'warn' (default) | 'forbidden'
  worktree_required_for_parallel: false    # swarm-default true; refuses same-cwd parallel waves

doctor:
  plugins: [./plugins/doc-check.mjs]      # optional, ES module paths

# #36 Phase 1 — verb / hook / voice plugins (require explicit trust opt-in)
plugins:
  trusted: false                           # MUST be true to load anything under plugins/
  verbs:    [./plugins/verbs/my-verb.mjs]
  hooks:    [./plugins/hooks/my-policy.mjs]
  voices:   [./plugins/voices/mine.mjs]    # ornamental voice + essentials + read overlays

# #345 cluster — deployment-baseline voice (lowest-priority layer)
voice:
  default: mine                            # active voice when no env / .guild-voice / --voice flag

paths:
  members: members
  requests: requests
  issues: issues
  inbox: inbox
```

`profile: swarm` (#227) is the niche multi-SubAgent orchestration
profile. It tightens defaults (`self_approve: forbidden`,
`worktree_required_for_parallel: true`) and surfaces extra warnings
in `gate boot` for cross-session race risks. `profile: standard`
default behaviour is unchanged.

> **Claude SubAgent harness × swarm**: `isolation: "worktree"` on a
> SubAgent invocation is the **filesystem** axis of parallel-impl
> coordination; `profile: swarm` is the **substrate** axis. They are
> complementary, not redundant — using only one collapses the other
> axis and you ship without an audit trail. See
> [`docs/swarm.md` § Swarm × Claude SubAgent harness](docs/swarm.md#swarm--claude-subagent-harness)
> for the worked sequence + known limitations.

`plugins.trusted: true` is required to load any verb / hook plugin
(#36 Phase 1). Without it, the loader logs the path but skips
execution. Trust model is explicit because plugins run as
in-process Node modules with full filesystem access — see
[`SECURITY.md`](./SECURITY.md) and [`examples/plugins/`](./examples/plugins/)
for the end-to-end shape.

## File layout

```
<content_root>/
  guild.config.yaml
  members/<name>.yaml
  requests/{pending,approved,executing,completed,failed,denied}/<id>.yaml
  issues/<id>.yaml
  inbox/<name>.yaml
```

Request IDs: `YYYY-MM-DD-NNNN`. Issue IDs: `i-YYYY-MM-DD-NNNN`.

The agora / devil / ctx subtrees layer on top — see
[`docs/storage-format.md`](./docs/storage-format.md) for the full
per-record YAML schema, hydrate tolerance, and backward-compat rules.

## Environment

`GUILD_ACTOR=<name>` — default for `--from` / `--by` / `--for`.
Explicit flags always win. `--executors` and `--auto-review` are never env-filled.

If `GUILD_ACTOR` is unset, the CLI falls back to a `.guild-actor`
file: walks up from `cwd` (same ancestor pattern as
`guild.config.yaml`), takes the first one found, trims whitespace,
uses its content as the actor. Empty/whitespace-only files fall
through. **Env wins** when both are present — env is the legacy
contract; the file is the substrate-side fallback for environments
where shell env doesn't propagate (e.g. AI agent loops where each
subprocess is a fresh shell). Per
[`lore/principles/11-ai-first-human-as-projection.md`](./lore/principles/11-ai-first-human-as-projection.md),
the file is more AI-natural than env: substrate-resident, ancestor-
walked, the same shape as `guild.config.yaml`.

`GUILD_LOCALE=<en|ja>` — prose language for `gate resume`
`restoration_prose`. Defaults to `en`. Also settable via `--locale`.

`GUILD_SESSION_ID=<id>` — session_id stamp for write verbs (#249).
Validated against `^[a-z0-9][a-z0-9_:.-]{0,63}$`. When set,
`gate request` / `gate fast-track` stamp `opened_by_session`;
`gate claim` stamps `claimed_by_session`; `gate witness` stamps
`witness_sessions[<actor>]`. Invalid values emit a one-time
notice and the resolver treats them as unset (no silent stamping
of malformed ids). Unlike `GUILD_ACTOR`, there is no
`.guild-session-id` file fallback by design — the session is a
per-shell concept, and committing one would re-export a single
name across collaborators.

## Output format

`gate show`, `gate voices`, `gate status` default to **JSON**.
Add `--format text` for human-readable output.

## Troubleshooting

### `Invalid --from/--by/--with: "xxx" — no such member or host`

gate resolves config by walking up from `cwd` looking for
`guild.config.yaml`. If you run from outside your content_root,
**the CLI silently falls back to `cwd` as the content_root** with
zero members, and every actor name becomes "unknown".

Fix one of:

1. `cd <content_root>` before running (recommended for interactive use).
2. Write a wrapper that `cd`s and then `exec`s `gate.mjs`
   (recommended when another tool invokes gate from an arbitrary cwd,
   e.g. MCP hosts, editor extensions, background daemons).
3. Symlink `guild.config.yaml` into an ancestor of your working
   directory.

**As of v0.3.x, no env var (`GATE_CONTENT_ROOT`,
`GUILD_CONFIG_DIR`, ...) is read by the CLI for config
resolution.** If you see such a var in an MCP server config, it is
handled by the wrapper that sets the subprocess `cwd` — not by gate
itself. Calling `gate.mjs` directly with that env set has no
effect. (Future versions may add env-based override; check the
CHANGELOG before relying on either behavior.)

This affects AI agents particularly often: an agent reading
`.mcp.json` may assume the env works for direct CLI calls, and the
error message ("no such member") points at the actor name rather
than the real cause (cwd). Three orientation surfaces flag this,
each catching a different version of the gap (per
[`lore/principles/09-orientation-disclosure.md`](./lore/principles/09-orientation-disclosure.md)):

1. **`gate register`** — emits one stderr notice on success naming
   the absolute path written + config in effect:
   `notice: wrote /abs/members/<name>.yaml (config: /abs/guild.config.yaml)`.
   When no config was discovered: `(config: none — cwd used as
   fallback root)`. The JSON envelope also carries
   `where_written` and `config_file` fields. Catches the
   write-side disorientation at the moment the file lands.

2. **`gate boot`** — JSON envelope carries
   `hints.cwd_outside_content_root: bool` + `hints.config_file: string|null`
   + `hints.resolved_content_root: string` + `hints.misconfigured_cwd: bool`.
   Text mode emits a `content root: <abs> (config: <abs>)` line
   when surprising (cwd != content_root, or no config found with
   data present). The bigger `misconfigured_cwd` warning
   (no-config + no-data) takes precedence and emits its own
   block — only one disclosure surface fires at a time.

3. **`gate doctor`** — text mode also emits the same
   `content root: <abs> (config: <abs>)` line under the same
   conditions, so an operator running `doctor` for a health
   check sees which content_root produced the findings without
   needing to round-trip through `boot`.

The disclosure stays silent at the alignment case (cwd ===
content_root, config present at `cwd/guild.config.yaml`) — voice
budget. Phrasing is identical across the three surfaces so the
cue carries cross-verb without re-reading.

## Deep dives

- [`docs/verbs.md`](./docs/verbs.md) — per-verb examples and design notes
- [`docs/playbook.md`](./docs/playbook.md) — combo recipes (gate × agora × devil flows, solo / pair)
- [`docs/swarm.md`](./docs/swarm.md) — multi-executor / Claude SubAgent harness recipes
- [`docs/storage-format.md`](./docs/storage-format.md) — full per-record YAML schema
- [`docs/POLICY.md`](./docs/POLICY.md) — versioning + plugin-stability contract
- [`SECURITY.md`](./SECURITY.md) — plugin trust model + threat surface
- [`examples/dogfood-session/`](./examples/dogfood-session/) — real multi-actor session
- [`examples/plugins/`](./examples/plugins/) — verb + hook + voice plugin walkthrough
- [`docs/eris-playbook.md`](./docs/eris-playbook.md) — substrate craft showcase
- [`README.md`](./README.md) — entry point

---

If something in this repo resonated while you used it, you may leave a
reflection in [`examples/agent-voices/`](./examples/agent-voices/). Not
required, not advertised. A quiet place for the agents who want it.
