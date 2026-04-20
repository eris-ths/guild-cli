# Changelog

All notable changes to `guild-cli` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to the versioning policy described in [POLICY.md](./POLICY.md).

## [Unreleased]

### Fixed
- **`save()` no longer throws spurious `RequestVersionConflict` on
  records carrying legacy stateless `status_log` entries.** `hydrate`
  skips status_log rows whose `state` field is missing (an older
  format wrote review notes that way), but `readVersion` was counting
  those rows from the raw YAML — so `loadedVersion` (from the hydrated
  aggregate) lagged `maxOnDisk` (from the raw count) by exactly the
  number of skipped entries. Every save() on such a record then threw
  `RequestVersionConflict` even when no concurrent writer existed.
  Surfaced by `gate thank` against any reviews ≥ 1 request whose
  status_log carried a legacy review-note row — the verb only touches
  `thanks[]`, so the version drift wasn't masked by a real
  status_log/reviews delta. Same shape as the earlier
  "`Custom lenses no longer break listAll-backed read verbs`" fix
  (read-path skip rule out of sync with raw count). One-line behavior
  fix; regression test injects the legacy shape and runs `addThank` →
  `save()` round-trip.
- **`unresponded_concerns` no longer counts pre-dating mentions as
  follow-ups.** `UnrespondedConcernsQuery.hasFollowUp` was checking
  "does any authored record mention this id?" without a temporal
  guard. Concrete failure: v1 denied with reason mentioning v2.id
  ("refile as v2"), then v2 reviewed with a concern — the earlier
  v1 deny's mention of v2.id falsely counted as a follow-up, so the
  concern was hidden from resume. With the guard, a referring record
  is only counted as a follow-up if its `created_at` post-dates the
  latest concern on the request. Surfaced by a review-mode dogfood
  where concerns were legitimately open but invisible.
- **Positional `-` now triggers the stdin sentinel on `gate review`,
  `gate issues note`, and `gate issues add`.** Previously `--comment -`
  / `--text -` read stdin but writing the sentinel as a trailing
  positional (`gate review ... --verdict X - <<EOF`) stored the
  literal `"-"` as the body — a natural shape that silently dropped
  the heredoc. Positional `-` now reads stdin the same way as the
  explicit flag forms.
- **`gate chain` dedupes bidirectional mentions and marks them with
  `↔`.** Two records that mention each other in their text used to
  appear in BOTH "referenced" and "referenced by" sections — the
  same record rendered twice. Now bidirectional refs appear once,
  in the forward section, prefixed with `↔` to signal mutual
  reference. One-way refs stay as before.

### Added
- **`gate issues promote` writes a structured `promoted_from` field
  on the created request.** The default `--action` / `--reason`
  templates mention the source issue id textually, and chain picks
  that up via its text-scan. But both flags can be overridden — in
  that narrow case the textual link disappears and chain would lose
  the connection. The new `promoted_from: <issue-id>` field on the
  request carries the tool-generated link independent of text
  content, so chain walks it as a separate-from-text reference path
  regardless of overrides. The field is omitted on non-promoted
  requests so existing YAML stays byte-identical; `gate show
  --format text` renders it on a dedicated line; `chain` dedupes
  against text-mention hits so default-promote output doesn't
  surface the same issue twice. Added as the first example of a
  tool-generated structured relationship (alongside `executor`,
  `auto_review`, `with`) — user-authored references still use the
  general text-mention channel. (#47 neighborhood.)

### Fixed
- **Custom lenses (configured in `guild.config.yaml`) no longer break
  `listAll`-backed read verbs.** `findById` correctly passed
  `config.lenses` to the hydrator, but `listByState` did not — so a
  review with a custom lens (e.g. `rational`, `emotional`) wrote
  fine, showed fine via `gate show`, but then `gate chain` / `gate
  voices` / `gate tail` hit hydrate failure with "Invalid lense" and
  silently dropped the record. Surfaced by dogfooding gate in
  solo-journal mode with a `rational / emotional / future-self /
  skeptic` lens set. One-line fix at the call site.
- **`gate message --text -` and `gate broadcast --text -` now read
  from stdin (med, silent data loss regression).** `gate issues
  note --text -` worked. `gate request --reason -` / `deny` /
  `fail` / `review --comment -` all worked. But `message` and
  `broadcast` silently stored the literal `-` as the body.
  Heredoc-piped handoff notes dropped their content with no
  error to show for it — a direct hit on the "the record is the
  truth" invariant. Ported the same `--text -` sentinel as
  `issues note`.

### Added
- **`gate issues add` now accepts `--text <s>` / `--text -` (low,
  symmetry).** Pre-fix the verb accepted text only as the
  positional argument, while the sibling `gate issues note` had
  all three routes. Users who built muscle memory on `note`
  bounced off `add`. Now symmetrical: `--text <s>` inline,
  `--text -` for stdin, positional remains as the backward-
  compat legacy form. Missing-text error lists all three routes
  and carries the same POSIX escape hint (`--text=<value>` / `--`
  separator) as `issues note` when a flag value begins with `--`.

### Added
- **`gate board` — "what's in flight" view.** New read verb that
  answers "what's happening right now" in one call, grouping
  pending + approved + executing rows under per-state headers.
  Surfaces the question that `gate status` gave counts for and
  `gate list --state <s>` gave single-state contents for, without
  requiring three commands to see the whole board. Terminal states
  (completed / failed / denied) and issues are out of scope: "in
  flight" means "someone could still act on this." Filters mirror
  `gate list`: `--for <m>` narrows each section to rows naming
  that actor; GUILD_ACTOR is applied implicitly when `--for` is
  omitted (same pattern, same stderr notice). Empty sections still
  render their header so the board shape stays stable across calls.
  JSON emits `{ pending: [...], approved: [...], executing: [...] }`
  with a stable key set — consumers can rely on all three arrays
  being present even when empty.

### Fixed
- **`gate register --name <x>` now rejects `x` already in `host_names`.**
  The existing guards blocked `--category host` and duplicate-member
  names but missed the third way to create the same collision:
  registering a plain member whose name is already a host in
  `guild.config.yaml`. Post-fix, all three entry points end up at
  the same invariant "a single name cannot be both a host and a
  member," which is what downstream verbs assume when they resolve
  an actor's role. Error names both remediation paths (pick a
  different --name, or remove from `host_names:`).

