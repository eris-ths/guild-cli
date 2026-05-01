# Changelog

All notable changes to `guild-cli` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to the versioning policy described in [POLICY.md](./POLICY.md).

## [Unreleased]

### Fixed
- **`gate boot --format text` surfaces `content root: <path>
  (config: <path>)` when the situation is surprising.** Sibling
  to the PR #108 register-notice fix: closes the silent parent-
  config-pickup gap on the READ side. Pre-fix, `gate boot --format
  text` showed neither `config_file` nor `resolved_content_root`
  (both fields existed in the JSON envelope but the text
  rendering omitted them), so an agent who ran boot for
  orientation got no path signal even when the cwd was a subdir
  of an active guild and gate had silently walked up to a
  parent's `guild.config.yaml`.

  Post-fix, the orientation block emits one line **only when the
  situation is surprising** — voice budget is preserved by
  staying silent at the alignment case (cwd === resolved
  content_root, config present and discovered). Two trigger
  cases:

  - **Subdir of an active guild** (`cwd != resolved_content_root`)
    — `content root: /abs/path (config: /abs/path/guild.config.yaml)`
  - **No config found, cwd used as fallback** (`config_file ===
    null` and there's data) — `content root: /abs/path (config:
    none — cwd used as fallback root)`

  Suppressed when `misconfigured_cwd` already fired (no-config +
  no-data, the bigger warning takes over) so the disclosure is
  surfaced exactly once. JSON envelope gains `cwd_outside_content_root`
  boolean for orchestrators reading the structured contract.
  Phrasing matches PR #108's `(config: ...)` segment for cross-
  verb recognition. Devil-reviewed (`2026-05-01-0001`/`0002`);
  v2 absorbed the voice-budget concern (D1) by gating the
  emission on the surprising cases.

### Changed
- **`gate voices` / `gate tail` JSON: `request_id` / `invoked_by` /
  `completion_note` / `deny_reason` / `failure_reason` (was:
  `requestId` / `invokedBy` / `completionNote` / `denyReason` /
  `failureReason`).** The voices stream is the project's
  highest-traffic JSON surface and was the lone camelCase outlier;
  every other JSON surface (`gate show`, `gate inbox`, `gate
  status`, `gate register` JSON envelope, `gate boot.hints`, etc.)
  was already snake_case (`created_at`, `read_at`, `display_name`,
  `auto_review`, `status_log`, `where_written`, `config_file`).
  The mismatch made cross-tool consumers carry a translation layer
  for one stream only.

  Single-cycle cut per 0.x policy (same shape as the `displayName
  → display_name` rename in PR #102) — no dual-emit phase. Fresh-
  agent dogfood (post-PR #107) surfaced the inconsistency; devil-
  reviewed (`2026-05-01-0001`/`0002`) to confirm scope: rename
  the TS fields too so the text-path readers (`renderUtterance`
  in `voices.ts`, the `tail` summary block in `boot.ts`, the
  bilingual `resume.ts`) stay consistent with the JSON. The
  `gate schema` declarations did not advertise the voices output
  shape, so no schema update was needed.

  Downstream JSON parsers (MCP wirings, ad-hoc scripts) that
  read these fields must update key names. Records on disk are
  unchanged — this is purely an output-shape rename, not a
  storage migration.

### Fixed
- **`gate register` surfaces the absolute path it wrote, on both
  stderr (humans) and JSON (orchestrators).** Closes the silent
  parent-config-pickup gap a fresh-agent dogfood surfaced. Pre-
  fix, running `gate register --name newcomer` from a subdir of
  an active guild silently walked up the tree, found the parent's
  `guild.config.yaml`, and wrote `<parent>/members/newcomer.yaml`
  with no signal — the agent had no clue their YAML landed in
  someone else's repo. Same gap hit no-config-found cases (cwd
  used as the implicit content_root).

  Post-fix, `gate register` emits one stderr notice on success:
  ```
  notice: wrote /abs/path/members/<name>.yaml (config: /abs/path/guild.config.yaml)
  ```
  When no config was discovered the second segment becomes
  `config: none — cwd used as fallback root`, naming the implicit
  default explicitly. The JSON success envelope gains
  `where_written` (absolute path of the saved file) and
  `config_file` (absolute path of `guild.config.yaml` in use, or
  `null`) so MCP consumers parse structured fields rather than
  scraping stderr.

  Symmetric on `--dry-run`: the preview header now shows the
  absolute path (was: relative `members/<name>.yaml`) and the
  stderr notice fires with `would write` (not `wrote`) so the
  preview is not less honest about location than the real write.
  Notice does NOT fire on error paths (collision, host-name
  reservation, validation) — pinned by test. Devil-reviewed
  (`2026-05-01-0001`/`0002`); v2 absorbed the JSON-contract,
  dry-run-symmetry, and error-boundary concerns.

- **`gate doctor` surfaces unrecognized .yaml files and unexpected
  subdirectories under `requests/`.** Pre-fix, `listByState`'s regex
  filter (`^\d{4}-\d{2}-\d{2}-\d{3,4}\.yaml$`) silently dropped
  off-pattern entries — a `bad.yaml` in `requests/pending/`, a
  `2026-05-01-7.yaml` (wrong digit count), an `oops-dir/`
  subdirectory under `<state>/`, or even a properly-named
  `2026-05-01-9999.yaml` placed at `requests/` root (wrong directory
  level) — all stayed there forever and `gate doctor` reported the
  root as clean. Two new finding kinds: `unrecognized_file` (off-
  pattern .yaml in any record location) maps to quarantine in
  repair (gate ignores them anyway; moving to `quarantine/` is safe
  and reversible). `unrecognized_directory` (subdir under `<state>/`
  or non-state directory at requests/ root) maps to **no-op** —
  contents are unknown and quarantining a tree is invasive; the
  operator must inspect first. Boundary: only `.yaml` files and
  directories are flagged; `notes.txt`, `README.md`, `.gitkeep`
  and other repo artifacts are intentionally ignored. Devil-
  reviewed (`2026-05-01-0001`/`0002`).

- **`gate doctor` extends the unrecognized-file scan to `issues/`
  and `members/`.** Same shape of fix as the requests-side scan,
  for the same class of bug. Pre-fix, an `i-bogus.yaml` in
  `issues/` (typo'd id), a capitalised-prefix `I-2026-05-01-0001.yaml`,
  or — most painfully — an `Alice.yaml` in `members/` (uppercase
  first letter) were silently dropped by each repository's listAll
  regex (`^i-\d{4}-\d{2}-\d{2}-\d{3,4}\.yaml$` for issues,
  `^[a-z][a-z0-9_-]{0,31}\.yaml$` for members) and `gate doctor`
  reported a clean root while the member was missing from `gate
  list`. Now each off-pattern `.yaml` surfaces as
  `unrecognized_file` (→ quarantine in repair) and any
  subdirectory under `issues/` or `members/` surfaces as
  `unrecognized_directory` (→ no-op in repair, contents unknown
  and quarantining a tree is invasive). The four common
  member-name typos covered explicitly by tests: uppercase first
  letter, leading digit, leading underscore, name >32 chars.
  Boundary unchanged: only `.yaml` files and subdirectories are
  flagged; `notes.txt`, `README.md`, `.gitkeep` ignored.

  Internal cleanup absorbed (devil-review concern D1 from
  `2026-05-01-0001`): each repo now exports a single
  `*_FILE_PATTERN` constant that both `listAll` (filters records)
  and `listUnrecognizedFiles` (surfaces non-matches) consume, so
  the two paths cannot drift. Pre-fix, `YamlRequestRepository`
  duplicated the same regex literal across two methods — latent
  drift bug surfaced by the design sandbox and fixed at the same
  time. The shared port type renamed `UnrecognizedRequestFile` →
  `UnrecognizedRecordEntry` and moved to its own module
  (`src/application/ports/UnrecognizedRecordEntry.ts`); 5
  callsites updated mechanically. Devil-reviewed
  (`2026-05-01-0001`/`0002`).

### Deferred
- **Cross-area unrecognized-file scan.** A file with the wrong
  area's pattern sitting in the wrong area (e.g., an
  `i-2026-05-01-0001.yaml` left under `members/`, or
  `alice.yaml` left under `issues/`) is still invisible because
  each scan only walks its own area and only flags files that
  don't match its OWN pattern. The misplaced file matches the
  member pattern so the issues-area scan ignores it, and vice
  versa. Out of scope for this PR — the cross-area decision
  depends on whether such files should auto-relocate or just be
  flagged, which is a policy choice this PR doesn't have a basis
  for. Recorded so a future reader who hits "I have an
  i-prefix file in members/ and doctor doesn't see it" finds the
  trail. Devil-reviewed concern D3 from `2026-05-01-0001`.

- **Voice calibration: `verdict=concern + state=failed` counts as
  aligned.** The source-code header in `src/interface/gate/voices.ts`
  documented v1 alignment rules including
  `verdict=concern + state=failed → aligned (you flagged it, it
  broke)`, but the implementation had `// verdict === 'concern'
  intentionally excluded` and dropped ALL concern verdicts from
  both counts. Reviewers who used `concern` as their primary signal
  got zero calibration credit and registered as `uncalibrated`
  forever. Doc-code drift; the code now matches the documented
  rules: `concern + failed → aligned`, `concern + completed → soft`
  (excluded). The `reject + completed → overruled` case keeps its
  existing "counted as missed" semantic, and a comment now names
  the choice (the alternative — "the risk you flagged was
  reviewed and held" — isn't separately observable from the record
  alone, so we pick the conservative work-as-evidence read).
  Devil-reviewed (`2026-05-01-0001`/`0002`).

- **`gate schema`: voices entry declares `--with-calibration`** with
  a description that names the JSON-only semantic honestly: the
  flag opts into the `{utterances, calibration}` JSON object shape
  (default: bare array), but text mode emits the calibration footer
  regardless of this flag. Pre-fix the runtime accepted the flag
  via `KNOWN_FLAGS` but the schema didn't declare it, and the
  text-mode behaviour was undocumented — fresh agents reading the
  schema saw an undocumented flag and a hidden text-mode override.

- **`gate review`: empty editor body aborts with a context-aware
  error.** Pre-fix, when the user opened the editor (no
  `--comment`/positional/stdin) and saved without writing,
  `readCommentViaEditor` returned an empty string and the caller's
  generic "review comment is required (use --comment <s>, …, or
  run interactively so $EDITOR opens)" error fired — but the
  "run interactively" hint was misleading because the user had
  just done so. Post-fix the editor flow throws its own message:

      editor returned an empty review body; aborting. Re-run and
      write content above the scissors line, or use --comment /
      --comment - / a positional.

  Surfaces the empty effort at the layer that produced it; matches
  `git commit`'s "empty message aborts" semantic. The function
  docstring (which already named this throw, but pre-fix the
  implementation only honored the editor-failure cases) is now
  honest. Devil-reviewed (`2026-05-01-0001`/`0002`); the user-
  facing message dropped its "matches git commit behavior"
  rationale — that justification belongs in the source comment,
  not in the recovery instructions.

- **`gate schema` declares `dry-run` on every write verb that
  accepts it.** Pre-fix the schema entries for approve / deny /
  execute / complete / fail / review / thank did NOT declare
  `dry-run` as an input property — so MCP wirings reading `gate
  schema` saw a tool surface strictly less capable than the
  runtime (which accepted `--dry-run` via KNOWN_FLAGS). `register`
  declared it but as a string; the parser treats it as a boolean
  flag with optional `=true`/`=false` suffix. Now all eight verbs
  share a single `dryRunField` declaration (`{type: 'boolean'}`)
  pointing at the preview-envelope contract. Fresh-agent dogfood
  surfaced; devil-reviewed (`2026-05-01-0001`/`0002`) to extend
  the fix to register so the asymmetry doesn't just move.

- **`gate <verb> --dry-run --format text` emits a one-line stderr
  notice naming why the format is fixed.** The dry-run envelope
  (dry_run / verb / would_transition / preview) has no useful
  text rendering, so stdout stays JSON regardless of `--format`.
  Pre-fix: silent JSON when `--format text` was passed. Post-fix:
  `# --dry-run preview is structured (json envelope); --format
  text would lose dry_run/verb/would_transition.` Suppressed for
  `--format json` (pipelines stay clean).

### Deferred
- **`--dry-run` coverage on creation/annotation verbs.** Ten verbs
  do not yet support the preview envelope: `request`, `fast-track`,
  `message`, `broadcast`, `issues add`, `issues note`,
  `issues start`/`defer`/`resolve`/`reopen`, `issues promote`. The
  help text scopes "any write verb above" to the
  approve/deny/execute/complete/fail/review/thank set, so the
  current state is asymmetry-by-design rather than a bug; expanding
  to the creation/annotation set requires either handler-side
  preview construction or use-case-side dry-run flag plumbing.
  Recorded here so a future reader who hits `gate request --dry-run:
  unknown flag` finds the trail rather than silence.

### Changed
- **Member YAML: `displayName` → `display_name` on save.** Aligns the
  one camelCase field on disk with the rest of the project's
  snake_case convention (`auto_review`, `read_at`, `status_log`,
  `created_at`, `invoked_by`). The hydrate path
  (`YamlMemberRepository`) already accepts both forms; new writes
  always use snake_case. Existing member YAMLs in users'
  content_roots keep loading. Bundled fixtures
  (`examples/quick-start`, `examples/dogfood-session`,
  `examples/agent-voices`) migrated mechanically. Single-cycle cut
  per 0.x policy — no dual-emit phase. Devil-reviewed
  (2026-05-01-0001/0002).

### Added
- **`gate whoami` surfaces `display_name`.** When a member YAML
  carries a `display_name`, the orientation line now reads
  `you are noir — Noir (Critic) (member)` rather than the pre-fix
  `you are noir (member)` which hid the chosen presentation. Em-
  dash separator follows the pattern other surfaces use to compose
  name/label pairs; the trailing role-in-parens is unchanged. When
  no display_name exists, the line stays in its original concise
  form.

- **`gate inbox --format json` + self/inactive message advisories.**
  Three friction points on the messages surface a fresh-agent
  dogfood surfaced. (1) `gate inbox --format json` now emits an
  array of inbox-entry objects with snake_case keys
  ({from, to, type, text, at, read, read_at?, read_by?,
  invoked_by?, related?}). Optional fields are OMITTED when
  undefined (matches `gate show` JSON convention). (2)
  `gate message --from X --to X` (self-message) emits a stderr
  notice — same shape as the existing self-approve notice. The
  act is allowed and recorded; the writer sees the edge they
  crossed. (3) `gate message --to <inactive>` emits a stderr
  notice naming the consequence ("the message landed in their
  inbox but they may not be reading it"). `gate broadcast`
  already filters inactive recipients; the DM path was silent —
  asymmetric. The notice closes the asymmetry without making a
  policy choice (deliver-or-block) the PR doesn't have a basis
  for. Devil-reviewed (`2026-05-01-0001`/`0002` in design
  sandbox); v2 absorbed phrasing trims and the omit-when-
  undefined JSON shape rule.

- **`gate issues list` JSON output + `--state all` + bare-issues
  hint.** Closes four discoverability gaps a fresh-agent dogfood
  surfaced. (1) `--format json` now emits an array of nested issue
  objects (notes preserved as a sub-array, not flattened as in text
  format). (2) `--state all` returns every state in one call;
  previously a reader had to invoke list four times. (3) When
  `--state` is omitted, a stderr hint discloses the implicit
  open-only filter and names the open-vs-active distinction with
  `gate status`'s count: `# filtered to state=open; status counts
  open+in_progress (active) — --state to override`. (4) A bare
  `gate issues` (no subcommand) used to silently fall through to
  list; it now emits a short hint at the most-common subcommands
  and exits 1, mirroring how `gate list` handles missing `--state`.
  The list semantics (worklist = open) and the status semantics
  (triage = open+in_progress) intentionally differ — the difference
  is exposed at the surface that produces the count, not papered
  over by aligning them. Devil-reviewed
  (`2026-05-01-0001`/`0002` in design sandbox).

- **`lore/principles/08-voice-as-doctrine.md` + voice-budget audit.**
  Names the principle that the tool's prose — `suggested_next.reason`,
  schema descriptions, footers, finding messages — is the running
  embodiment of lore, the substrate by which 02 (advisory not
  directive), 03 (legibility costs), and 07 (perception not judgement)
  reach readers who do not open `lore/`. The companion test
  `tests/interface/voiceBudget.test.ts` enumerates named pedagogical
  phrases ("all first-class", "DETECTOR, not an enforcer", "advisory —
  override freely", and four others), each with a budget and an
  allowed-files list. New occurrences fail the test until
  `VOICE_BUDGET` is updated with rationale in the same commit. The
  test is a detector for proliferation; paraphrase escapes it
  (LLM-difficult to detect verbatim) and that limitation is named in
  the test header. `CONTRIBUTING.md` (new) documents the workflow.
  No source-code behavior changes — this is a discipline added at
  the CI surface, not the runtime surface.
- **`gate unresponded` (read verb).** Surfaces concern/reject
  verdicts on the actor's authored or pair-made requests that have
  no follow-up record yet. Thin wrapper over the same
  `UnrespondedConcernsQuery` that drives `gate resume`'s concerns
  surface, so the two cannot diverge. Default actor is GUILD_ACTOR;
  `--for <m>` and `--max-age-days <N>` override. Naming aligns with
  the underlying detector's "unresponded" semantic — explicitly NOT
  `gate concerns` (which would suggest "all concerns" rather than
  "concerns without follow-up"). The detector is deliberately coarse
  (existence-only follow-up detection); `gate chain <id>` walks the
  actual references when the reader wants to verify whether a
  follow-up addresses anything specific. Surfaces the gap that bit
  first-time agents: a `concern` verdict on a completed request was
  not visible from any read path short of re-running `gate resume`.
  (refines 2026-05-01-0003)

- **`gate show` adds a concern marker line.** A binary existence
  signal — `no concerns recorded` / `concern recorded — walk gate
  chain ...` — sits next to the existing `chain hint` line.
  Existence-language deliberately, NOT a count: counting ("3
  concerns, 1 follow-up") would invite the reader to play a "drive
  the number down" game (principle 03 — performance-for-the-record).
  The original design called for a 3-state marker (concern + inbound
  / concern + no inbound / no concerns); resolving inbound presence
  at show time would require an async repository scan, so the
  shipped form punts that resolution to `gate chain <id>` (named
  inline in the marker text). The reader gets the same perception
  affordance with one extra command rather than via formatRequestText
  becoming async.

- **`gate boot` adds `verbs_available_now.requires_other_actor`.**
  A sibling array to `actionable` (which keeps its existing flat
  shape — additive change). Each entry names `{verb, id, candidates,
  reason}`: a verb that exists on the actor's record but cannot be
  dispatched by them as themselves. Surfaces blockers (e.g. "your
  pending request needs approval by host X") so the actor sees WHY
  their queue isn't moving without parsing `suggested_next` prose.
  `candidates` is a list, not a single name, so a content_root with
  N hosts (or zero) doesn't have to embed a "first host" assumption
  in the payload. The host-self case is filtered out (a host who
  authored a pending request sees it under `actionable` via
  pending-as-executor, not under `requires_other_actor`).

- **`SuggestedNext.actor_resolved: boolean`.** New field on the
  write-response, boot, and resume `suggested_next` payloads. True
  iff `args.by` is absent or matches the calling actor (GUILD_ACTOR);
  false when the suggestion names a different actor. Lets an
  orchestrator branch (escalate / hand off vs. dispatch as self)
  without parsing the verb's `--by` against the env. Hint, not gate
  — the underlying verb still validates `--by` at the boundary.
  Schema description names the discipline so a reason-skipping loop
  is structurally redirected.

- **Concern advisory on completed-with-concern reviews.** When a
  completed request carries a `concern`/`reject` review (and its
  auto-reviewer, if any, has recorded), `suggested_next` returns a
  `chain` walk advisory rather than null: verb is read-only (`chain`)
  to avoid embedding a dispute-resolution flow in the tool's voice;
  reason names follow-up paths AND explicitly lists "leaving as-is,
  conversing it out, or letting it fade — all first-class." The
  absence of action stays structurally legitimate. Replaces the
  prior null-after-review behavior for the concern case only — `ok`
  verdicts still close the arc cleanly with `null`.

- **`gate transcript` ends with a `Concerns recorded` section.**
  Bare enumeration of `concern`/`reject` verdicts in the request,
  pointing at `gate chain <id>` for reference resolution. No
  status language ("still open", "addressed by"), no severity —
  the tool surfaces existence; status judgement stays with the
  reader (principle 07).

- **`FsInboxNotification.post` / `markRead` retry once on
  `InboxVersionConflict`.** When a concurrent writer advances the
  on-disk version between our read and the CAS check, the first
  attempt throws; the retry re-reads the now-advanced file and
  commits on top. Safe because post is append-only (order may
  shift but side-effects don't duplicate) and markRead is
  idempotent (already-read entries stay read). Two consecutive
  conflicts still bubble up so a three-or-more simultaneous-writer
  scenario surfaces to the caller instead of looping forever.
  Closes devil's C4 on hiroba `2026-04-22-0002`. (PR #84)

- **Issue repository now uses atomic write + optimistic-lock CAS.**
  `YamlIssueRepository.save` writes via `writeTextSafeAtomic` and
  rejects concurrent mutations with a new `IssueVersionConflict`
  (parallel to `RequestVersionConflict` and `InboxVersionConflict`).
  Closes the asymmetry where Request and Inbox were locked but Issue
  was last-writer-wins — which had self-defeated the state_log
  append-only invariant when two `gate issues resolve / note` calls
  raced. Version counter = `state_log.length + notes.length`
  (monotonic, append-only domain operations). Legacy issues still
  hydrate cleanly; the first save after upgrade follows the new path.
- **`gate repair` and `gate doctor` join the strict-flag rejection
  set.** Typos like `gate repair --aply` (which used to silently
  stay in dry-run) or `gate doctor --summry` (which used to show
  the full report instead of the summary) now error with the valid
  flag list. Brings these two verbs into parity with the write-verb
  suite shipped earlier.

### BREAKING
- **`gate issues resolve` / `defer` / `start` / `reopen` now require
  `--by <m>` (or `GUILD_ACTOR`).** Issue state transitions now append
  to a `state_log: [{state, by, at, invoked_by?}]` array (parallel to
  Request's `status_log`), and the transition cannot be recorded
  without knowing who performed it. Migration: add `--by <name>` to
  any scripted issue state-transition invocation; `GUILD_ACTOR`
  continues to work as fallback. `Issue.setState(next)` →
  `Issue.setState(next, by, invokedBy?)` at the domain level;
  `IssueUseCases.setState(id, state)` → `setState(id, state, by,
  invokedBy?)`. Legacy issue YAML (no `state_log`) hydrates cleanly
  as `[]` so existing records open fine — the audit trail starts
  from the first post-upgrade transition. (PR #81)

### Added
- **Issue state transitions now produce an append-only `state_log`.**
  Every resolve / defer / start / reopen records one entry
  `{state, by, at, invoked_by?}` (mirrors Request `status_log`), max
  100 entries per issue. Forensics for flapping (`open → resolved →
  open → resolved`) previously collapsed to only-the-final-state;
  state_log preserves the transition history. Empty arrays are
  omitted from `toJSON` so byte-identical YAML output survives
  issues that haven't transitioned. (PR #81, Sec H3)
- **Strict unknown-flag rejection extended to all write verbs.**
  `rejectUnknownFlags` (previously opted-in by `gate tail` only)
  now runs in every write verb: `register`, `request`, `approve`,
  `deny`, `execute`, `complete`, `fail`, `fast-track`, `review`,
  `thank`, `message`, `broadcast`, `inbox`, `inbox mark-read`, and
  all `issues` subcommands. Typos like `gate register --catgeory X`,
  `gate request --executr noir`, `gate thank --reasn "..."` now
  error with a list of valid flags instead of silently doing the
  wrong thing. (PR #81, Sec H1)
- **Inbox writes are atomic with optimistic-lock (`InboxVersionConflict`).**
  `FsInboxNotification.post` and `markRead` now use
  `writeTextSafeAtomic` and maintain a monotonic `version: N`
  counter for compare-and-swap. Concurrent writers that would
  previously last-writer-wins (silently dropping a message or a
  read flag) now surface an `InboxVersionConflict` the caller can
  retry. Exported from `application/ports/NotificationPort.ts`
  alongside the existing `RequestVersionConflict`. Legacy files
  without `version` hydrate as 0 so first post-upgrade save
  proceeds without a false conflict. (PR #81, Sec H2)
- **Shared `sanitizeText` helper at `src/domain/shared/sanitizeText.ts`.**
  Replaces four hand-written near-duplicates (Request, Issue,
  Review, MessageUseCases). Options: `{maxLen, requireNonEmpty?,
  trim?}`. Behavior is preserved per call site (Review keeps its
  existing `trim: false` / `requireNonEmpty: false` drift
  intentionally, flagged as a named follow-up). New policy changes
  (e.g. emoji / BOM handling) can now land in one place instead
  of four. (PR #81, Refactor H1)
- **`actionableTransitions()` as single source of truth in boot.**
  `deriveBootSuggestedNext` and `deriveVerbsAvailableNow` both
  consume one predicate set (`executing-mine`, `unreviewed-mine`,
  `approved-for-me`, `pending-as-executor`) with declared priority,
  instead of hand-coding the same four predicates in each function.
  Byte-identical output; future state additions are guided by
  TypeScript's exhaustiveness check on `ActionableKind`. (PR #81,
  Refactor H2)
- **`gate show <id> --format text` now prints a chain-hint footer.**
  The footer scans `action` / `reason` / `completion_note` /
  `deny_reason` / `failure_reason` / `status_log[].note` /
  `reviews[].comment` for full-id references (`YYYY-MM-DD-NNN...`)
  and reports either `"chain hint: no outbound id references
  detected"` or the list of referenced ids. Read-time surfacing only
  — the write path is untouched, so writers stay free-form while
  readers can see at a glance whether `gate chain <id>` will return
  anything. Short-form `(0004)` is intentionally not detected
  (that's the case the hint is warning about). Self-ids are
  excluded. See also the expanded paragraph in
  [`docs/verbs.md`](./docs/verbs.md#chain-cross-reference-walks). (PR #72)
- **Strict unknown-flag rejection helper, with `gate tail` as the
  pilot caller.** `rejectUnknownFlags(args, known, verb)` lives in
  `src/interface/shared/parseArgs.ts`. Verbs opt in individually;
  `gate tail` now errors with a clear message (and lists the valid
  flags for the verb) instead of silently ignoring a typo like
  `gate tail --from noir`. Other verbs migrate in follow-up PRs —
  the opt-in model is deliberate so existing invocations don't break
  en masse. (PR #73)

### Changed
- **README minimized; the repo's top-level surface is the entrance,
  and the entrance should be small.** README dropped from 478 to ~96
  lines: the depth ladder + a one-line link to `lore/` are the load-
  bearing parts. The verb cookbook, configuration block, file-layout
  diagram, state-machine diagrams, "what this tool does NOT do" list,
  and tests-detail block were redundant against `AGENT.md` /
  `docs/verbs.md` and now defer to those files. Top-level git tree
  shrank from 22 to 18 entries: `POLICY.md` → `docs/POLICY.md`,
  `guild.config.yaml.example` + `members.example/` →
  `examples/quick-start/`, `scripts/run-tests.mjs` → `tests/run.mjs`.
  GitHub-conventional files (`README.md`, `LICENSE`, `SECURITY.md`,
  `CHANGELOG.md`, `.github/`) untouched. `lore/` stays at top so
  ls-ing the repo surfaces the load-bearing thinking next to the
  code, not buried under `docs/`. Doc / code refs follow the moves.

### Fixed
- **`save()` no longer throws spurious `RequestVersionConflict` when
  `reviews` carries non-object entries.** Class-closure follow-up to
  the prior `status_log` fix below. `hydrate()` silently drops review
  entries that aren't objects (a loose-shape input rare in normal
  write paths but possible from hand-edited or imported YAML); the
  earlier `readVersion()` patch only filtered `status_log`, leaving
  the same drift on `reviews`. Both arrays now share one
  `isObjectEntry` guard so the structural symmetry is visible at the
  call site, and adding a future skip rule on either side forces the
  corresponding filter here. Surfaced by a noir-lens devil review on
  the prior fix that asked whether "any hydrate skip rule ↔ counter
  mismatch" was closed as a class, not just at one site. Regression
  test injects a non-object review entry alongside a real one and
  verifies `addThank` + `save()` no longer raise `VersionConflict`.
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

## [0.2.0] — 2026-04-15

Stabilization pass: diagnostic/repair verbs, cross-platform fixes, and
the infrastructure to make 0.3.0's agent-first features possible.

### Added
- **`gate doctor` verb** — read-only diagnostic scan of the content_root.
  Reports malformed YAML (parse failures, hydration errors, top-level
  non-mapping), duplicate ids, and per-area totals. Text and JSON output
  formats. Closes `i-2026-04-14-0015`. (#14)
- **`gate repair` verb** — intervention layer paired with `gate doctor`.
  Consumes `gate doctor --format json` output and quarantines malformed
  records to `<content_root>/quarantine/<ISO-timestamp>/<area>/`. `--dry-run`
  (default) previews the plan; `--apply` executes. Idempotent — already-moved
  sources are skipped. Path safety via `realpathSync` canonicalization.
  Closes `i-2026-04-15-0025`, `i-2026-04-15-0026`. (#15)
- **`guild --version` / `gate --version`** (alias `-v`) — print
  `guild-cli <version>` and exit 0. (#9)
- `CHANGELOG.md` and `POLICY.md` — versioning promise and change history. (#8)
- `.github/workflows/ci.yml` — typecheck + test on Node 20 / 22. (#7)

### Changed
- **Sequence ceiling**: Request and Issue ids now use 4-digit sequences
  (`YYYY-MM-DD-NNNN` / `i-YYYY-MM-DD-NNNN`), raising the per-UTC-day
  ceiling from 999 to 9999. Loader accepts both 3- and 4-digit forms;
  generation always produces 4 digits. (#12)
- **`OnMalformed` callback**: `GuildConfig` now carries
  `onMalformed: (msg: string) => void`, defaulting to stderr. Every
  hydrate path routes skipped records through it. (#11)

### Changed (internal)
- **Refactor**: `src/interface/gate/index.ts` split into
  `handlers/{request,review,read,issues,messages}.ts` plus
  `handlers/internal.ts`. `index.ts` is now 158 lines (was 1206).
  Behavior unchanged. (#10)

### Fixed
- **Cross-platform**: Windows path separators, `EDITOR` fallback to
  `notepad` on win32, richer error messages with hints. (#21)
- **Diagnostic**: YAML parse errors now surface via `onMalformed`
  instead of silently skipping. (#17)
- **Sort**: Numeric-aware id ordering for mixed 3/4-digit sequences. (#13)

### Documentation
- README extracted verb deep-dives to `docs/verbs.md` (803→458 lines). (#16)
- README reflects 0.2.0 status and test surface. (#19)
- POLICY.md: MemberName ASCII-only rationale + diagnostic/repair
  partial stability. (#20)
- README: tighten redundancy, clarify scope and requirements. (#22)
- CI lockfile sync, version drift guard. (#23)

[Unreleased]: https://github.com/eris-ths/guild-cli/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/eris-ths/guild-cli/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/eris-ths/guild-cli/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/eris-ths/guild-cli/releases/tag/v0.1.0
