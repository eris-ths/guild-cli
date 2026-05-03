# guild-cli verb cookbook

> Deep-dive examples and design notes for each `gate` verb.
> The README has the quick-reference signatures and a one-line summary
> per verb; this file is for "I want to actually use this — show me a
> real session and explain the surprising bits."
>
> **You probably don't need this yet.** If you've read
> [`concepts-for-newcomers.md`](./concepts-for-newcomers.md)
> (30 seconds) and can run `gate boot`, you're productive. Come back
> when a specific verb starts behaving in a way that surprises you —
> this cookbook is organized around those surprises.
>
> If a verb is missing here, see [`AGENT.md`](../AGENT.md) for the
> full signature list (the agent quick reference carries every verb,
> state machine, and config field).

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

### Pair-mode: who were you with?

`--with <n1>[,<n2>...]` on `gate request` / `gate fast-track`
records the dialogue partners during the formation of a request.
Empty / omitted = solo. Partners go through the same actor
validation as `--from` / `--executor` (members or hosts).

```bash
gate request --from claude --with eris --action "..." --reason "..."
gate fast-track --from claude --with "eris, alice" --action "..." --reason "..."
```

The field surfaces everywhere the author is visible:

- `gate show <id>` — adds a `with: eris, alice` line
- `gate voices <name>` / `gate tail` — appends `(with eris, alice)`
  to the authored-utterance header
- `gate resume --format text` — prose reads "shaped with eris, alice"
  (or 「eris と一緒に」 in the ja locale)

**Design note — this is Layer 1 of three.**
- **Layer 1 (fact, implemented):** Request carries `with`. The
  transient fact of formation: who was the partner in this one
  decision. That is what this verb records.
- **Layer 2 (kinship, deferred):** Member YAML could carry a
  `kinship: [...]` field for durable "who I usually work with"
  metadata. Not yet needed; will be added when real use surfaces
  the demand.
- **Layer 3 (policy, deferred):** `guild.config.yaml` could declare
  content-root-level conventions (e.g. `pair_mode: { required: true }`).
  Also deferred until need surfaces.

The three layers are orthogonal. You can use Layer 1 without Layer
2 or 3; you can add Layer 2 later without retrofitting Layer 1 on
existing records (`with` is optional).

**Author-self in `with` is dropped.** The record means "partners
besides me", so listing yourself is silently removed rather than
flagged as an error — the intent is usually a slip, not a mistake.

### Resume: picking up where the last session ended

`gate resume` answers "what was I doing?" at the start of a new
session. It reads the content_root from the actor's perspective and
composes a **restoration prompt** — structured and prose — so the
new session can pick up the thread of the old one.

```bash
$ export GUILD_ACTOR=claude
$ gate resume --format text
# resuming as claude

Your last voice was a review (3h ago) on req=2026-04-16-0002 — [user/concern]:
  "(1) gate voices <name> を debug/audit ではなく「読書」として..."

Your last lifecycle step (3h ago): req=2026-04-16-0006 → executing

Open loops waiting on you (1):
  - [3h ago] 2026-04-16-0006 (executor): you started; not yet completed — "Feature: gate resume ..."

Suggested next: gate complete --id 2026-04-16-0006 --by claude
  reason: request is executing; executor should complete (or fail) when done
```

The JSON shape carries the same information plus per-field structure:

```json
{
  "actor": "claude",
  "session_hint": "2026-04-16T23:40:...",
  "last_context": {
    "summary": "claude last reviewed at ...; 1 open loop.",
    "last_utterance": { ... },
    "last_transition": { ... },
    "open_loops": [{ "type": "executing", "id": "...", "role": "executor", "age_hint": "3h ago", ... }]
  },
  "suggested_next": { "verb": "complete", "args": {...}, "reason": "..." },
  "restoration_prose": "..."
}
```

**Open-loop taxonomy** (priority order):
- `executing` — you started work, haven't completed yet (most urgent;
  others may be blocked by your half-finished state).
- `awaiting_execution` — approved, you're the executor, haven't
  started.
- `pending_review` — a completed request auto-assigned to you is
  waiting for your review.
- `unreviewed_completion` — your own completion is waiting on your
  reviewer; lowest urgency (the ball is in their court).