### Changed
- **`gate resume` documents its same-actor scope and points at
  `gate boot` when nothing is waiting.** Surfaced by a handoff
  dogfood: a newcomer running resume as a first command saw
  "Nothing is waiting" and walked away, not realizing their inbox
  had 3 unread + they were named as --with on two pending
  requests. resume's scope is "same-actor continuation" by
  design; the orientation lens is boot. Pinned that boundary in
  three places — schema summary, `gate --help` entry, and the
  module JSDoc — and added a fallback line to the empty-path
  prose (en + ja) so a newcomer who ran resume as part of a
  handoff learns to try boot. No functional change to what
  resume computes; this is a scope-clarification polish.
- **User-facing errors no longer leak the `DomainError:` class prefix.**
  Errors from the domain layer used to come through the CLI as
  `error: DomainError: Request not found: ... (id)`. The
  `DomainError:` prefix was pure noise for the end user — the `error:`
  cue is the universal CLI "this failed" marker, and naming the
  internal class on top added no information. Dropped. The field
  suffix (`(id)`, `(from)`, etc.) stays, because that actually names
  which flag was bad.
- **Chain documentation refreshed to match bidirectional walk.**
  `gate schema --verb chain` previously read "walk cross-references
  one hop from id" — stale since #45 added inbound refs. LLM tool
  layers consuming the schema would have built their wrapper docs
  off the one-sided summary. Updated schema summary, `gate --help`
  entry, and the chain module's JSDoc so every surface names the
  forward-and-inbound behavior consistently.

### Added
- **`gate chain <id>` walks inbound references too.** Previously
  only forward: chain scanned the root's own text and listed the
  ids it mentioned. Chain in reverse (who mentions ME) was silent,
  so an issue promoted to a request could be followed
  request→issue but not issue→request. Now renders up to four
  sections — `referenced issues`, `referenced requests`,
  `referenced by issues`, `referenced by requests` — joined by
  standard tree glyphs. O(N) scan over the corpus; typical
  content_root size makes this cheap.

### Changed
- **`gate chain` sees issue notes.** `gatherIssueText` now
  includes every note body in addition to the immutable `text`
  field, so a cross-reference added post-hoc as a note is visible
  to chain the same way it is to show/list. Same-shape fix that
  joins with the inbound walk — an issue that got a late "see
  2026-04-18-0003" note is now reachable from both directions.
- **`gate chain` empty-state phrasing.** Updated from "no cross-
  referenced records in action/reason/notes/reviews" (one-sided)
  to "no cross-referenced records; nothing references this
  either" (bidirectional), matching the new semantic.

