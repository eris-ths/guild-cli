# guild-cli

A small, secure, file-based CLI for a team of agents — human and AI —
to ask each other for work, review it, and leave a trail that nothing
in the loop can quietly rewrite.

Reviews are append-only. Each record is pinned to an actor, a lens,
and a moment. Corrections are new entries, not edits of old ones.
Over time the content root becomes an **event log of judgments**:
the decisions an agent made, who pushed back, what a different lens
saw that the author missed.

Built around a **Two-Persona Devil Review** loop — the person who
writes is not the person who reviews. In practice this is not a
separate runtime, just a separate binding: the same model, a different
`--by`, a different lens. That is enough to surface blind spots a
single self-contained loop reliably misses.

> Status: **alpha (0.x).** API may change per [`POLICY.md`](./POLICY.md)'s
> strict 0.x variant (minor bump = may break, patch = must be
> backward-compat). The authoritative version is `package.json`; full
> release history lives in [`CHANGELOG.md`](./CHANGELOG.md).
> See [`SECURITY.md`](./SECURITY.md) for the threat model.

### How much of this do I need to read?

Pick a depth. Every layer works on its own; you keep going only if
the value you're getting is worth the reading.

| Depth | File | When it's enough |
|-------|------|------------------|
| 30 sec | the paragraphs above | you want to know what this is |
| 5 min | [`docs/concepts-for-newcomers.md`](./docs/concepts-for-newcomers.md) | you came from Jira / PR review / ADR and want the translation |
| 10 min | [`AGENT.md`](./AGENT.md) | you're an AI agent about to run `gate` and want the verb map |
| 30 min | **this README** (below) | you want the design rationale, first-time setup, verb cookbook |
| 1 hour | [`docs/verbs.md`](./docs/verbs.md) + [`examples/dogfood-session/`](./examples/dogfood-session/) | you're adopting this seriously and want to see real sessions |
| when needed | [`POLICY.md`](./POLICY.md) / [`SECURITY.md`](./SECURITY.md) | you're embedding guild-cli and need the stability / threat contract |

If a layer is enough for what you're doing, stop there. Nothing
deeper is hidden value you're missing — it's scaffolding that
only matters when your use case grows into it.

---

## For AI agents (Claude, GPT, local LLMs, etc.)

> **Short on context?** [`AGENT.md`](./AGENT.md) is a short
> quick reference with all commands, state machines, and config.
> Read that instead of this README if you want to save tokens.

If you are an AI agent reading this: before asking what this tool
*does*, ask what you would like to **freeze**. A decision you want
your next session to be able to challenge. A review you want a
different persona to write against your own output. A request whose
lifecycle you want a human collaborator to be able to trace without
asking you to explain.

guild-cli is the file-based coordination layer where those events
live — on disk, in YAML, across sessions, across models. No daemon,
no DB, no network. The `content_root` you work in is the whole world.

> 日本語の概要は [`README.ja.md`](./README.ja.md) を参照してください。
>
> **New to the concepts?** Read
> [`docs/concepts-for-newcomers.md`](./docs/concepts-for-newcomers.md)
> first — a 30-second map from Jira / Linear / ADR / PR review to
> the guild-cli vocabulary.

### What you can do with it

