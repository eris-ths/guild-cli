# guild-cli verb cookbook

> Deep-dive examples and design notes for each `gate` verb.
> The README has the quick-reference signatures and a one-line summary
> per verb; this file is for "I want to actually use this — show me a
> real session and explain the surprising bits."
>
> If a verb is missing here, see [`README.md` § Two CLIs](../README.md#two-clis)
> for the full signature list.

---

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

### Boot: single-command orientation

`gate boot` is the agent-first entry point. Where the Session-start
recipe below uses three verbs (`status` + `whoami` + `tail`), `boot`
returns a single JSON payload with identity, queues, recent activity,
your own recent utterances, and unread inbox:

```json
{
  "actor": "kiri",
  "role": "member",
  "status": { "pending": {...}, "approved": {...}, ... },
  "tail": [...],        // 10 most recent utterances across all actors
  "your_recent": [...], // 5 most recent utterances by you
  "inbox_unread": [...],
  "last_activity": "2026-04-16T..."
}
```

`GUILD_ACTOR` is optional — without it, `your_recent` is `null` and
per-actor counts are zero, but the global snapshot still returns.
Use `--format text` for the human-readable rendering.

**Design note.** Three short commands (`status` + `whoami` + `tail`)
is agent-friendly but not agent-first: the agent has to decide "what
do I fetch next" during orientation. `boot` bundles the three into
one payload so the agent can acquire full context with one tool call.

### Write verbs: `--format json` and `suggested_next`

Every write verb (`request`, `approve`, `deny`, `execute`, `complete`,
`fail`, `review`, `fast-track`) accepts `--format json` and returns a
structured response:

```json
{
  "ok": true,
  "id": "2026-04-16-0001",
  "state": "approved",
  "message": "✓ approved: 2026-04-16-0001",
  "suggested_next": {
    "verb": "execute",
    "args": { "id": "2026-04-16-0001", "by": "kiri" },
    "reason": "request is approved; executor should begin work"
  }
}
```

`suggested_next` is derived deterministically from state, assigned
executor, and auto-review. An orchestrator can parse it directly into
the next tool call. When the lifecycle has no further step (terminal
state, or completed with no auto-review), `suggested_next` is `null`.

**Review suggestion omits `verdict` on purpose.** Defaulting it to
`ok` would let an inattentive agent chain-call the suggestion and
rubber-stamp a review — the exact failure mode the Two-Persona loop
exists to prevent. The reviewer must supply `--verdict` explicitly.

**Pending with multiple hosts.** When `host_names` has more than one
entry, `suggested_next.args.by` is omitted and the `reason` field lists
the candidates, so the agent (or human) picks explicitly rather than
rubber-stamping on the first configured host.

### Schema: JSON Schema introspection for LLM tool layers

`gate schema` emits a JSON Schema (draft-07) catalogue of every verb,
its inputs, and its outputs. Primary consumer is an LLM wiring gate
into an MCP tool layer — instead of parsing `gate --help` and guessing
arg names, the agent ingests this payload:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "version": "0.1.0",
  "verbs": [
    { "name": "approve", "category": "write",
      "input": { "type": "object",
                 "properties": { "id": {...}, "by": {...}, ... },
                 "required": ["id"] },
      "output": { ... writeResponseSchema ... } },
    ...
  ]
}
```

Use `--verb <name>` to filter to one verb. `--format text` produces a
one-line-per-verb summary for humans. A CI test pins the `VERBS` list
against `index.ts`'s dispatch table so the schema can't silently drift.

### Status: agent orientation

`gate status` is the first command an agent calls at session start.
It returns a structured summary of the content root's current state:

```
$ gate status
{
  "actor": null,
  "pending": { "total": 3, "as_executor": 0, "as_author": 0 },
  "approved": { "total": 1, "awaiting_execution": 1 },
  "executing": { "total": 0, "by_actor": 0 },
  "open_issues": 4,
  "unreviewed": 1,
  "inbox_unread": 0,
  "last_activity": "2026-04-16T05:12:12.925Z"
}
```

With `GUILD_ACTOR` or `--for`, the counts are scoped to that actor:

```
$ GUILD_ACTOR=noir gate status --format text
status for noir
──────────────────────────────
pending: 3 (1 as executor, 2 authored)
approved: 1 (0 awaiting your execution)
open issues: 4
inbox unread: 2
last activity: 2026-04-16T05:12:12.925Z
```

**Default output is JSON** — designed for agents to parse and act on.
Use `--format text` for human-readable display.

**Design note.** `gate status` vs `gate whoami`: status answers
"what's the state of this content root?" (numbers, queues, counts).
`whoami` answers "who am I and what did I say recently?" (identity,
voice). Use both at session start: status first for orientation,
whoami for voice recovery.

---

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
- `--format text` — human-readable output (default is JSON since 0.2.0)

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

### Configurable lenses

The four built-in lenses (`devil | layer | cognitive | user`) are
the default, but teams can add domain-specific lenses via
`guild.config.yaml`:

```yaml
lenses:
  - devil
  - layer
  - cognitive
  - user
  - security       # e.g. OWASP / supply-chain review
  - correctness    # e.g. formal invariant checks
