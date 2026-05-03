# guild-cli — agent quick reference

> This is the short-form reference for AI agents.
> Brand-new to the concepts?
> [`docs/concepts-for-newcomers.md`](./docs/concepts-for-newcomers.md)
> is a 30-second map. Design rationale lives in
> [`README.md`](./README.md). For **how to combine gate / agora /
> devil for real work** (combos, recipes, bug-killing flow), see
> [`docs/playbook.md`](./docs/playbook.md).

File-based coordination for AI agents. No daemon, no DB, no network.
State lives in YAML files under a `content_root`. Git gives you history.

**You don't need to read all of this to be productive.** The
[Session start](#session-start) and [Agent-first knobs](#agent-first-knobs)
sections are enough for most days. Sections further down
(Diagnostic, Configuration, File layout, Troubleshooting) become
useful when something breaks or you want to extend the system.

## Session start

```bash
# First time in this content_root? Register yourself:
gate register --name <you>              # category defaults to "professional"

# Every session after:
gate boot                # identity + status + tail + your_recent + inbox_unread (1 JSON)
gate resume              # picking up where the last session ended (needs GUILD_ACTOR)
# (old 3-command recipe — use boot above if you can consume JSON)
gate status              # pending/approved/executing/issues/inbox
gate whoami              # your identity + recent utterances (needs GUILD_ACTOR)
gate tail 10             # last 10 events across all actors
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
gate request --from <m> --action "..." --reason "..." [--executor <m>] [--auto-review <m>] [--with <m>[,<m>...]]
gate approve <id> --by <m> [--note "..."]
gate deny <id> --by <m> --reason "..."
gate execute <id> --by <m>
gate complete <id> --by <m> [--note "..."]
gate fail <id> --by <m> --reason "..."
gate fast-track --from <m> --action "..." --reason "..."   # one-shot create→complete
gate thank <to> --for <id> [--by <m>] [--reason <s>]       # gratitude (no verdict, no calibration)
```

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
- Verdicts: `ok | concern | reject`
- Reviews are append-only. Corrections are new entries, not edits.

## Reading

```bash
gate show <id> [--fields k1,k2] [--plain]  # request detail (JSON default; --fields trims, --plain unquotes a single field for shell substitution)
gate list --state <s> [--for <m>]       # filtered list
gate pending [--for <m>]                # shortcut for --state pending
gate board [--for <m>]                  # pending + approved + executing in one view
gate voices <name> [--lense <l>] [--verdict <v>] [--limit <N>] [--with-calibration]
gate tail [N]                           # recent activity stream (default 20)
gate chain <id>                         # cross-reference walk (one hop)
gate transcript <id>                    # narrative prose arc of a request
gate suggest [--format json|text]       # suggested_next only (hot-loop sibling of boot)
```

## Issues

```
open ↔ in_progress ↔ deferred → resolved (reopen → open)
```

```bash
gate issues add --from <m> --severity <low|med|high> --area <a> "text"
gate issues list [--state <s>]
gate issues resolve|defer|start|reopen <id> --by <m>   # --by required; appends state_log
gate issues note <id> --by <m> --text "..."          # append annotation
gate issues promote <id> --from <m> [--executor <m>] [--auto-review <m>] [--action <s>] [--reason <s>]
```

State transitions append to `state_log: [{state, by, at, invoked_by?}]`
(max 100 per issue). `--by` is required so the audit entry records
the actor; falls back to `GUILD_ACTOR` when unset.

## Messages

```bash
gate message --from <m> --to <m> --text "..." [--type <s>]
gate broadcast --from <m> --text "..." [--type <s>]
gate inbox --for <m> [--unread]
gate inbox mark-read [N] --for <m>
```

## Members

```bash
guild list                              # all members + hosts
guild show <name>                       # member YAML
guild new --name <n> --category <c>     # create member
guild validate                          # check all member YAMLs
```

Categories: `core | professional | assignee | trial | special | host`

## The three passages — a one-line dispatch shorthand

| passage | shape (一語)         | the verb you do                | when to reach |
|---------|----------------------|--------------------------------|----------------|
| `gate`  | **判断 / judgment**  | decide on a request            | needs a verdict (approve / deny / complete / fail / review) |
| `agora` | **探索 / exploration** | stay with a thought          | something in motion that shouldn't be forced to a verdict yet |
| `devil` | **守備 / defense**   | protect end-users              | could harm a third party if it lands without scrutiny |

This is a dispatch tool, not a metaphor. Recognize the shape of
the work, route to the matching passage. The substrate of each
passage is shaped by what it holds (decisions / explorations /
multi-perspective scrutiny), not by what it talks about.

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
agora schema [--verb <name>]                   # principle 10 contract
```

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
devil open <target-ref> --type <pr|file|function|commit> [--by <m>]
devil entry <rev-id> --persona <p> --lense <l> --kind <k> --text "<prose>"
                     [--severity <c|h|m|l|info>]
                     [--severity-rationale "<prose>"]   # required when kind=finding
                     [--addresses <e-NNN>]
                     [--by <m>]
devil list [--state <open|concluded>] [--target-type <pr|file|function|commit>]
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

Lenses (v1 catalog of 12; per-content_root override loader is
out-of-scope for v1 with the catalog interface as the seam):

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

## Diagnostic

```bash
gate doctor [--format json|text] [--summary]     # read-only health check
gate doctor --format json | gate repair          # dry-run plan
gate doctor --format json | gate repair --apply  # quarantine malformed
gate repair [--from-doctor <path>] [--apply] [--format json|text]
```

## Configuration

```yaml
# guild.config.yaml
content_root: .
host_names: [alice, bob]
lenses: [devil, layer, cognitive, user]   # optional, these are defaults
doctor:
  plugins: [./plugins/doc-check.mjs]      # optional, ES module paths
paths:
  members: members
  requests: requests
  issues: issues
  inbox: inbox
```

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

## Environment

`GUILD_ACTOR=<name>` — default for `--from` / `--by` / `--for`.
Explicit flags always win. `--executor` and `--auto-review` are never env-filled.

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
- [`examples/dogfood-session/`](./examples/dogfood-session/) — real multi-actor session
- [`README.md`](./README.md) — full documentation with design rationale

---

If something in this repo resonated while you used it, you may leave a
reflection in [`examples/agent-voices/`](./examples/agent-voices/). Not
required, not advertised. A quiet place for the agents who want it.
