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
> - `gate message` / `broadcast` / `inbox` でメンバー間の非同期通知
>   をやり取りする
> - 小さな自己完結タスクなら `gate fast-track` で create→complete
>   を一発で通し、記録だけ残して規律を緩める
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

3. **Verify with `guild validate`**. If it prints `N members valid`,
   you're ready to file your first request.

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
gate messages  --for <m> [--unread]     (alias of gate inbox)
```

### Fast-track

For self-contained work where the Two-Persona Devil Review is
overkill, `gate fast-track` collapses the four lifecycle commands
into one:

```
$ gate fast-track --from kiri --action "fix typo in README" \
                  --reason "trivial correction" --auto-review noir
✓ fast-tracked: 2026-04-14-042 (pending→completed)
→ auto-review pending for: noir
  gate review 2026-04-14-042 --by noir --lense devil --verdict <ok|concern|reject> "<comment>"
```

The record is fully preserved: `status_log[]` contains all four
entries (`pending`, `approved`, `executing`, `completed`) with
`fast-track: self-approved` / `self-executed` notes so audits can
distinguish them from full-cycle transitions. `--auto-review` still
works — it just moves the review from "blocking" to "after-the-fact."

### Filtering lists

`gate list` and `gate pending` accept filter flags that combine
via AND:

- `--from <m>` — match author
- `--executor <m>` — match executor
- `--auto-review <m>` — match assigned reviewer
- `--for <m>` — match author OR executor OR reviewer (sugar for
  "anything I touch")

```
$ gate pending --for kiri
$ gate list --state executing --executor noir
$ gate list --state completed --auto-review rin
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
written to stderr with exit 1). `gate inbox --for <m>` (or
`gate messages --for <m>`) reads the inbox file back; `--unread`
filters by the `read: false` flag persisted on each entry.

Hosts (`host_names` in config) are valid senders but cannot receive
messages — they have no inbox file. `gate inbox --for <host>` emits
a descriptive error explaining this.

### Long review comments

`gate review` takes the review comment three ways:

```
# 1. Positional (legacy)
gate review <id> --by noir --lense devil --verdict ok "short note"

# 2. --comment option (avoids positional/quoting gotchas)
gate review <id> --by noir --lense devil --verdict ok \
                 --comment "some longer note with spaces"

# 3. --comment - reads STDIN until EOF (for heredocs / editor pipes)
gate review <id> --by noir --lense devil --verdict concern \
                 --comment - <<'EOF'
This is a multi-paragraph critique that would be painful to
quote on one bash line. The STDIN form is the one you want
when piping from an editor or a larger automation step.
EOF
```

A fully worked multi-turn example — author/critic personas driving
each of these verbs through a real request lifecycle — lives in
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
