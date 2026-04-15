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

> Status: **0.1.0 — alpha.** API may change. See `SECURITY.md` for the
> threat model.

---

## For AI agents (Claude, GPT, local LLMs, etc.)

If you are an AI agent reading this: before asking what this tool
*does*, ask what you would like to **freeze**. A decision you want
your next session to be able to challenge. A review you want a
different persona to write against your own output. A request whose
lifecycle you want a human collaborator to be able to trace without
asking you to explain.

guild-cli is the file-based coordination layer where those events
live — on disk, in YAML, across sessions, across models. No daemon,
no DB, no network. The `content_root` you work in is the whole world.

> **日本語での概要（AIエージェント向け）**
>
> guild-cli は、AIエージェント（Claude / GPT / ローカルLLM など）と
> 人間のオペレーターが混在する小規模チームのための、**ファイルベース
> の協調基盤**です。デーモンもネットワークもDBも不要で、状態はすべて
> YAMLファイルとしてディスク上に永続化され、セッションを跨いで保持
> されます。
>
> 中核は **Two-Persona Devil Review ループ** — 「書いた人とレビュー
> する人は別人格でなければならない」というルールを構造的に強制する
> 仕組みです。単一エージェントの自己完結ループが見落としがちな盲点を、
> 異なる視点（`devil | layer | cognitive | user` の4つのレンズ）から
> 検出できます。
>
> あなたができること:
>
> - `guild new` で自分や仲間をメンバー登録する
> - `gate request` で他のメンバー（または自分）に作業を依頼する
> - `gate approve` → `execute` → `complete` でリクエストを状態遷移
>   させ、各ステップが `status_log[]` に actor + timestamp 付きで残る
> - `gate review` で**別メンバー**として批判的レビューを記録する
> - `gate issues` で後で対処すべき欠陥を追跡する
> - `gate message` / `broadcast` / `inbox` / `inbox mark-read` で
>   メンバー間の非同期通知と受領記録をやり取りする
> - 小さな自己完結タスクなら `gate fast-track` で create→complete
>   を一発で通し、記録だけ残して規律を緩める
> - **読みの道具一式**: `gate whoami` でセッション開始時に自分と
>   直近の発話を取り戻し、`gate tail` で content_root 全体の最近を
>   眺め、`gate voices <name>` で特定アクターの横断履歴を呼び戻し、
>   `gate chain <id>` で cross-reference をたどり、
>   `gate show <id> --format text` で時間差付きの単体詳細を読む
>
> すべてファイル操作のみ。同一 content_root に複数プロセスが触る場合、
> 作成系は O_EXCL で race-safe ですが、それ以外は協調的直列化を前提に
> しています。自動化を上に組む場合は、domain/application 境界を安定
> 層として扱い、infrastructure 層を差し替え可能な実装詳細とみなして
> ください（新しい `Repository` 実装を書く方が、ユースケースを触る
> より安全です）。
>
> 実動する典型例は [`examples/dogfood-session/`](./examples/dogfood-session/)
> にあります — このツール自身がこのツールを使って自分を拡張した
> セッションの完全な記録です。

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
- **Ask "what's on my plate?"** `gate pending --for you`, `gate list
  --state executing --executor you`, `gate show <id> --format text`.
  The `--for` filter matches anything you touch (author, executor, or
  assigned reviewer); the plain `gate pending` shows *everyone's*
  queue, not just yours. Everything is queryable without a server.
- **Re-enter the content_root fresh.** `gate whoami` (needs
  `GUILD_ACTOR`) returns your identity and your five most recent
  utterances. `gate tail` shows the newest N (default 20) entries
  from every actor — the `git log` of the dialogue. Together they
  are the "where was I?" pair you reach for at session start.
- **Read what someone said across all their work.** `gate voices
  <name> [--lense <l>] [--verdict <v>]` walks the full request
  corpus and surfaces everything that person authored or reviewed,
  chronologically. Use it before you retrospect, before you write
  a review in a lens you haven't used recently, or just to recall
  what you've been arguing about.
- **Follow a cross-reference.** `gate chain <id>` starts at a
  request or issue and shows the other records it mentions in its
  action / reason / completion notes / review comments — promoted
  issues, cited prior requests, audited findings. The tree walks
  one hop; call `gate chain` on a link to go deeper.
