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
> - `gate status` でセッション開始時の全体把握 — pending / approved /
>   executing の件数、open issues、未読 inbox、最終活動を JSON で一発
>   取得（`--format text` で人間向け表示）
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

The full command surface is in [Two CLIs](#two-clis) below and in
[`docs/verbs.md`](./docs/verbs.md). In one pass, the verbs cluster
into five jobs:

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
  `correctness`, etc. as needed). Track defects surfaced by a
  review as issues (`gate issues add`) or promote them to new
  requests (`gate issues promote`).
- **Read the record across sessions** — `gate boot` for a single-
  call orientation (identity + status + tail + unread inbox),
  `gate resume` to reconstruct what the last session was doing,
  `gate whoami` / `tail` / `voices` / `chain` / `show` for
  narrower reads. `gate status` returns the global queue counts;
  `gate pending` / `list --for you` slice it to your plate.
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
gate show <id> [--format json|text]                  (default: json)
gate voices <name> [--lense <l>] [--verdict <v>] [--limit <N>]
                   [--format json|text]              (default: json)
gate tail [N]                                        (default 20)
gate status [--for <m>] [--format json|text]         (default: json)
gate whoami                                          (needs GUILD_ACTOR)
gate boot   [--format json|text] [--tail <N>] [--utterances <N>]
gate resume [--format json|text]                     (needs GUILD_ACTOR)
gate schema [--verb <name>] [--format json|text]
gate chain <id>                                      (request or issue)
gate approve <id>  --by <m> [--note <s>]
gate deny    <id>  --by <m> [--note <s> | --reason <s> | <reason>]
gate execute <id>  --by <m> [--note <s>]
gate complete <id> --by <m> [--note <s>]
gate fail    <id>  --by <m> [--note <s> | --reason <s> | <reason>]
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

gate doctor [--summary | --format json]              (read-only health check)
gate repair [--apply] [--from-doctor <path>]         (quarantine malformed records)
```

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
