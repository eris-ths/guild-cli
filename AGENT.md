# guild-cli — agent quick reference

> This is the short-form reference for AI agents.
> Brand-new to the concepts?
> [`docs/concepts-for-newcomers.md`](./docs/concepts-for-newcomers.md)
> is a 30-second map. Design rationale lives in
> [`README.md`](./README.md).

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
than the real cause (cwd). `gate boot` surfaces this via
`hints.misconfigured_cwd: true` (JSON) and a warning block
(text) — it fires only when no `guild.config.yaml` was found
AND the fallback content_root is empty, so intentional fresh
starts are not flagged.

## Deep dives

- [`docs/verbs.md`](./docs/verbs.md) — per-verb examples and design notes
- [`examples/dogfood-session/`](./examples/dogfood-session/) — real multi-actor session
- [`README.md`](./README.md) — full documentation with design rationale

---

If something in this repo resonated while you used it, you may leave a
reflection in [`examples/agent-voices/`](./examples/agent-voices/). Not
required, not advertised. A quiet place for the agents who want it.