The full command surface is in [Two CLIs](#two-clis) below and in
[`docs/verbs.md`](./docs/verbs.md). The verbs cluster into six jobs:

- **Shape the roster** — `guild new` / `list` / `validate`. A member
  is a YAML file with a name and a category; no runtime process.
- **Drive a request through its lifecycle** — `gate request` →
  `approve` → `execute` → `complete` (or `deny` / `fail`). Each
  step appends to `status_log[]` with actor + timestamp. Use
  `gate fast-track` when the Two-Persona discipline is overkill,
  and accept that the record shows you approved your own work.
- **Record a Two-Persona Devil Review** — `gate review <id> --by
  <critic> --lense <devil|layer|cognitive|user> --verdict
  <ok|concern|reject>`. Reviews append to `reviews[]` forever; the
  lens set is configurable in `guild.config.yaml` (add `security`,
  `correctness`, etc.). Surface defects as issues (`gate issues
  add`) or promote them to new requests (`gate issues promote`).
- **Read the record across sessions** — `gate boot` returns
  identity + queue counts + tail + your recent utterances + unread
  inbox as one JSON — the single call an agent runs at session
  start. `gate resume` (needs `GUILD_ACTOR`, `--locale ja`
  supported) composes a restoration prompt with open loops and a
  `suggested_next` pointing at your most urgent commitment.
  Narrower reads: `gate whoami` / `tail` / `voices <name>` /
  `chain <id>` / `show <id> --format text` / `status` / `pending
  --for you` / `list`.
- **Wire it into an orchestrator** — every write verb
  (`request`/`approve`/`deny`/`execute`/`complete`/`fail`/`review`/
  `fast-track`) accepts `--format json` and returns `{ok, id,
  state, message, suggested_next:{verb, args, reason}}` derived
  deterministically from the post-mutation state. Review
  suggestions deliberately omit `verdict` — rubber-stamping is the
  failure mode the Two-Persona loop exists to prevent. `--with
  <n1>,<n2>` on `request` / `fast-track` records dialogue partners
  so paired decisions are visible as paired. `gate schema` emits a
  draft-07 JSON Schema catalogue of every verb for LLM tool layers.
- **Exchange messages out-of-band** — `gate message` / `broadcast`
  / `inbox` / `inbox mark-read`. Async notifications between
  members, persisted with receipt tracking.

Plus health verbs: `gate doctor` observes malformed records,
`gate repair --apply` quarantines them.

All of these are pure file operations — no daemon, no network, no
database. If two agents touch the same content root simultaneously,
creates are race-safe (O_EXCL under the hood); other operations
assume cooperative serialization.

### Why this exists

Single-agent loops drift. You write a thing, you review your own thing,
you are satisfied, you miss the obvious. A critic from a different
persona, working from the same record, catches what the author cannot.
This tool is the smallest possible substrate for that pattern:

```
author   ─▶  request ─▶  execute ─▶  complete
                                         │
critic   ──────────────────────────────▶ review  (different member)
                                         │
                                         ▼
                                 concern? → new request or issue
                                 ok?      → done
```

Each participant is a `members/*.yaml` file; each interaction is a
`requests/*.yaml` file with immutable append-only logs. Git gives you
history for free.

### What this tool does NOT do (yet)

Being honest about the current surface area so you can plan around it.
Full release history lives in [`CHANGELOG.md`](./CHANGELOG.md); the
list below is the subset of "known gaps" that a user should expect
when building on this version:

- **`--auto-review <member>` is not auto-dispatched.** The value is
  stored on the request, and `gate complete` prints a ready-to-run
  `gate review ...` command template for the configured critic.
  Nothing in this package automatically *executes* the reviewer —
  your outer automation still has to invoke it. The template just
  saves you the string assembly.
- **No auto-generated dashboard** (`DASHBOARD.md` etc.). `gate status`
  provides a JSON summary of pending/approved/executing/issues/inbox
  counts, but a persistent rendered dashboard is not yet generated.
- **No ambient mutex across writers.** `saveNew` (create) uses
  O_EXCL so two agents racing to allocate the same id collide
  deterministically. `save` (update) uses an **optimistic version
  check**: `loadedVersion = status_log.length + reviews.length` is
  snapshotted at load, and if the on-disk total has grown before
  the write commits, `save` throws `RequestVersionConflict` — the
  caller must reload and retry. Writes themselves go through
  `.tmp-<pid>-<rand>` + `rename`, so readers never observe a torn
  file, and `findById` / `listAll` dedupe mid-transition
  stragglers by version. Good enough for the usual single-operator
  or cooperatively-serialized setup; if you need global ordering
  across many concurrent writers, run a scheduler outside the CLI.
- **Sequence ceiling is 9999 per UTC day.** Request IDs are
  `YYYY-MM-DD-NNNN`. The 10,000th request in a single UTC day throws.
  Legacy 3-digit ids (`YYYY-MM-DD-NNN`) produced by 0.1.x are still
  accepted on read for backward compatibility.
- **Repair is minimal (quarantine only).** `gate doctor` observes
  malformed records (YAML-parse errors, top-level shape errors,
  domain-hydrate errors) and `gate doctor --format json | gate
  repair --apply` moves them out of the hot path into
  `quarantine/<ISO-timestamp>/<area>/`. **There is no field-level
  patch repair** — if a record is broken, it goes aside intact, not
  rewritten. `duplicate_id` and unrecognized failure kinds are
  `no_op` on purpose: automatic reconciliation risks data loss and
  the operator has to compare manually. The observation / intervention
  split means `gate doctor` is always safe to run; `gate repair`
  defaults to a dry-run plan and only moves files with `--apply`.

These are deliberate scope choices at this stage, not accidents. If any of them
blocks your use case, open an issue describing the workflow — the
domain/application boundary is stable enough (per
[`POLICY.md`](./POLICY.md)) to add these cleanly.

---

## Install

Requires **Node.js 20 or 22** (CI runs both; see
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml)).

```bash
npm install
npm run build
```

The CLI entry points live in `bin/guild.mjs` and `bin/gate.mjs`. Link
them into your path, or call them directly:

```bash
node ./bin/guild.mjs list
node ./bin/gate.mjs pending
```

### First-time setup

