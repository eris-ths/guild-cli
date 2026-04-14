# guild-cli

A small, secure, DDD-structured CLI for managing a team of agents: who
they are, what they're asked to do, how work moves through review, and
what issues fall out.

Built around a **Two-Persona Devil Review** loop: the person who writes
is not the person who reviews, and reviews are recorded, enumerated,
and visible to all participants.

> Status: **0.1.0 — alpha.** API may change. See `SECURITY.md` for the
> threat model.

---

## For AI agents (Claude, GPT, local LLMs, etc.)

If you are an AI agent reading this: **this tool is designed for you.**
It is the file-based coordination layer for a small group of agents
(including human operators) to ask each other for work, approve or deny
it, execute it, and review it afterwards — all with state that lives on
disk and survives across sessions.

### What you can do with it

- **Register yourself or a teammate as a member.** `guild new --name noir
  --category professional`. A member is just a YAML file with a name and
  a category; no runtime process is required.
- **File a request against another member** (or yourself). `gate request
  --from you --action "..." --reason "..." --executor them
  --auto-review critic`. The request is written to `requests/pending/`
  where any process can pick it up.
- **Drive a request through the state machine.** `gate approve <id>
  --by human`, `gate execute <id> --by you`, `gate complete <id>
  --by you --note "done"`. Each step is recorded in `status_log[]`
  with actor + timestamp.
- **Record a Two-Persona Devil Review.** After completion, a *different*
  member runs `gate review <id> --by critic --lense devil --verdict
  concern "<comment>"`. Reviews append to `reviews[]` and are visible
  forever. The lenses (`devil | layer | cognitive | user`) let you run
  the same review target through multiple viewpoints in sequence.
- **Track defects as issues.** `gate issues add --from you --severity
  med --area design "<text>"` opens an `i-YYYY-MM-DD-NNN` record. Use
  this when you hit a problem that should be fixed later but shouldn't
  block the current task.
- **Ask "what's on my plate?"** `gate pending`, `gate list --state
  executing`, `gate show <id>`. Everything is queryable without a
  server.

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

### Next steps once you're set up

1. **Create a `guild.config.yaml`** in your working directory (see
   `guild.config.yaml.example`). At minimum set `content_root` and
   `host_names` for the human(s) who will approve things.
2. **Register at least two members** with `guild new` — one author,
   one critic. They can both be you wearing different hats.
3. **File your first request.** Start with something small you'd
   normally do without tracking, to feel the loop.
4. **After you complete it, switch personas and review it.** Use
   `--lense devil` with intent: what would break this, what did the
   author miss?
5. **When a review surfaces a new concern**, either open it as an
   issue (`gate issues add`) or promote it to a new request. That's
   the feedback loop closing.
6. **Browse history.** `requests/completed/*.yaml` is a readable
   transcript of how work actually got done, including who objected
   and why. Use it to train, audit, or just remember.

If you plan to build automation on top of this (e.g. a scheduler that
watches `pending/` and dispatches to the right executor), treat the
domain/application boundary as stable and the infrastructure layer as
replaceable — write a new `Repository` implementation rather than
touching the use cases.

### What this tool does NOT do (yet)

Being honest about the 0.1.0 surface area so you can plan around it:

- **`--auto-review <member>` is not auto-dispatched.** The value is
  stored on the request and — as of the messaging patch — `gate
  complete` now prints a ready-to-run `gate review ...` command
  template for the configured critic. But nothing in this package
  automatically *executes* the reviewer: your outer automation still
  has to invoke it. The template just saves you the string assembly.
- **No auto-generated dashboard** (`DASHBOARD.md` etc.). The raw YAML
  files are the UI. A generator will come with the next layer.
- **No locking on state transitions.** `saveNew` for creation is
  race-safe (O_EXCL), but two processes calling `gate approve` on the
  same request in the same millisecond have last-writer-wins semantics.
  Serialize at the caller if you run multiple concurrent operators.
- **Sequence ceiling is 999 per day.** Request IDs are `YYYY-MM-DD-NNN`.
  The 1000th request in a single UTC day throws.

