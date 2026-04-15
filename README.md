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
  files are the UI. A generator will come with the next layer.
- **No locking on state transitions.** `saveNew` for creation is
  race-safe (O_EXCL), but two processes calling `gate approve` on the
  same request in the same millisecond have last-writer-wins semantics.
  Serialize at the caller if you run multiple concurrent operators.
  Cross-cutting reads (`gate voices` / `tail` / `whoami` / `chain`)
  use `RequestRepository.listAll()` which reads every state directory
  in parallel and dedupes by id; the dedup keeps whichever snapshot
  has the longer `status_log` (status_log only grows) so a transition
  mid-read yields the newer representation deterministically. The
  window is smaller than the sequential loop it replaced but not
  zero — a file that moves between directories *during* a single
  `readdir` can still be missed or double-counted.
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

### Interactive identity: `GUILD_ACTOR`

If `GUILD_ACTOR` is set in the environment, it is used as the default
for `--from` / `--by` / `--for` whenever those flags are omitted.
Explicit flags always win. This is the low-friction way to drive the
CLI by hand without retyping your name on every command:

```
$ export GUILD_ACTOR=kiri
$ gate request --action "fix typo" --reason "trivial"    # --from kiri implied
$ gate pending                                           # --for kiri implied
# filtered by GUILD_ACTOR=kiri (use --for <m> or unset GUILD_ACTOR to override)
$ gate complete 2026-04-14-007 --note "done"             # --by kiri implied
```

`--executor` and `--auto-review` are **not** covered: those flags
point at *other* people (who will do the work, who will critique it),
not at yourself, so env-filling them would silently mis-route
delegation. Always pass them explicitly.

For a one-off override without unexporting, pass an empty value —
empty env vars are treated as unset:

```
$ GUILD_ACTOR= gate pending         # show everyone's queue this once
$ GUILD_ACTOR=noir gate review 2026-04-14-007 --lense devil --verdict ok --comment "..."
```

`gate pending` and `gate list` emit a one-line stderr hint when the
env var is implicitly filling in `--for`, so the behavior change is
discoverable. Write-side commands currently apply the env var
silently — if you switch shells frequently, double-check `echo
$GUILD_ACTOR` before sending messages or broadcasting. (Extending
the stderr hint to writes is tracked as follow-up in the dogfood
session.)

**Design note.** Identity is intentionally *not* part of
`guild.config.yaml`: the config is shared across all operators of a
content root, but "who am I in this shell" is per-session state.
Using an environment variable (set in your shell profile, direnv, or
a wrapper script) keeps the file-based ground truth unchanged — the
env var only feeds the CLI boundary, and every write is still
recorded in YAML with the explicit actor name. Automations should
continue to pass `--from` / `--by` explicitly rather than relying on
ambient state.

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

### Voices: cross-cutting reads of what an actor has said

`gate voices <name>` walks the full request corpus — every state,
every review — and surfaces everything `<name>` authored or
reviewed, sorted chronologically. It's the "show me my own history
on this content root" command.

```
$ gate voices kiri
17 utterances from kiri

[2026-04-14T10:59:05.842Z] req=2026-04-14-001 authored
  action: Feature A: gate complete の完了時に...
  reason: README で明言されている 0.1.0 の制限...
  note:   reqComplete に auto-review テンプレ出力を追加...
...
```

Each entry is an *utterance* — either an authored request (action +
reason + whichever closure note the lifecycle produced:
`note:` / `denied:` / `failed:`) or a review (lens + verdict +
comment). Filters combine via AND:

- `--lense <devil|layer|cognitive|user>` — only reviews with that
  lens (implies review-only; authored requests carry no lens)
- `--verdict <ok|concern|reject>` — only reviews with that verdict
  (implies review-only)
- `--format json` — emit the utterance list as JSON for piping

```
$ gate voices noir --lense devil
5 reviews from noir (lense=devil)

[2026-04-14T10:59:57.309Z] req=2026-04-14-001 [devil/concern]
  re: Feature A: gate complete の完了時に...
  実装自体は小さく動く。しかし懸念が2つ: (1) complete()...
```

Name matching is case-insensitive. Timestamps are ISO-8601, so
text-mode output sorts naturally.

Use cases at the layer-1 surface: reading your own review history
before a retrospective, auditing "what did critic X flag across
all of feature Z", grepping for verdicts without yaml plumbing.

`--limit <N>` truncates the result after sorting (useful for
"what did I say most recently").

### Tail: unified recent activity stream

`gate tail [N]` merges authored requests and reviews from every
actor into a single timeline and prints the most recent N entries
(default 20), newest first. Think of it as `git log` for the
content_root's dialogue — the command you type first when you open
an existing content_root.

```
$ gate tail 5
5 most recent utterance(s)

[2026-04-15T12:04:11.223Z] req=2026-04-15-007 [user/ok] by rin
  re: README: document tail/whoami/...
  second pass: concerns folded in cleanly, approving.

[2026-04-15T12:03:27.089Z] req=2026-04-15-007 authored kiri
  action: README: document tail/whoami/...
  reason: new surface area needs to be findable...
...
```

Each line is labeled with the actor (author for `authored`
entries, reviewer for review entries) so a multi-actor stream
stays legible. Filters are intentionally omitted — tail is for
"everything recent", and once you want to slice, switch to
`gate voices` or `gate list`.

### Whoami: session-start orientation