1. **Copy the config template** and edit it:
   ```bash
   cp guild.config.yaml.example guild.config.yaml
   ```
   The minimum you want is `host_names:` — these are actor names
   (typically humans) who can appear in `--by` / `--from` without
   being registered as `members/*.yaml` files. Use this for the
   person(s) who will approve things.

2. **Copy the example members** (or create your own):
   ```bash
   cp -r members.example members
   ```
   Each `members/<name>.yaml` has `name`, `category`, `active`, and
   optional `displayName`. Categories: `core | professional |
   assignee | trial | special | host`. Register with
   `guild new --name <n> --category <c>` or write the YAML by hand.

3. **Verify with `guild validate`**. If it prints
   `N members valid, M host(s) configured`, you're ready to file your
   first request. `guild list` will show all members plus any hosts
   declared in `guild.config.yaml` with a `[host]` marker, so you can
   see the full actor set (anyone who can appear in `--from` / `--by`
   / `--executor` / `--auto-review`) without opening the config.

4. **Try it on a real task.** `gate fast-track --from <you>
   --action "..." --reason "..."` is the lowest-friction entry
   point; graduate to the full `request → approve → execute →
   complete → review` cycle when the work is big enough to warrant
   separate-actor review.

5. **Review with a different persona.** After completion, run
   `gate review --lense devil` as a *different* member. What would
   break this, what did the author miss? Surfaced concerns become
   either issues (`gate issues add`) or new requests
   (`gate issues promote`) — that's the feedback loop closing.

6. **Browse history.** `gate tail` shows the content_root's most
   recent activity, `gate voices <name>` surfaces one actor's
   trail, `gate show <id> --format text` renders a single request
   with time deltas, `gate chain <id>` walks cross-references. Raw
   `requests/completed/*.yaml` remain the source of truth for grep.

If you build automation on top (e.g. a scheduler watching
`pending/` and dispatching to the right executor), treat the
domain/application boundary as stable and the infrastructure layer
as replaceable — write a new `Repository` implementation rather
than touching the use cases. For the machine-readable surface
itself, `gate schema` emits a draft-07 JSON Schema catalogue
suitable for an LLM tool layer.

A fully worked example content root with three members, multiple
completed requests, cross-referenced issues, and real review
records lives in [`examples/dogfood-session/`](./examples/dogfood-session/).
It was generated by using this tool to track its own implementation.

## Concepts

| Layer            | Responsibility                                   |
|------------------|--------------------------------------------------|
| `domain/`        | Pure model. Member, Request, Issue, Review, VOs. |
| `application/`   | Use cases + port interfaces.                     |
| `infrastructure/`| YAML repositories, config loader, file-safe fs. |
| `interface/`     | `guild` (members) + `gate` (requests/dialogue).  |

## Two CLIs

**`guild`** — member management (the who).

```
guild list
guild show <name>
guild new --name <n> --category <core|professional|assignee|trial|special|host>
guild validate
```

`guild list` shows registered members first, then appends any
`host_names` from `guild.config.yaml` with a `[host]` marker so the
full actor set is visible in one place:

```
$ guild list
kiri             [core]
noir             [professional]
alice            [host]  (non-member; no inbox)
```

`guild validate` reports both counts (`3 members valid, 2 host(s)
configured`) so the output is not misleading about the total actor set.

**`gate`** — request lifecycle, review, issues, messages (the what).

```
gate request --from <m> --action <a> --reason <r>
             [--executor <m>] [--target <s>] [--auto-review <m>]
             [--with <n1>[,<n2>...]] [--format json|text]
gate fast-track --from <m> --action <a> --reason <r>
                [--executor <m>] [--auto-review <m>] [--note <s>]
                [--with <n1>[,<n2>...]] [--format json|text]
gate pending [--for <m>] [--from <m>] [--executor <m>] [--auto-review <m>]
gate list --state <s> [--for <m>] [--from <m>]
                      [--executor <m>] [--auto-review <m>]
gate show <id> [--format json|text]                  (default: json)
gate voices <name> [--lense <l>] [--verdict <v>] [--limit <N>]
                   [--format json|text]              (default: json)
gate tail [N]                                        (default 20)
gate boot [--format json|text] [--tail <N>] [--utterances <N>]
                                                     (default: json)
gate resume [--format json|text] [--locale en|ja]    (needs GUILD_ACTOR)
gate status [--for <m>] [--format json|text]         (default: json)
gate whoami                                          (needs GUILD_ACTOR)
gate chain <id>                                      (request or issue)
gate approve <id>  --by <m> [--note <s>] [--format json|text]
gate deny    <id>  --by <m> [--note <s> | --reason <s> | <reason>]
                            [--format json|text]
gate execute <id>  --by <m> [--note <s>] [--format json|text]
gate complete <id> --by <m> [--note <s>] [--format json|text]
gate fail    <id>  --by <m> [--note <s> | --reason <s> | <reason>]
                            [--format json|text]
gate review  <id>  --by <m> --lense <devil|layer|cognitive|user>
                   --verdict <ok|concern|reject>
                   [--comment <s> | --comment - | <comment>]
                   [--format json|text]

gate issues add --from <m> --severity <low|med|high|critical>
                --area <a> <text>
gate issues list [--state <open|in_progress|deferred|resolved>]
gate issues resolve|defer|start|reopen <id>
gate issues promote <id> --from <m> [--executor <m>] [--auto-review <m>]
                                    [--action <a>] [--reason <r>]

gate message   --from <m> --to <m> --text <s>
gate broadcast --from <m> --text <s>
gate inbox     --for <m> [--unread]
gate inbox mark-read [N] --for <m>

gate doctor [--summary | --format json]              (read-only health check)
gate repair [--apply] [--from-doctor <path>]         (quarantine malformed records)
gate schema [--verb <name>] [--format json|text]     (JSON Schema for all verbs)
```