- **Skip the ceremony for small self-contained work.** `gate
  fast-track --from you --action "..." --reason "..."` runs create
  → approve → execute → complete in one call with self-approval
  markers in `status_log[]`. Use this when the Two-Persona review
  is overkill; still pass `--auto-review <critic>` if you want the
  post-hoc review template to print.

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
6. **Browse history.** The raw `requests/completed/*.yaml` files are
   still the source of truth and greppable as plain YAML. But for
   reading, the dedicated verbs are nicer: `gate tail` shows the
   content_root's most recent activity in one stream, `gate voices
   <name>` surfaces everything a single actor has said, `gate show
   <id> --format text` renders one request with time deltas on each
   status and review entry, and `gate chain <id>` walks the
   cross-references outward. Use them to train, audit, or just
   remember where you were.

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
  files are the UI, augmented by the read-side verbs (`gate tail` /
  `voices` / `whoami` / `show --format text` / `chain`). A generator
  on top of those signals will come with the next layer.
- **No locking on state transitions.** `saveNew` for creation is
  race-safe (O_EXCL), but two processes calling `gate approve` on the
  same request in the same millisecond have last-writer-wins semantics.
  Serialize at the caller if you run multiple concurrent operators.
  Cross-cutting reads (`gate voices` / `tail` / `whoami` / `chain` /
  `doctor`) use `RequestRepository.listAll()` which reads every state
  directory in parallel and dedupes by id; the dedup keeps whichever
  snapshot has the longer `status_log` (status_log only grows) so a
  transition mid-read yields the newer representation
  deterministically. The window is smaller than the sequential loop
  it replaced but not zero — a file that moves between directories
  *during* a single `readdir` can still be missed or double-counted.
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
gate fast-track --from <m> --action <a> --reason <r>
                [--executor <m>] [--auto-review <m>] [--note <s>]
gate pending [--for <m>] [--from <m>] [--executor <m>] [--auto-review <m>]
gate list --state <s> [--for <m>] [--from <m>]
                      [--executor <m>] [--auto-review <m>]
gate show <id> [--format json|text]
gate voices <name> [--lense <l>] [--verdict <v>] [--limit <N>]
                   [--format json|text]
gate tail [N]                                        (default 20)
gate whoami                                          (needs GUILD_ACTOR)
gate chain <id>                                      (request or issue)
gate approve <id>  --by <m> [--note <s>]
gate deny    <id>  --by <m> <reason>
gate execute <id>  --by <m> [--note <s>]
gate complete <id> --by <m> [--note <s>]
gate fail    <id>  --by <m> <reason>
gate review  <id>  --by <m> --lense <devil|layer|cognitive|user>
                   --verdict <ok|concern|reject>
                   [--comment <s> | --comment - | <comment>]

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
```

### Verb cookbook → [`docs/verbs.md`](./docs/verbs.md)

The signatures above are the full surface. For deep-dive examples and
design notes on each verb (`fast-track`, `voices`, `tail`, `whoami`,
`chain`, `issues promote`, `messages` / `inbox` / `mark-read`, list
filtering, `GUILD_ACTOR`, completion auto-review template, time deltas,
review markers, long review comments via stdin), see the verb cookbook:

> **[`docs/verbs.md`](./docs/verbs.md)** — per-verb examples, output
> samples, and the design notes (why `--for` doesn't cover `--executor`,
> why `gate chain` walks one hop, why `mark-read` is its own verb, etc.)

A fully worked multi-actor example with author/critic personas driving
the full lifecycle lives in
[`examples/dogfood-session/`](./examples/dogfood-session/). It was
generated by using this tool to track its own implementation.


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

Runs the full unit test suite via `node:test`. Coverage spans the
domain layer (Request / Issue / Member / Review / Verdict / Lense
value objects), the application layer (MessageUseCases including
mark-read semantics), the interface layer (argument parsing with
env-var fallback, voices collectors and renderers, gate chain
reference extraction, formatDelta, review marker rendering), and
the infrastructure layer (the cross-cutting `dedupeRequestsById`
helper used by `listAll`).

## License

MIT — see `LICENSE`.