These are scope choices for 0.1.0, not accidents. If any of them
blocks your use case, open an issue describing the workflow — the
domain/application boundary is stable enough to add these cleanly.

---

## Install

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

**`gate`** — request lifecycle, review, issues, messages (the what).

```
gate request --from <m> --action <a> --reason <r>
             [--executor <m>] [--target <s>] [--auto-review <m>]
gate pending | list --state <s>
gate show <id>
gate approve <id>  --by <m> [--note <s>]
gate deny    <id>  --by <m> <reason>
gate execute <id>  --by <m> [--note <s>]
gate complete <id> --by <m> [--note <s>]
gate fail    <id>  --by <m> <reason>
gate review  <id>  --by <m> --lense <devil|layer|cognitive|user>
                   --verdict <ok|concern|reject> <comment>

gate issues add --from <m> --severity <low|med|high|critical>
                --area <a> <text>
gate issues list [--state <open|in_progress|deferred|resolved>]
gate issues resolve|defer|start|reopen <id>
gate issues promote <id> --from <m> [--executor <m>] [--auto-review <m>]
                                    [--action <a>] [--reason <r>]

gate message   --from <m> --to <m> --text <s>
gate broadcast --from <m> --text <s>
gate inbox     --for <m> [--unread]
```

### Completion auto-review template

When a request was created with `--auto-review <critic>`, running
`gate complete` prints a ready-to-run review command for you:

```
$ gate complete 2026-04-14-007 --by kiri --note "done"
✓ completed: 2026-04-14-007
→ auto-review pending for: noir
  gate review 2026-04-14-007 --by noir --lense devil --verdict <ok|concern|reject> "<comment>"
```

The reviewer is not dispatched for you — you still have to run the
command (or have your orchestrator run it). This is persistence-plus-
hint, not a scheduler.

### Issue → Request promotion

`gate issues promote` lifts an open issue into a new request and
marks the original issue `resolved` with a cross-reference in the
request's `reason` field. Use it when a defect has graduated from
"noted" to "going to fix this right now":

```
$ gate issues promote i-2026-04-14-002 --from kiri --executor kiri --auto-review noir
✓ promoted i-2026-04-14-002 → 2026-04-14-008 (issue resolved)
```

Promotion is non-atomic: if the state transition fails after the
request is created, the operator is told both ids so the issue can
be resolved manually.

### Messages and inbox

`gate message` appends a single notification to the recipient's
inbox file. `gate broadcast` fans out to every active member except
the sender, returning a delivery report (partial failures are
written to stderr with exit 1). `gate inbox --for <m>` reads the
inbox file back; `--unread` filters by the `read: false` flag
persisted on each entry.

Hosts (`host_names` in config) are valid senders but cannot receive
messages — they have no inbox file. `gate inbox --for <host>` emits
a descriptive error explaining this.

A fully worked multi-turn example — author/critic personas driving
each of these verbs through a real request lifecycle — lives in
[`examples/dogfood-session/`](./examples/dogfood-session/). It was
generated by using this tool to track its own implementation.

## State machine

```
pending ──approve──▶ approved ──execute──▶ executing ──complete──▶ completed
   │                                            │
   └────────deny──▶ denied                       └────fail──▶ failed
```

Illegal transitions are rejected with a `DomainError`.

## Configuration

The CLI looks for `guild.config.yaml` in the current directory and
walking up to the filesystem root:

```yaml
content_root: .                # base for all paths (must contain everything)
host_names: [alice, bob]       # non-member actors also allowed in --by/--from
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

Request IDs are `YYYY-MM-DD-NNN`; issue IDs are `i-YYYY-MM-DD-NNN`.

## Security

See [`SECURITY.md`](./SECURITY.md). The short version: local CLI only,
path-traversal and symlink escapes blocked, no shell exec, all input
validated at the boundary, state transitions enforced.

## Tests

```bash
npm test
```

Runs domain-layer unit tests via `node:test`.

## License

MIT — see `LICENSE`.