`suggested_next` is derived from the top loop via the same
`deriveSuggestedNext` logic write verbs use, so the hint is
identical across `gate complete`, `gate boot`, and `gate resume`.
Review suggestions still omit `verdict` on purpose — the anti-rubber-
stamp guard applies here too.

**Why prose + structure both?** An agent consuming the JSON goes
straight to `suggested_next`. An agent consuming the prose restores
continuity by reading — the same way a human reads back yesterday's
notes. The prose is deterministic (no LLM call inside the tool); it
is templated from the same facts the JSON carries.

`GUILD_ACTOR` is required: `resume` is inherently first-person.

**Locale.** `--locale <en|ja>` or `GUILD_LOCALE` env var selects the
prose language. Defaults to `en`. Only the `restoration_prose` field
is localized; the structured fields stay in English so programmatic
consumers are stable.

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
`note:` / `denied:` / `failed:`) or a review (lense + verdict +
comment). Filters combine via AND:

- `--lense <devil|layer|cognitive|user>` — only reviews with that
  lense (implies review-only; authored requests carry no lense)
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

**No-silent-ignore.** `gate tail` opts in to strict unknown-flag
rejection: `gate tail --from noir` now errors (used to be silently
dropped, because `--from` was never a tail flag). The error lists
the valid flags for the verb so the fix is obvious. As of the
follow-up landing, **every write verb** (`register`, `request`,
`approve`, `deny`, `execute`, `complete`, `fail`, `fast-track`,
`review`, `thank`, `message`, `broadcast`, `inbox`,
`inbox mark-read`, and all `issues` subcommands) enforces the
same rule, so typos like `gate register --catgeory X` or
`gate thank --reasn "..."` also error instead of silently filling
in defaults.

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
per-lense verdict summary so you can scan a whole list of completed
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

**Preview without walking.** `gate show <id> --format text` ends
with a **chain hint footer** that scans the same free-text fields
and reports whether `gate chain <id>` will surface anything — either
`"chain hint: no outbound id references detected"` or the list of
referenced ids. The hint is read-time only; writers stay
unconstrained. This is the nudge for writers who might otherwise
discover the short-form gotcha (`(0004)` not counting as a
reference) only when a reader can't follow the thread.

### Issue state transitions and the state_log

`gate issues resolve / defer / start / reopen <id>` move an issue
through its state graph (open ↔ in_progress ↔ deferred → resolved,
plus resolved → open via reopen). Each transition requires
`--by <m>` (or `GUILD_ACTOR`) and appends one entry to the issue's
`state_log: [{state, by, at, invoked_by?}]`:

```
$ gate issues resolve i-2026-04-22-0001 --by alice
✓ issue i-2026-04-22-0001: → resolved by alice
```

The log is append-only, max 100 entries per issue. It's the
companion to Request's `status_log` — same shape, same contract.
Without it an `open → resolved → open → resolved` flap collapses
to "just resolved" in YAML; the log preserves that history so
forensics can see the flutter.

Legacy issue YAML (pre-state_log) hydrates as `[]`; the first
post-upgrade transition starts the log. `toJSON` omits the field
when empty, so issues that haven't transitioned yet stay
byte-identical to their pre-log form.

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
be resolved manually. The `resolved` transition stamps the
state_log as `by: <from>` (the promoter).

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
system. Each lense is a perspective, not a role — the same reviewer
can write `devil` and `security` reviews on the same request. The
config makes the set of valid perspectives explicit for a given
content root, which prevents lense drift across long-lived projects.

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

### Board: what's in flight

`gate board` shows the non-terminal subset of the request corpus
in a single view — pending, approved, and executing, stacked in
lifecycle order:

```
$ gate board
── pending (2) ──────────────────────────
  2026-04-19-0003  [alice] implement caching layer
  2026-04-19-0004  [bob]   update API docs

── approved (1) ─────────────────────────
  2026-04-19-0002  [alice] refactor auth module   executor=bob

── executing (1) ────────────────────────
  2026-04-19-0001  [bob]   add rate limiting      executor=bob ✓devil
```

`--for <m>` scopes to the actor's requests. When `GUILD_ACTOR`
is set, filtering is implicit (with a stderr notice). JSON
output via `--format json`.