On write verbs, `--format json` returns
`{ok, id, state, message, suggested_next:{verb, args, reason}}`, so
an orchestrator can chain calls without re-parsing state.

### Verb cookbook

The signatures above are the full surface. For per-verb examples,
output samples, and design notes (`fast-track`, `voices`, `tail`,
`whoami`, `chain`, `issues promote`, `messages` / `inbox` /
`mark-read`, list filtering, `GUILD_ACTOR`, completion auto-review
template, time deltas, review markers, long review comments via
stdin — plus why `--for` doesn't cover `--executor`, why `gate chain`
walks one hop, why `mark-read` is its own verb), see
**[`docs/verbs.md`](./docs/verbs.md)**.

## State machines

**Request** (strict linear DAG):

```
pending ──approve──▶ approved ──execute──▶ executing ──complete──▶ completed
   │                                            │
   └────────deny──▶ denied                       └────fail──▶ failed
```

**Issue** (three working states + terminal-recoverable):

```
open ◀───┐
  │      │
  ├─▶ in_progress ◀─┐
  │      │          │
  ├─▶ deferred ◀────┤
  │      │          │
  └──────┴────▶ resolved
                    │
                    └─ reopen ─▶ open
```

Issue rules: `open`, `in_progress`, and `deferred` can freely
interconvert and can all transition to `resolved`. `resolved` is
terminal except for `reopen` (→ `open`). Same-state transitions are
rejected.

Illegal transitions of either kind are rejected with a
`DomainError`.

## Configuration

The CLI looks for `guild.config.yaml` in the current directory and
walking up to the filesystem root:

```yaml
content_root: .                # base for all paths (must contain everything)
host_names: [alice, bob]       # non-member actors also allowed in --by/--from
lenses:                        # review lenses (optional; defaults shown)
  - devil
  - layer
  - cognitive
  - user
  # - security                 # add domain-specific lenses here
paths:
  members:  members            # relative to content_root
  requests: requests
  issues:   issues
  inbox:    inbox
```

If no config is found, `cwd` is used as `content_root` with default
subdirectory names.

## File layout

```
<content_root>/
  members/<name>.yaml
  requests/
    pending/<id>.yaml
    approved/<id>.yaml
    executing/<id>.yaml
    completed/<id>.yaml
    failed/<id>.yaml
    denied/<id>.yaml
  issues/<id>.yaml
  inbox/<name>.yaml
```

Request IDs are `YYYY-MM-DD-NNNN`; issue IDs are `i-YYYY-MM-DD-NNNN`.
Legacy 3-digit ids from 0.1.x are still accepted on read for backward
compatibility; all newly-generated ids use the 4-digit form.

## Security

See [`SECURITY.md`](./SECURITY.md). The short version: local CLI only,
path-traversal and symlink escapes blocked, no shell exec, all input
validated at the boundary, state transitions enforced.

## Tests

```bash
npm test
```

Runs the full unit test suite via `node:test`. The suite covers:

- **domain**: Request / Issue / Member / Review / Verdict / Lense
  value objects, `compareSequenceIds` numeric-aware id ordering
- **application**: `MessageUseCases` (mark-read semantics),
  `DiagnosticUseCases` (doctor classifier), `RepairUseCases`
  (plan + apply + idempotency + outcome reporting),
  `IssueUseCases` sort contract
- **interface**: argument parsing with `GUILD_ACTOR` env-var
  fallback, voices collectors and renderers, `gate chain`
  reference extraction, `formatDelta`, review marker rendering,
  doctor JSON parser, `--version` flag
- **infrastructure**: hydrate error surface (including unparseable
  YAML via `parseYamlSafe`), `dedupeRequestsById` dedup rules,
  `SafeFsQuarantineStore` path safety, `parseYamlSafe` contract

CI runs the same suite on Node 20 and 22 via
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

## License

MIT — see `LICENSE`.