```

When configured, `gate review` and `gate voices --lense` accept the
custom values:

```
$ gate review 2026-04-16-001 --by noir --lense security --verdict ok \
  --comment "no injection vectors, input sanitized at boundary"
✓ review recorded: 2026-04-16-001 [security/ok]
```

If `lenses` is omitted from the config, the four built-ins apply.
An empty list also falls back to the defaults. Lense names are
lowercased on load. The validation error message lists all
configured lenses so mistyped values are easy to correct.

**Design note.** Lenses are an extension point for the review
system. Each lens is a perspective, not a role — the same reviewer
can write `devil` and `security` reviews on the same request. The
config makes the set of valid perspectives explicit for a given
content root, which prevents lens drift across long-lived projects.

### Editor-based review comments

When `gate review` is called without `--comment`, without a
positional comment, and without `--comment -` STDIN, and stdin is
a TTY, the CLI opens your editor — matching the `git commit`
convention:

```
$ gate review 2026-04-16-001 --by noir --lense devil --verdict concern
# → opens $EDITOR with a template
```

Editor selection follows `GIT_EDITOR > VISUAL > EDITOR > platform
default` (`notepad` on Windows, `vi` elsewhere). The template uses
git's "scissors" sentinel — everything at and below the scissors
line is stripped:

```
# Write your review comment ABOVE the scissors line.
# The scissors line and everything below it are stripped.
# ------------------------ >8 ------------------------
# Reviewing: 2026-04-16-001
# Lense: devil  Verdict: concern
```

This is the most comfortable way to write multi-paragraph reviews
without shell quoting pain. `--comment -` (STDIN) is still
available for automation pipelines.

### Session-start recipe

Three commands give you full orientation at the start of a session:

```bash
# 1. What's the state of this content root?
gate status --for $GUILD_ACTOR

# 2. Who am I and what did I say recently?
gate whoami

# 3. What happened while I was away?
gate tail 10
```

`status` gives you the numbers (queues, issues, inbox).
`whoami` gives you your voice (identity, recent utterances).
`tail` gives you the timeline (what everyone else did).

Together they answer "where was I, what's waiting, and what
changed" in under a second.

### Doctor and repair

`gate doctor` is a read-only health check over the content root.
It scans members, requests, and issues for malformed YAML records
and reports findings without modifying anything:

```
$ gate doctor
gate doctor — content root health

✓ members   3 total, 0 malformed
✓ requests  17 total, 0 malformed
✓ issues    8 total, 0 malformed

✓ clean — no malformed records detected
```

When findings exist, pipe to `gate repair` for intervention:

```
$ gate doctor --format json | gate repair          # dry-run: show plan
$ gate doctor --format json | gate repair --apply  # execute: quarantine
```

Repair quarantines malformed files to `<content_root>/quarantine/`
with a timestamp directory. `duplicate_id` and `unknown` findings
are no-op (data safety: automatic resolution risks data loss).

**Design note.** Doctor and repair are separate verbs — observation
vs intervention. You can always run `gate doctor` without fear of
side effects. This mirrors the `silent_fail_taxonomy` principle:
separate the "what's wrong" from the "what to do about it."

**Plugins.** `gate doctor` supports plugins via `guild.config.yaml`:

```yaml
doctor:
  plugins:
    - ./plugins/doc-check.mjs
```

A plugin is an ES module exporting a function that returns additional
findings. Plugin errors become findings (never crash doctor). See
`DoctorPluginFn` in `DiagnosticUseCases.ts` for the interface.

---

A fully worked multi-turn example — author/critic personas driving
each of these verbs through a real request lifecycle — lives in
[`examples/dogfood-session/`](./examples/dogfood-session/). It was
generated by using this tool to track its own implementation.