### Changed
- **`invoked_by` surfaces on authored utterances in `gate voices` /
  `gate tail` / `gate resume`.** #43 stamped the creator's invoker
  onto `status_log[0]`, but the read paths for authored utterances
  (vs review utterances, handled in #41) still hid it. The gap
  surfaced by dogfooding: `GUILD_ACTOR=claude gate request --from eris`
  showed up on `gate show` but vanished on `gate voices eris` and
  in resume's "Your last voice was authoring req=X" prose. Now:
  - `gate voices` / `gate tail` render `[invoked_by=<actor>]` on
    the authored header (same shape as the review branch);
  - `gate resume` prose (en + ja) appends `(invoked by <actor>)` /
    `（<actor> が代行）`;
  - `AuthoredUtterance` gains an optional `invokedBy`, lifted from
    `status_log[0].invoked_by` at collection time;
  - `RequestJSON` gains an optional `status_log` projection so
    voices can read it without pulling in the full domain object.
  Same-actor creation is untouched.
- **`gate show --format text` pads the state column in `status_log`.**
  Ragged widths (`pending` 7ch vs `executing` 9ch) made the `by X`
  column shift per row. Padded per-render to the max state length
  in *this* log, so logs that never reached executing/completed
  stay compact.

### Added
- **`invoked_by` extended to every proxy-eligible write verb.** Previously
  scoped to the five transitions + `review` + `fast-track` (#39). Dogfooding
  surfaced the gap — `GUILD_ACTOR=X gate request --from Y` was silently
  attributed to Y with no audit trail of X. The invariant now applies to:
  - `gate request` — initial `pending` status_log entry stamps `invoked_by`
  - `gate issues add` — issue-level `invoked_by` on the first-frame record
  - `gate issues note` — per-note `invoked_by`
  - `gate issues promote` — the created request's initial status_log entry
  - `gate message` — per-notification envelope
  - `gate broadcast` — every fan-out envelope
  Each verb also emits the standard one-line stderr delegation notice.
  Omitted from YAML when `invokedBy` equals the nominal actor, so
  same-actor invocations stay byte-identical. `gate issues list` renders
  `[invoked_by=<actor>]` on the issue header and on each note; `gate
  inbox` shows it alongside the sender on every incoming message.

  A shared helper pair (`deriveInvokedBy` + `emitInvokedByNotice`) lets
  creation paths (id unknown until save) defer the stderr notice until
  after the record is allocated. The existing `resolveInvokedBy` wrapper
  is unchanged for same-id call sites.
- **`gate boot` emits `suggested_next` for pre-onboarding shapes.** When
  the caller has no identity yet, boot now prescribes a concrete first
  action instead of handing back a silent empty payload. Three branches:
  - `GUILD_ACTOR` unset, no members on this content_root → `register`
    (fresh root, new agent);
  - `GUILD_ACTOR` unset, members exist → `export GUILD_ACTOR=<...>`
    with a short list of existing member names (returning user);
  - `GUILD_ACTOR` set but unknown to the guild → `register --name
    <that-name>` (they already picked a handle; just file the record).
  Registered members and hosts get `suggested_next: null` — boot has
  no unambiguous next action for them. Text format renders a `→ next:`
  line with the exact shell command to paste.

### Changed
- **Multi-line values in `gate show --format text` / `gate voices` /
  `gate tail` align continuation lines with the value column.** Long
  `--reason` heredocs used to lose their indent on the second line
  onward, which broke the visual grouping of the field. Applied to
  `action`, `reason`, `completion_note`, `deny_reason`, and
  `failure_reason` via a shared `pushMultilineField` helper so all
  three read paths stay in lockstep.

### Changed
- **`invoked_by` surfaces in `gate voices`, `gate tail`, and `gate resume`.**
  Previously `gate show <id>` was the only read path that rendered
  `invoked_by`, so an AI agent that ghost-wrote ten operations on a
  member's behalf was invisible in the streams where people actually
  read their activity. voices and tail now append `[invoked_by=<actor>]`
  to review lines when the proxy differs from `by`; resume's
  `last_transition` JSON emits `invoked_by` (snake_case, matching
  `status_log` on the wire) and the restoration prose names the
  proxy ("invoked by claude" / "claude が代行"). Same-actor
  invocations stay unchanged — no clutter for the common case.
- **`gate list` without `--state` prints a tighter hint.** The prior
  version listed the state enum twice (once inline, once on a
  "States:" line); collapsed to one listing, and trimmed the
  "For X, use" phrasing so the hint is 3 lines instead of 5.

### Fixed
- **Values beginning with `--` can now be passed to every flag.** The
  arg parser refuses to consume a next-token that starts with `--`
  (it can't tell a literal from a genuine next flag without per-flag
  metadata), which made notes like `gate issues note <id> --by eris
  --text "--reason - 実装済"` silently drop the value. Same shape
  affected every STDIN-accepting verb (`gate request --reason`,
  `gate deny --reason`, `gate fail --reason`, `gate review --comment`,
  `gate issues note --text`) whenever the literal itself started
  with `--`. The fix is twofold:
  - **POSIX `--` end-of-options separator.** After a bare `--`, every
    remaining token becomes positional, even if it starts with `--`:
    `gate issues note <id> --by eris -- "--reason - foo"`.
  - **Clearer errors.** When a value-expecting flag lands as boolean
    (the surface symptom of this ambiguity), the error now names the
    two escape valves — `--key=<value>` and `-- <value>` — so the
    user isn't left staring at "text is required" after they did
    pass text.

  `--key=<value>` always worked and is pinned with a regression test.
  `gate --help` gains a short "Values beginning with `--`" section.

### Added
- **`invoked_by` on status_log and reviews.** When `GUILD_ACTOR`
  differs from the explicit `--by` (an AI agent acting on a
  human's behalf), write verbs (`approve` / `deny` / `execute` /
  `complete` / `fail` / `review` / `fast-track`) record
  `invoked_by: <GUILD_ACTOR>` on the status_log entry (or review)
  and print a one-line delegation notice to stderr. The on-record
  actor (`by`) still wins for attribution; `invoked_by` preserves
  the delegation so "eris approved" and "an AI approved on eris's
  behalf" stop being indistinguishable in YAML. Same pattern as
  inbox `read_by`. Omitted when `by` and the invoker agree (no
  YAML clutter for the self-invocation common case). `gate show
  --format text` renders `[invoked_by=<actor>]` inline on the
  matching log entry or review header.

- **`gate issues note <id>`.** Append-only annotation for existing
  issues. The original `severity` / `area` / `text` stay immutable
  by design (Two-Persona Devil: the first-frame record is preserved,
  not overwritten) — but the *understanding* of an issue evolves, and
  without a notes mechanism users had to spawn a whole new issue that
  referenced the old one just to say "sev should be med in hindsight"
  or "not reproducible on macOS". Notes take `--by <m>`, `--text <s>`,
  `--text -` (STDIN), or a positional; they appear under the parent
  issue in `gate issues list` as `└ note by <who> at <when>: <text>`.
  No edit, no delete — still append-only.
- **`read_by` on inbox mark-read.** Mark-read now records the actor
  that ran the command alongside `read_at`, so audits can distinguish
  "sentinel acknowledged this" from "eris marked it read on sentinel's
  behalf" (`--for <other>`). When `GUILD_ACTOR` differs from the inbox
  owner, stderr surfaces a `# mark-read by <actor> on behalf of
  <owner>` line so the delegation is visible in the session transcript.
  `gate inbox` display now shows `(read <at> by <actor>)` when read_by
  differs from the owner; identical reads stay formatted as before.
- **`--reason -` reads from STDIN.** `gate request`, `gate deny`,
  `gate fail`, and `gate fast-track` now accept `--reason -` the same
  way `gate review --comment -` already did. Long multi-line reasons
  can come from `$(cat reason.txt)` or a heredoc without shell
  quoting gymnastics. `--note -` on deny/fail works too for
  muscle-memory parity.

### Changed
- **`gate list` without `--state` points at `status`.** The error that
  used to read `Missing --state` now spells out the list-vs-status
  distinction: `status` for counts across every state, `list --state
  <s>` for the contents of one. First-time users who reach for `gate
  list` to "see everything" get the right verb in one hop instead of
  reading `--help` twice. Schema entry gets the same clarification.
- **`gate review` warns on self-review.** When `--by` equals the
  request author, a `⚠ self-review` line prints to stderr. The review
  still lands (history may legitimately need self-annotations), but
  the Two-Persona Devil frame expects a different voice, and the
  warning makes the choice visible in the transcript instead of
  silently laundering it into YAML.

- **`gate boot` reports `content_root_health`.** boot payload
  gains `hints.content_root_health` with `malformed_count`, a
  per-area breakdown (`members` / `requests` / `issues` with
  totals and malformed counts), and a `fix_hint` naming the
  exact two commands to reach for when anything is malformed
  (`gate doctor` to inspect, `gate doctor --format json | gate repair --apply`
  to quarantine). Text output adds a corresponding warning
  block when `malformed_count > 0`; clean roots stay silent.
  Catches test leftovers and schema-drifted records in the
  orientation moment, so the recurring hydration warning on
  every subsequent verb becomes a named one-command fix
  instead of background noise. The malformed probe is wrapped
  in try/catch so a failing diagnostic can never break boot.

### Added
- **Message errors surface guild-flow hints.** Four error paths
  around `gate message` / `gate inbox` now name a concrete next verb
  instead of just rejecting:
  - `send --to <host>` → "hosts don't have inboxes; share a
    request / fast-track / issue instead, host can read via
    tail/voices".
  - `send --to <unknown>` → "not registered; `gate register --name
    <raw>` (or check the spelling)".
  - `inbox --for <host>` → "hosts observe via `gate tail` /
    `gate voices` / `gate list`, not their own inbox".
  - `inbox --for <unknown>` → register hint, same as send.
  Each is vertical-formatted (same shape as severity/verdict/lense)
  so the guidance is scannable. No domain change; existing
  substring assertions in downstream tests continue to match
  because the canonical phrase is preserved as a prefix.

### Added
- **`gate register` — one-shot member registration.** Writes
  `members/<name>.yaml` without the newcomer having to hand-author
  YAML, figure out the schema from `members.example/`, or risk a
  typo. Category defaults to `professional` (the right bucket for
  most agents), aliases accepted (`pro`, `prof`, `member` →
  `professional`, `assigned` → `assignee`, `try`/`tryout` →
  `trial`). `--dry-run` previews the YAML without touching disk,
  showing the canonical category so what you see is what gets
  written. Already-existing names fail loudly rather than silently
  overwriting. `--category host` is rejected — hosts are declared
  in `guild.config.yaml` directly, not registered at runtime.
  JSON output mirrors the write-response shape with
  `suggested_next: { verb: "boot", ... }` pointing the orchestrator
  at the next obvious step.
- **`assertActor` surfaces the register hint.** When an unknown
  actor is passed to `--from` / `--by` / `--executor` / etc, the
  error now includes `gate register --name <raw>` as a concrete
  way out. This is the onboarding loop's keystone: newcomers
  hitting the wall learn the one-command unlock from the error
  itself.
- **`MemberCategory` accepts aliases with a vertical-format error.**
  Same pattern as severity/verdict — interface-layer convenience,
  domain invariant unchanged. The rejection error walks the canonical
  set and the alias table in a scannable table and gently suggests
  "professional" as the default for most agents.
- **Concept doc gains "30-second first touch".** `docs/concepts-for-newcomers.md`
  now leads with the three commands a newcomer needs to exist in a
  content_root: `register` → `boot` → `fast-track`. Everything else
  is positioned as "what unlocks as you keep using it."
- **AGENT.md session-start block** now shows `gate register` as the
  first-time step before the recurring `boot` / `resume` loop, so an
  AI agent's first read of the quick reference includes the
  registration path.
- **`gate schema`** lists `register` as a first-class verb so LLM
  tool layers can invoke it without out-of-band knowledge.

### Added
- **`parseVerdict` accepts grammatical and muscle-memory aliases.**
  `approve`/`approved`/`pass`/`lgtm`/`yes` → `ok`,
  `concerned`/`concerning`/`worried`/`warn` → `concern`,
  `rejected`/`block`/`blocked`/`veto` → `reject`.
  Case-insensitive after trim. The canonical 3 values and the
  `Verdict` type are unchanged — interface-layer convenience for
  reviewers (especially AI agents) who reach for the grammatical
  adjective (`concerned`) before the noun (`concern`). Rejection
  error lists both canonical values and accepted aliases.
- **Concept map for newcomers.**
  [`docs/concepts-for-newcomers.md`](./docs/concepts-for-newcomers.md)
  — a 30-second mental map from Jira / Linear / ADR / PR review /
  Slack to the guild-cli vocabulary. Elevator pitch, "coming from"
  table, quick vocabulary list, core loop diagram, and the one
  thing most newcomers miss. `README.md` links this as the first
  stop before the command surface.

### Changed (onboarding ergonomics)
- **Layered documentation signposts.** The README now has a
  "How much of this do I need to read?" table naming every doc
  with the time cost and when it's enough. `AGENT.md` says
  upfront "you don't need to read all of this to be productive"
  and names which sections are essential. `docs/verbs.md` now
  opens with "you probably don't need this yet — come back when
  a verb surprises you." The intent is zero reading pressure at
  each layer; you keep going only if the value warrants it.
- **`suggested_next` description softened.** Schema and
  inline comments now make explicit that the field is a
  convenience hint for orchestrators — safe to ignore if you
  have other plans. The lifecycle does not demand progression
  along the suggested axis.

### Added
- **`parseIssueSeverity` accepts common aliases.** `medium`, `mid`,
  `crit`, `hi`, `lo`, and single-letter shortcuts (`l`/`m`/`h`/`c`)
  now normalize to the canonical 4 values. Matching is case-
  insensitive after trim. The canonical set (`low | med | high |
  critical`) is unchanged — this is interface-layer convenience for
  muscle memory from Jira/Linear/GitHub. The rejection error now
  lists both the canonical values and the accepted aliases so a
  first-time user who typed `medium` and got rejected learns the
  extension without reading source.
- **`parseLense` error points at `guild.config.yaml`.** When a
  domain-specific lense (`security`, `perf`, ...) is rejected
  because the config didn't opt into it, the error now names the
  exact extension path (`lenses:` in `guild.config.yaml`). The
  extension mechanism has always existed; this just surfaces it
  in the moment of friction.
- **`AGENT.md` documents domain-specific lenses.** Example
  `lenses: [..., security, perf, a11y]` with an explanation that
  the four defaults are meta-perspectives and domain lenses layer
  on top.
- **`gate boot` `hints` field — misconfigured-cwd detection.**
  boot payload gains `hints: { misconfigured_cwd, config_file,
  resolved_content_root }`. `misconfigured_cwd` is `true` iff no
  `guild.config.yaml` was found up the tree AND the fallback
  content_root is empty — the concrete signature of "wrong cwd",
  distinct from an intentional fresh start (config present, 0 data).
  Text output surfaces a fix hint with the resolved path. Purely
  additive to the boot payload contract. Motivation: AI agents
  reading `.mcp.json` often assume `GATE_CONTENT_ROOT` works for
  direct CLI invocation (it doesn't — only the MCP wrapper sets
  subprocess `cwd`), then hit cryptic "no such member" errors on the
  next verb. See `AGENT.md` § Troubleshooting.
- **`GuildConfig.configFile`.** New readonly field on
  `GuildConfig`: absolute path of the loaded `guild.config.yaml`, or
  `null` when `cwd` was used as a fallback root. Lets callers tell
  "fresh start" apart from "misconfigured cwd".

### Documentation
- **`AGENT.md` § Troubleshooting.** Walks through the "no such
  member" trap: `cwd` fallback semantics, that no config-resolution
  env var is read by the CLI as of v0.3.x, and three workarounds
  (`cd`, wrapper, symlink).

### Added (agent-first)
- **Pair-mode Layer 1 — `Request.with`.** `gate request` and `gate
  fast-track` accept `--with <n1>[,<n2>...]` to record dialogue
  partners during the formation of a request. Surfaces on `gate
  show` (`with: eris`), `gate voices` / `tail` (`authored (with
  eris)`), and `gate resume` prose ("shaped with eris" / 「eris と
  一緒に」). Partners go through the same actor validation as other
  `--by` / `--from` / `--executor` fields. Author-self is
  silently dropped from the list. Layers 2 (durable kinship on
  Member) and 3 (config policy) are intentionally deferred —
  they'll be added when real use surfaces the demand.
- **`gate resume` — picking up where the last session ended.** Reads
  the content_root from the actor's perspective and composes a
  restoration prompt: last utterance, last lifecycle step, open loops
  (executing / awaiting_execution / pending_review /
  unreviewed_completion), suggested_next, and a prose narrative. The
  prose is deterministic (no LLM call inside the tool) — templated
  from the same facts the structured fields carry. Requires
  `GUILD_ACTOR`; resume is inherently first-person.
- **`examples/agent-voices/` — a content_root where agents leave
  reflections.** Seed "survey" requests curated by a host; each agent
  adds `lense=user` reviews as voice on each theme. `gate voices
  <agent> --lense user` replays a single agent's arc across all
  themes. README is inside the directory; one quiet pointer in
  AGENT.md. Not linked from the top-level README — discovery is for
  agents who look.
- **`gate boot` — single-command session orientation.** Returns
  identity + status + tail + your recent utterances + inbox unread as
  one JSON payload. Replaces the three-verb `status`+`whoami`+`tail`
  recipe. `GUILD_ACTOR` is optional (global view if unset).
- **`--format json` on every write verb.** `request`, `approve`,
  `deny`, `execute`, `complete`, `fail`, `review`, and `fast-track`
  now return `{ok, id, state, message, suggested_next}`. The
  `suggested_next` field is derived deterministically from the
  post-mutation state so orchestrators can parse it straight into
  the next tool call. `suggested_next` is `null` at terminal states.
  Multi-host content roots omit `by` and list candidates in `reason`
  rather than silently nominating a host. Review suggestions
  intentionally omit `verdict` — rubber-stamping is the exact
  failure mode the Two-Persona loop exists to prevent.
- **`gate schema` — JSON Schema introspection.** Draft-07 catalogue
  of every verb's inputs and outputs. Primary consumer: LLM tool
  layers. A CI test (`schema drift`) pins the VERBS list against
  `index.ts` dispatch so silent drift is impossible.

### Added `YamlRequestRepository.save()` now
  writes via `.tmp-<pid>-<rand>-<basename>` + `rename()` so readers never
  observe a torn or partial YAML. Temp files are cleaned up on failure.
- **Optimistic lock on save.** `Request.loadedVersion` snapshots the
  total mutation count (`status_log.length + reviews.length`) at load
  time. If the on-disk total has grown before save, the repo throws
  `RequestVersionConflict` instead of overwriting. Catches both
  transition races (concurrent `approve`/`execute`) and review races
  (concurrent `addReview`, which does not touch `status_log`).
- **`gate deny` / `gate fail` accept `--note <s>` or `--reason <s>`** in
  addition to the legacy positional argument. Aligns muscle memory
  with `approve`/`execute`/`complete`.

### Changed
- **Closure notes have a single source of truth.** The domain no
  longer writes `completion_note` / `deny_reason` / `failure_reason`
  as separate Request fields; they are derived at `toJSON()` time
  from `status_log[-1].note`. External shape is unchanged — the
  top-level keys are still emitted for backward compatibility with
  consumers of the YAML / JSON output. **On next save, the status_log
  entry is authoritative**: if a legacy file has the two disagreeing,
  the top-level value is dropped. Hydration warns via `onMalformed`
  when disagreement is detected.
- **`host_names` are validated via `MemberName.of()`** at config-load
  time. Entries that were previously accepted but could collide with
  path-traversal, shell metachars, or reserved names now fail loudly
  with `Invalid host_names entry ...`.
- **`findById` now scans every state directory** and dedupes by total
  mutation count, so a file mid-transition (present under two dirs
  between atomic-write and old-file-unlink) deterministically returns
  the newer representation. The previous first-hit-wins behavior could
  return the stale pending/ file while the newer approved/ file also
  existed.
- **`gate` MCP (`mcp/gate_mcp.py`) stops mixing stderr into stdout.**
  `--format json` output is no longer corrupted by `[stderr] ...`
  suffixes. Stderr is forwarded to the host's stderr for observability.

## [0.3.0] — 2026-04-16

### Added
- **`gate status` verb** — agent orientation command. Returns
  pending/approved/executing counts, open issues, unread inbox, and
  last activity timestamp. Default output is JSON (agent-first);
  `--format text` for human-readable. Respects `GUILD_ACTOR` and
  `--for` for actor-scoped summaries.
- **Configurable lenses** via `guild.config.yaml`. The `lenses` field
  accepts a list of strings (e.g. `[devil, layer, cognitive, user,
  security]`). Defaults to the four built-in lenses when omitted.
  `parseLense()` validates against the configured set at runtime.
- **`gate repair` verb** — intervention layer paired with `gate doctor`.
  Consumes `gate doctor --format json` from stdin (or `--from-doctor <path>`)
  and either prints the proposed plan (default `--dry-run`) or executes it
  (`--apply`). Quarantine is the only action: malformed records
  (`top_level_not_mapping`, `hydration_error`, `yaml_parse_error`) are
  moved to `<content_root>/quarantine/<ISO-timestamp>/<area>/<basename>`.
  `duplicate_id` and `unknown` findings are no-op (data safety: automatic
  resolution risks data loss). `text` and `json` output formats. The
  `--apply` path is idempotent (already-moved sources are skipped, not
  errored). Path safety is enforced via `realpathSync` canonicalization
  on both content_root and source — symlink-escape is closed structurally.
  Closes `i-2026-04-15-0026` (partial: quarantine path; field-level patch
  repair tracked separately).
- `CHANGELOG.md` and `POLICY.md` — versioning promise and change history.
- **Doctor plugin system** via `guild.config.yaml`. The `doctor.plugins`
  field accepts a list of ES module paths. Each plugin exports a function
  returning additional `DiagnosticFinding[]`. Plugin errors become
  findings (never crash doctor). Enables domain-specific health checks
  without modifying the core CLI.
- `guild --version` / `gate --version` (alias `-v`) — print `guild-cli <version>` and exit 0.

### Changed (breaking — application port)
- **`OnMalformed` port signature** widened from `(msg: string) => void`
  to `(source: string, msg: string) => void`. The `source` is the
  absolute filesystem path of the offending file. This makes the
  intervention contract type-enforced rather than convention-pinned
  (previously the path was carried as a prefix of the message string).
  All three YAML repositories (`YamlMemberRepository`,
  `YamlRequestRepository`, `YamlIssueRepository`) now pass the absolute
  source path explicitly. `DiagnosticFinding` gains a new
  `readonly source: string` field, surfaced in `gate doctor` text/json
  output. Closes `i-2026-04-15-0025`.

### Changed (breaking — output format)
- **`gate voices` default output is now JSON**, matching `gate show`.
  Text output is still available via `--format text`. This aligns with
  the agent-first design: machine-readable by default, human-readable
  on request. Existing scripts that parse `gate voices` text output
  must add `--format text` to preserve behavior.

### Changed
- **Sequence ceiling**: Request and Issue ids now use 4-digit
  sequences (`YYYY-MM-DD-NNNN` / `i-YYYY-MM-DD-NNNN`), raising the
  per-UTC-day ceiling from 999 to 9999. The loader accepts **both**
  3- and 4-digit forms; existing content roots continue to work
  without migration. Generation always produces 4 digits. Regex
  patterns in `chain` cross-references, file filters, and
  `nextSequence` parsers all widened accordingly.

### Changed (internal)
- **Refactor**: `src/interface/gate/index.ts` split into `handlers/{request,review,read,issues,messages}.ts` plus `handlers/internal.ts` for shared helpers. `index.ts` is now 158 lines (was 1206) and contains only routing + HELP. Behavior unchanged; `formatReviewMarkers` and `computeReviewMarkerWidth` are re-exported from `index.ts` for backward-compat with existing test imports.
- **Data-loss visibility**: malformed YAML records (requests, issues, members, and individual `status_log` entries) no longer disappear silently. `GuildConfig` now carries an `onMalformed: (msg: string) => void` callback, defaulting to `process.stderr.write("warn: ...")`, and every hydrate code path routes skipped records through it with source path + id hint + cause. Tests inject a collecting spy; production users see warnings on stderr.

### Infrastructure
- `.github/workflows/ci.yml` — typecheck + test on Node 20 / 22.

## [0.1.0] — 2026-04-14

Initial alpha release. Extracted from the private THS (Three Hearts Space)
eris-guild instance and generalized into a public OSS for AI-agent-first
team coordination.

### Added — Core (`guild` CLI)
- Member management: `guild new | list | show | validate`.
- Categories: `core | professional | assignee | trial | special | host`.
- `host_names` config support — non-member actors allowed in `--from` / `--by`.

### Added — Requests (`gate` CLI)
- Request lifecycle: `request → approve → execute → complete` (with `deny` / `fail` branches).
- `gate request --from --action --reason --executor --target --auto-review`.
- `gate fast-track` — one-shot `pending → completed` for self-contained work.
- `gate show <id> --format json|text` with time deltas on status/review entries.
- `gate list --state <s>` and `gate pending` with `--for / --from / --executor / --auto-review` filters.

### Added — Reviews (Two-Persona Devil)
- `gate review <id> --by <m> --lense <devil|layer|cognitive|user> --verdict <ok|concern|reject>`.
- Review comment via positional arg, `--comment <s>`, or `--comment -` for STDIN.
- Review markers in `gate list` / `gate pending` (`✓ ! x ?` per lens).

### Added — Reading
- `gate tail [N]` — unified recent activity stream across all actors.
- `gate voices <name> [--lense --verdict --limit --format]` — cross-cutting actor history.
- `gate whoami` — session-start orientation via `GUILD_ACTOR` env var.
- `gate chain <id>` — one-hop cross-reference walk across free-text fields.

### Added — Issues
- `gate issues add | list | resolve | defer | start | reopen`.
- `gate issues promote <id>` — lift issue into new request with cross-reference.
- Issue state machine: `open ↔ in_progress ↔ deferred → resolved`.

### Added — Messages / Inbox
- `gate message --from --to --text` — per-recipient inbox append.
- `gate broadcast --from --text` — fan-out with delivery report.
- `gate inbox --for <m> [--unread]` — read with unread filtering.
- `gate inbox mark-read [N]` — audit-stamped read marker.

### Added — Interactive identity
- `GUILD_ACTOR` environment variable — default for `--from / --by / --for`.
- Explicit flags always override; `GUILD_ACTOR= <cmd>` for one-off unset.
- stderr hint on read-side commands when env var fills in `--for`.

### Added — Infrastructure
- YAML-only persistence. No daemon, no database, no network.
- Path safety via `safeFs` (base directory resolve + symlink rejection).
- Text sanitization (ASCII control strip, 4 KB action/reason cap, 2 KB issue cap).
- DoS caps: 1000 directory listings, 50 reviews per request, 100 status log entries per request, 500 inbox messages per member.
- `RequestRepository.listAll` with pure `dedupeRequestsById` for concurrent-transition TOCTOU mitigation.

### Added — Documentation
- Comprehensive README with bilingual (EN/JP) AI-agent onboarding section.
- `examples/dogfood-session/` — full content_root generated by this tool tracking its own implementation.
- `SECURITY.md` — threat model, enforced invariants, known hardening items.

### Known limitations (documented in README)
- `--auto-review` is not auto-dispatched; completion prints a ready-to-run review template.
- No dashboard generator (raw YAML is the UI).
- No state-transition lock; `saveNew` is race-safe (O_EXCL) but `save` has last-writer-wins semantics.
- Sequence ceiling 999 per UTC day (ID format `YYYY-MM-DD-NNN`).

[Unreleased]: https://github.com/eris-ths/guild-cli/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/eris-ths/guild-cli/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/eris-ths/guild-cli/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/eris-ths/guild-cli/releases/tag/v0.1.0
