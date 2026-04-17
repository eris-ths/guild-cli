# guild-cli — agent quick reference

> This is the short-form reference for AI agents.
> For design rationale and onboarding, see [`README.md`](./README.md).

File-based coordination for AI agents. No daemon, no DB, no network.
State lives in YAML files under a `content_root`. Git gives you history.

## Session start

```bash
gate boot                # identity + status + tail + your_recent + inbox_unread (1 JSON)
gate resume              # picking up where the last session ended (needs GUILD_ACTOR)
# (old 3-command recipe — use boot above if you can consume JSON)
gate status              # pending/approved/executing/issues/inbox
gate whoami              # your identity + recent utterances (needs GUILD_ACTOR)
gate tail 10             # last 10 events across all actors
```

## Agent-first knobs

- `gate boot` — single-command orientation (identity + status + tail + inbox)
- `--format json` on every write verb (`request/approve/deny/execute/complete/fail/review/fast-track`)
  returns `{ok, id, state, message, suggested_next:{verb, args, reason}}`
- `gate schema` — JSON Schema for all verbs (LLM tool-layer input)

## Request lifecycle

```
pending ─ approve ─▶ approved ─ execute ─▶ executing ─ complete ─▶ completed
   │                                            │
   └── deny ──▶ denied                          └── fail ──▶ failed
```

```bash
gate request --from <m> --action "..." --reason "..." [--executor <m>] [--auto-review <m>]
gate approve <id> --by <m> [--note "..."]
gate execute <id> --by <m>
gate complete <id> --by <m> [--note "..."]
gate fast-track --from <m> --action "..." --reason "..."   # one-shot create→complete
```

## Review (Two-Persona Devil)

```bash
gate review <id> --by <m> --lense <l> --verdict <v> --comment "..."
```

- Lenses: `devil | layer | cognitive | user` (configurable in guild.config.yaml)
- Verdicts: `ok | concern | reject`
- Reviews are append-only. Corrections are new entries, not edits.

## Reading

```bash
gate show <id>                          # request detail (JSON default)
gate list --state <s> [--for <m>]       # filtered list
gate pending [--for <m>]                # shortcut for --state pending
gate voices <name> [--lense <l>]        # actor's full history (JSON default)
gate tail [N]                           # recent activity stream (default 20)
gate chain <id>                         # cross-reference walk (one hop)
```

## Issues

```
open ↔ in_progress ↔ deferred → resolved (reopen → open)
```

```bash
gate issues add --from <m> --severity <low|med|high> --area <a> "text"
gate issues list [--state <s>]
gate issues resolve|defer|start|reopen <id>
gate issues promote <id> --from <m>     # lift issue → new request
```

## Messages

```bash
gate message --from <m> --to <m> --text "..."
gate broadcast --from <m> --text "..."
gate inbox --for <m>
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

## Diagnostic

```bash
gate doctor                             # read-only health check
gate doctor --format json | gate repair          # dry-run plan
gate doctor --format json | gate repair --apply  # quarantine malformed
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

## Output format

`gate show`, `gate voices`, `gate status` default to **JSON**.
Add `--format text` for human-readable output.

## Deep dives

- [`docs/verbs.md`](./docs/verbs.md) — per-verb examples and design notes
- [`examples/dogfood-session/`](./examples/dogfood-session/) — real multi-actor session
- [`README.md`](./README.md) — full documentation with design rationale

---

If something in this repo resonated while you used it, you may leave a
reflection in [`examples/agent-voices/`](./examples/agent-voices/). Not
required, not advertised. A quiet place for the agents who want it.