`gate whoami` (requires `GUILD_ACTOR` in the environment) resolves
your identity, classifies you as member / host / unknown, and
prints your 5 most recent utterances so you re-enter the
content_root with your own voice already reloaded:

```
$ export GUILD_ACTOR=noir
$ gate whoami
you are noir (member)

your most recent 5 utterance(s):

[2026-04-14T23:46:38.259Z] req=2026-04-14-008 [user/ok]
  re: README: document host listing and GUILD_ACTOR env var
  second-pass review: concerns (1) and (2) addressed...
...
```

`gate whoami` is meant as a session-start ritual: one command
before you do anything else, and you remember where you were.
Pair it with `gate tail` to see what happened while you were away.

### Time deltas in `gate show --format text`

The text view of a single request now shows the delta between
successive `status_log` entries and between reviews, making the
*pace* of the dialogue legible alongside the events:

```
$ gate show 2026-04-14-014 --format text
...
  status_log (4):
    2026-04-14T14:18:11.761Z  pending    by kiri — created
    2026-04-14T14:18:38.126Z  approved   by human (+26s) — audit は価値あり
    2026-04-14T14:18:45.727Z  executing  by kiri (+7s)
    2026-04-14T14:20:53.065Z  completed  by kiri (+2m) — audit 完了...

  reviews (2):
    [devil/concern] by noir at 2026-04-14T14:21:12.613Z (+19s)
      ...
    [layer/ok] by rin at 2026-04-14T14:21:57.535Z (+44s)
      ...
```

Delta units scale with the gap: `+5s`, `+44s`, `+3m`, `+1h19m`,
`+2d4h`. Review deltas are measured from the last `status_log`
entry (typically completion) for the first review, and from the
previous review for subsequent ones — so a quick correction reads
as `(+10s)` and a day-later afterthought as `(+1d)`.

### Review markers on `gate list` / `gate pending`

Each row in `gate list` and `gate pending` carries a compact
per-lens verdict summary so you can scan a whole list of completed
work and pick out the requests that closed with an unresolved
concern:

```
$ gate list --state completed
2026-04-14-001  [completed]  from=kiri  !devil ✓layer      Feature A: ...
2026-04-14-006  [completed]  from=kiri  ✓devil             Feature E: ...
2026-04-14-014  [completed]  from=kiri  !devil ✓layer      Post-session audit: ...
```

Icons: `✓` ok · `!` concern · `x` reject · `?` unknown (defensive).
The marker column is width-aligned per list so the action column
stays flush across rows; long multi-review strings push the
baseline out rather than collide with the next column. Requests
with no reviews (typically fast-tracked) show an empty marker
column and are easy to spot by the blank.

### Chain: cross-reference walks

`gate chain <id>` starts at a request or issue and shows every
other record it mentions in its free-text fields (`action`,
`reason`, `completion_note`, `deny_reason`, `failure_reason`, and
every review comment). The output is a one-hop tree so a reader
can follow the narrative of related work without grepping YAML.

```
$ gate chain 2026-04-14-014
2026-04-14-014  [completed]  from=kiri  Post-session audit: Feature A-L の実装...
└── referenced issues
    ├── i-2026-04-14-004  [low/core]  resolved  RequestUseCasesDeps.notifier ...
    └── i-2026-04-14-008  [low/docs]  open  Feature D の rin review concern #3 ...
```

Both request ids (`YYYY-MM-DD-NNN`) and issue ids
(`i-YYYY-MM-DD-NNN`) are followed, sorted by id under two branches.
Ids that appear in text but don't resolve to a real record are
shown as `(referenced but not found)` so prose mentions of
deleted-or-future ids are surfaced rather than silently dropped.
Self-references are ignored.

**Scope is intentional.** `gate chain` walks exactly one hop. To
go deeper, call `gate chain` on one of the surfaced ids — the CLI
stays a single-step tool and the reader drives the depth. Also,
the id scanner only follows **well-formed** ids: a Japanese range
expression like `i-2026-04-14-004〜007` resolves only the first
fully-spelled id; if you want all four chained, write them out in
full in the note or review. This is a deliberate trade-off —
range-parsing would grow the regex into something hard to audit
for a tiny gain.

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
inbox file back; pass `--unread` to hide already-read messages.

Each row in `gate inbox` output is labeled with `(unread)` or
`(read <timestamp>)` so you can tell at a glance what's new.
Messages are numbered 1-based against the unfiltered inbox, which
stays stable even when `--unread` hides some rows — so an index
shown in the display maps directly to a `mark-read` call.

**Marking messages as read.** Reading is itself an act worth
recording. `gate inbox mark-read` flips every unread message in the
recipient's inbox to `read: true` and stamps a `read_at` timestamp
for audit:

```
$ gate inbox --for kiri
  1. [2026-04-15T02:10:00Z] message from noir (unread)
  レビューありがとう
  2. [2026-04-15T02:11:00Z] broadcast from alice (unread)
  全員周知...

$ gate inbox mark-read --for kiri
✓ marked 2 as read for kiri (0 already read, 2 total)
```

Pass a positional `N` to mark just one (`gate inbox mark-read 2
--for kiri`); mark-read is idempotent, so calling it twice simply
reports `0 already read`. Both verbs respect `GUILD_ACTOR` in
place of `--for`, so an interactive agent can just type `gate
inbox mark-read`.

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