**Design note.** Board excludes terminal states and issues.
"In flight" means "someone could still act on this." Closed
records belong to `tail` / `voices` / `show`.

### Register: onboarding in one command

Before `register`, a first-time agent had to hand-author YAML.
Now:

```
$ gate register --name claude --category professional
✓ registered: claude [professional]
  next: export GUILD_ACTOR=claude && gate boot
notice: wrote /abs/path/members/claude.yaml (config: /abs/path/guild.config.yaml)
```

- `--category` defaults to `professional` (aliases: `pro`, `prof`,
  `member`).
- Re-registering the same name is a no-op error, not a silent
  overwrite.
- `--dry-run` previews the YAML without writing — the preview
  header now shows the absolute path, and a stderr notice fires
  with `would write` instead of `wrote` (symmetric with the
  real-write disclosure).
- `--category host` is rejected — hosts go in `guild.config.yaml`.

**Path-disclosure notice (post-PR #108).** The stderr `notice:`
line names where the YAML actually landed, plus which
`guild.config.yaml` was in effect. When gate walked up to a
parent's config — or fell back to cwd because no config was
found — that's where the silent gap used to be. The notice
makes both cases visible. The JSON envelope (`--format json`)
carries the same disclosure as structured fields:
`{where_written: "/abs/path/members/<name>.yaml", config_file:
"/abs/path/guild.config.yaml" | null}`. See
[`lore/principles/09-orientation-disclosure.md`](../lore/principles/09-orientation-disclosure.md)
for the rule the disclosure honours, and `gate boot` /
`gate doctor` for the read-side counterparts.

**Design note.** Registration must be frictionless so an agent's
first interaction with a content_root doesn't stall on schema
discovery. The verb exists because the alternative ("figure out
the member YAML format from examples") is the wrong first
impression for agent-first tooling.

### Suggest: the hot-loop sibling of boot

`gate suggest` returns the ONE next thing, right now, using the
same priority ladder as `boot.suggested_next`:

```
$ gate suggest --format text
→ complete id=2026-04-19-0001 by=bob
  you are executing 2026-04-19-0001 — complete it
# advisory — override freely
```

The `# advisory` footer goes to stderr (principle 02). JSON
output returns `{ suggested_next: { verb, args, reason } | null }`.

**Design note.** `boot` is the orientation call (comprehensive
snapshot, once per session). `suggest` is the hot-loop call
(minimal payload, repeated). They share `deriveBootSuggestedNext`
so the two can never diverge. An agent that dispatches
`suggest.verb` without reading `suggest.reason` is treating a
heuristic as a command — the anti-pattern principle 02 names.

### Thank: the gratitude primitive

```
$ gate thank noir --for 2026-04-19-0001 --by eris
✓ thanked: noir on 2026-04-19-0001
```

Thanks are orthogonal to reviews (principle 06, Two memories):

- **Reviews** record judgement → feed voice calibration.
- **Thanks** record gratitude → feed nothing quantitative.

`--reason` is optional. Most of the time the fact of the thank
is the signal. Self-thank is allowed but flagged on stderr.
`--reason -` reads stdin (symmetric with `review --comment -`).

**Design note.** If thanks fed calibration, gratitude would
become strategic. If reviews captured gratitude, judgement would
become polite. Keeping them orthogonal lets each be honest.
See `lore/principles/06-two-memories.md`.

### Transcript: the narrative arc of a request

```
$ gate transcript 2026-04-19-0001
# 2026-04-19-0001 — add rate limiting

Filed by bob on 2026-04-19T10:00:00Z.
  action: add rate limiting to the API gateway
  reason: protect upstream services from burst traffic

Approved by eris (+3m). Execution started by bob (+5m).
Completed by bob (+2h15m): "implemented with token bucket; ...".

Reviewed by noir [devil/ok] (+4h):
  "clean implementation, considered failure modes."

noir thanked bob.

── summary ──
actors: bob, eris, noir (3)
reviews: 1 (devil/ok)
thanks: 1
duration: 4h
```

JSON output (`--format json`) returns `{ id, arc, summary }`
where `arc` is the prose and `summary` carries structured data
(actors, review_verdicts, duration_ms).

**Design note.** `show` gives structured access. `voices` gives
per-actor history. `transcript` gives per-request prose — the
narrative a cold reader needs to understand what happened without
parsing YAML. If agents render this better themselves, the verb
can be dropped — the data path isn't disturbed (read-only).

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

## Agora — the second passage (alpha)

`agora` is the second passage under guild, alongside `gate`. Where
gate is request-lifecycle / review / dialogue, agora is **play /
narrative** with **suspend / resume as first-class primitives**.

### When to reach for agora vs gate

- **Use `gate`** when the work has a definite shape — a decision to
  approve, work to execute, output to review. The lifecycle is
  pending → approved → executing → completed. Each transition gets
  recorded; reviews attach to specific requests.
- **Use `agora`** when the work is exploratory, narrative, or
  paused-and-resumed across sessions. Quest = goal-oriented branching;
  Sandbox = no-goal, emergence-shaped. There is no "approve" — the
  cliff/invitation prose is the substrate-side motivation for the
  next instance to re-enter.

### A worked session

```bash
# 1. Define a Game (one-time per design).
$ agora new --slug design-loop --kind sandbox --title "Iterative design"
✓ created game: design-loop [sandbox] — Iterative design
notice: wrote /abs/path/agora/games/design-loop.yaml (config: ...)

# 2. Start a play session against the Game.
$ agora play --slug design-loop
✓ play started: 2026-05-02-001 [playing] on game=design-loop

# 3. Make moves.
$ agora move 2026-05-02-001 --text "first thought, ran into a contradiction"
✓ move 001 appended to 2026-05-02-001 on game=design-loop by alice

# 4. Suspend with cliff + invitation when you have to step away.
$ agora suspend 2026-05-02-001 \
    --cliff "the contradiction between simplicity and completeness wasn't named" \
    --invitation "name it explicitly, or absorb one of the two horns"
✓ play suspended: 2026-05-02-001 [playing → suspended] by alice
  cliff:      the contradiction between simplicity and completeness wasn't named
  invitation: name it explicitly, or absorb one of the two horns

# 5. Later session — pick up. Notice the cliff/invitation surfaces.
$ agora resume 2026-05-02-001 --note "absorbed completeness; simplicity becomes the constraint"
✓ play resumed: 2026-05-02-001 [suspended → playing] by alice
  closing cliff:      the contradiction between simplicity and completeness wasn't named
  closing invitation: name it explicitly, or absorb one of the two horns

# 6. Continue, conclude, or suspend again.
$ agora conclude 2026-05-02-001 --note "design landed; opening a new play for the next layer"
```

### The substrate-side Zeigarnik effect

The pivot of agora is encoded in `agora suspend` requiring
**both** `--cliff` and `--invitation`. Pre-this design, AI agents
hitting context reset between sessions had no tool-level support
for "I left this hanging on purpose, here's how to come back."
The substrate stores both prose fields append-only, and `agora
resume` surfaces them at re-entry — the next instance reads what
was paused on without any psychology required. See
[issue #117](https://github.com/eris-ths/guild-cli/issues/117) for
the design rationale and translation from the human Zeigarnik
effect / habit tracker.

### State machine (compact)

```
playing  ── move ──────▶ playing
         ── suspend ───▶ suspended
         ── conclude ──▶ concluded   (terminal)
suspended ── resume ──▶ playing
         ── conclude ──▶ concluded   (drift-away outcome — the
                                      cliff/invitation stay in the
                                      record as audit trail)
```

### Files agora writes

```
<content_root>/agora/
  games/<slug>.yaml              # Game definition
  plays/<game-slug>/<play-id>.yaml   # Play session (per-game subdir)
```

agora reuses gate's substrate (`safeFs`, `parseYamlSafe`,
`GuildConfig`, `MemberName`, `parseArgs`) — same content_root,
same member identity. The container/passage architecture in action.

### Discoverability

```bash
agora --help                    # full verb list
agora schema [--verb <name>]    # principle 10 contract (JSON Schema)
agora list                      # what games + plays exist
agora show <slug-or-play-id>    # detail view
```

For the architectural rationale (container with passages, AI-first
substrate, schema-as-contract) see lore principles 04, 09, 10, 11.
The agora-specific README at
[`src/passages/agora/README.md`](../src/passages/agora/README.md)
covers layout, status, and lore upstream in more detail.

## Devil-review — the third passage (alpha)

`devil` is the third passage under guild, alongside `gate` and
`agora`. Where gate carries decisions and agora carries narrative,
devil carries **review-as-deliberation-substrate** — a multi-persona,
lense-enforced surface that composes with single-pass review tools
(Anthropic `/ultrareview`, Claude Security, supply-chain-guard)
rather than replacing them. Design rationale lives in
[issue #126](https://github.com/eris-ths/guild-cli/issues/126).

### When to reach for devil vs gate vs agora

- **Use `gate review`** for quick verdicts on requests
  (`ok | concern | reject` per lense, single-shot, lightweight).
- **Use `agora`** for open-ended exploration where the substrate
  needs to carry "what just happened" and "what should the next
  opener do" across re-entries.
- **Use `devil`** when the review needs **structural multi-persona
  dissent**, **lense coverage that can't be silently skipped**, or
  **time-extended re-entry on the same target** — typically
  security-sensitive code, supply chain changes, or anywhere a
  single-pass model review's framing-blindness matters.

A devil review is **heavier** than a gate review by design. The
friction (lense catalog, persona commitment, severity rationale)
is the floor-raising mechanism; expect to spend more time per
review than gate review takes.

### Worked example (end-to-end loop)

```bash
$ devil open src/foo.ts --type file
✓ devil-review opened: rev-2026-05-03-001 [open] against file:src/foo.ts by alice
  next: devil entry rev-2026-05-03-001 --persona <p> --lense <l> --kind <k> --text "..."
        or devil ingest rev-2026-05-03-001 --from <ultrareview|claude-security|scg> <input>
notice: wrote /abs/path/devil/reviews/rev-2026-05-03-001.yaml (config: ...)

$ devil entry rev-2026-05-03-001 \
    --persona red-team --lense injection --kind finding \
    --text "user input concatenated into raw SQL on /admin/search" \
    --severity high \
    --severity-rationale "endpoint sits behind auth but admin role is broadly granted in this repo"
✓ entry e-001 appended to rev-2026-05-03-001 [persona=red-team, lense=injection, kind=finding] by alice

$ devil entry rev-2026-05-03-001 \
    --persona author-defender --lense injection --kind assumption \
    --text "input is sanitized one layer up by the routing middleware" \
    --addresses e-001
✓ entry e-002 appended to rev-2026-05-03-001 [persona=author-defender, lense=injection, kind=assumption] by alice

$ devil entry rev-2026-05-03-001 \
    --persona mirror --lense composition --kind synthesis \
    --text "the red-team and author-defender agree on the path but disagree on whether middleware sanitization is contracted; the trust assumption (e-002) is the load-bearing thing"
✓ entry e-003 appended

$ devil show rev-2026-05-03-001
rev-2026-05-03-001 [open] against file:src/foo.ts
opened: 2026-05-03T... by alice

entries: (3)
  e-001  [persona=red-team / lense=injection / kind=finding / severity=high / status=open / by=alice]
    user input concatenated into raw SQL on /admin/search
    severity_rationale: endpoint sits behind auth but admin role is broadly granted in this repo
  e-002  [persona=author-defender / lense=injection / kind=assumption / by=alice]
    input is sanitized one layer up by the routing middleware
    addresses: e-001
  e-003  [persona=mirror / lense=composition / kind=synthesis / by=alice]
    the red-team and author-defender agree on the path but disagree on whether middleware sanitization is contracted; the trust assumption (e-002) is the load-bearing thing

$ devil conclude rev-2026-05-03-001 \
    --synthesis "Finding stands until middleware sanitization contract is documented. e-002 is the assumption to test, not the answer." \
    --unresolved e-001
✓ devil-review concluded: rev-2026-05-03-001 [open → concluded] by alice
  synthesis: Finding stands until middleware sanitization contract is documented. ...
  unresolved: e-001
  this review is now terminal — no further entries, suspensions, resumes, or re-runs.
```

### Entry kinds (validated per-kind)

| Kind | Required extras | Purpose |
|------|-----------------|---------|
| `finding` | `--severity` + `--severity-rationale` | Concrete vulnerability candidate. The rationale is the friction that forces exploitability-context reasoning (Claude Security influence). |
| `assumption` | (none) | Declared trust assumption ("auth() is correct"). Future entries can `--addresses` it to contest. |
| `resistance` | (none) | Verdict-less concern ("something feels off"). Held without verify. |
| `skip` | (none) | `--text` declares why the lense is irrelevant. Substrate keeps the skip explicit. |
| `synthesis` | (none) | Cross-cutting reading for the conclusion phase. |
| `gate` | `stages[]` (only via `devil ingest`) | Multi-stage automated check output (e.g., SCG's 8 gates). Building from CLI flags is too brittle, so `devil entry` rejects this kind. |

### Personas (catalog-enforced)

| Persona | Commitment |
|---------|------------|
| `red-team` | Adversarial framing strict. Find the cheapest way to harm an end user. Don't be fair. |
| `author-defender` | Articulate the author's framing and the trust assumptions the change rests on. Make assumptions explicit (`kind: assumption`) so red-team has targets. |
| `mirror` | Read both. Surface contradictions, things both sides missed, load-bearing assumptions neither named. |

Ingest-only personas (`ultrareview-fleet`, `claude-security`,
`scg-supply-chain-gate`) are in the catalog but cannot be used by
hand — `devil entry` refuses them with `PersonaIsIngestOnly`. The
matching `devil ingest --from <source>` verb is the only path that
attributes entries to those personas.

### Lenses (v1 catalog of 12)

The first 8 mirror Claude Security's detection categories
(injection, injection-parser, path-network, auth-access,
memory-safety, crypto, deserialization, protocol-encoding) so
ingested findings have a 1:1 home. Four devil-review-specific
lenses extend the catalog:

- `composition` — multi-file/function effect. Diff-bounded review
  tends to miss this; devil keeps it as its own axis.
- `temporal` — TOCTOU, race, retry, idempotency. Easy to miss in
  single-pass review because the model has no native sense of
  "two requests overlap" or "retry happens 30 seconds later."
- `supply-chain` — **mandatory delegate to SCG** (see issue #126
  decision C). The `supply-chain` lense fails closed if SCG is
  unavailable rather than allowing silent skip — the floor-raising
  design refuses "compromise on what we know matters."
- `coherence` — bird's-eye / cross-lense / cross-target. Catches
  drift between docs and code, naming inconsistencies, contradictions
  between findings under different lenses, and architectural-posture
  observations that lense-by-lense audit cannot reach. Surfaced as
  a methodology gap during devil-on-devil dogfood (mirror's e-014
  synthesis); promoted to a first-class lense so the audit posture
  itself is auditable.

Per-content_root custom lenses (under `<content_root>/devil/lenses/<name>.yaml`)
land later as a separate adapter; the catalog interface already
exists for the seam.

### Conclusion is verdict-less

`devil conclude` requires `--synthesis` prose. There is no
ok|concern|reject label — the synthesis is what the reviewer
concluded across all lenses, not a single tag.

`--unresolved e-001,e-002,...` lists entry ids the reviewer chose
not to dismiss-or-resolve before concluding. Substrate-explicit
"these threads are deliberately left open" — distinct from "all
closed" or "we forgot to update them."

After conclude no further entries / suspensions / resumes /
re-runs are accepted (terminal state).

### Status (alpha)

The complete v1 surface from #126 is landed:

```
devil open / entry / list / show / dismiss / resolve / suspend
       / resume / ingest / conclude / schema
```

dismiss / resolve cover finding status mutation; suspend / resume
add cliff/invitation re-entry context (softer than agora's — do
not block other entries); ingest wires the automated source paths
(`/ultrareview`, Claude Security, SCG) using strict v0 input JSON
shapes documented in the handler. Real-world adapters that
translate actual upstream tool output into those shapes live
outside the in-tree passage.

For substrate paths and the persona/lense schema reference, see
the `## devil-review` section of [`AGENT.md`](../AGENT.md).

---

A fully worked multi-turn example — author/critic personas driving
each of these verbs through a real request lifecycle — lives in
[`examples/dogfood-session/`](./examples/dogfood-session/). It was
generated by using this tool to track its own implementation.
