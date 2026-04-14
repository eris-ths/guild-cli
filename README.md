# guild-cli

A small, secure, DDD-structured CLI for managing a team of agents: who
they are, what they're asked to do, how work moves through review, and
what issues fall out.

Built around a **Two-Persona Devil Review** loop: the person who writes
is not the person who reviews, and reviews are recorded, enumerated,
and visible to all participants.

> Status: **0.1.0 — alpha.** API may change. See `SECURITY.md` for the
> threat model.

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

**`gate`** — request lifecycle, review, issues (the what).

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
```

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
