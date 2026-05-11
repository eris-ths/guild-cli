# Changelog

All notable changes to `guild-cli` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to the versioning policy described in [docs/POLICY.md](./docs/POLICY.md).

## [Unreleased]

### ⚠ BREAKING (JSON shape)

- **`executors` field in JSON / YAML changed shape for any mutated
  multi-executor request.** Prior to #294 the field serialized as
  a flat array of name strings: `"executors": ["a", "b"]`. After
  the first slice closure (or for any request created post-merge),
  the field serializes as an array of objects:
  `"executors": [{"name": "a", "status": "completed", "completed_at": "...", "note": "..."}, {"name": "b", "status": "pending"}]`.
  Records that have never seen a slice closure (legacy pre-#294
  files that are read-then-resaved without mutation) still emit
  the legacy flat shape — byte-stable round-trip is preserved by a
  sentinel-rule (`status: 'unknown'` on every entry collapses the
  serializer to the legacy form).

  **Migration for JSON consumers** (`jq` pipelines, dashboards,
  third-party scripts):

  ```diff
  - jq '.executors[]'
  + jq '.executors[] | (.name // .)'
  ```

  The same expression works against both legacy flat records and
  post-#294 structured records.

### Changed

- **Per-executor slice closure on multi-executor requests (closes #294 — PR-A2 schema migration)**
  ([#294](https://github.com/eris-ths/guild-cli/issues/294),
  design lock at [#304](https://github.com/eris-ths/guild-cli/pull/304)).
  `gate complete --by X` and `gate fail --by X` are now per-slice
  operations on multi-executor waves. Each executor's slice has its
  own `status` (`pending` / `completed` / `failed` / `unknown`) and
  `completed_at` stamp; the wave-level state transitions only when
  every assigned executor's slice is terminal (any-fail-wave-fail is
  the phase-1 default — PR-C will replace it with template-bound
  policy via #235 phase 2).
  - **Domain (Request entity)**: `executors` getter signature
    unchanged (`readonly MemberName[]`, 55+ existing call sites
    keep working). New surface: `executorRecords` getter, plus
    `executorStatus(name)` and `completeSlice` / `failSlice`
    methods. `Request.complete(by)` auto-routes to `completeSlice`
    when `hasExecutor(by)` is true; falls back to direct wave
    transition otherwise (pre-#294 record compat). Note: the
    design doc (#304) sketched a rename from `executors` to
    `executorNames`; PR-A2 declined to follow that and kept the
    existing getter intact to avoid 55+ call-site sweeps. Will
    revisit if a structural reason for the rename surfaces.
  - **Persistence**: byte-stable round-trip is preserved by a
    sentinel rule — when every executor record has `status:
    'unknown'` (= legacy hydrate of a pre-#294 record), the
    serializer emits the legacy flat array form
    (`executors: [a, b]`). Any structural mutation (a single
    `completeSlice` call) flips the record to structured-form
    output on the next save; the migration is one-way per the
    design doc.
  - **Hydrate tolerance**: three input shapes are accepted —
    structured array of `{name, status, ...}`, legacy flat
    `[name, name]`, single-string `executor: name`. The first two
    are tested via existing fixtures; legacy records that never
    re-save stay byte-identical forever.
  - **Interface (`gate complete` / `gate fail`)**: a slice-closing
    call that leaves other executors open emits `slice closed:
    <id> by <by>` plus a list of remaining open executors with
    their current status and a "next: each remaining executor
    must run `gate complete --by <name>` to terminate the wave"
    hint. When the call closes the last slice, the historical
    `completed: <id>` output is preserved.
  - **Typo safety (miki concern #1 from #304 review)**: if a wave
    has assigned executors and the `--by` actor is not among them,
    the verb refuses with exit 1 instead of silently stamping the
    wave terminal. Closes the multi-executor wave-fail-on-typo
    accident path.
  - **`gate wave-status` pivot**: reads structured form directly.
    Per-executor lines surface `[pending]` / `[completed]` /
    `[failed]` / `[?]` (legacy unknown). Witness-inference (v1)
    remains as the freshness fallback until #309 lands per-
    executor freshness.
  - 22 new tests across domain + interface layers; 1509/1509 pass.

- **Template registry — two-tier resolution with built-in templates shipped (closes #302)**
  ([#302](https://github.com/eris-ths/guild-cli/issues/302)).
  Wave-brief templates now resolve from two sources, with the
  user override always shadowing the built-in of the same name:
  1. **Built-in** — packaged with guild-cli at
     `<packageRoot>/templates/wave-brief/`. Five templates ship
     out of the box (`single-impl`, `parallel-impl`,
     `research-wave`, `verification`, `compare-and-ratify`) — a
     fresh install / public-repo clone now sees a populated
     `gate templates list` instead of an empty registry.
  2. **User override** — per-instance customization at
     `<content_root>/data/guild/templates/wave-brief/` (unchanged
     path). A file there with the same `template_name` as a
     built-in replaces the built-in entirely for that instance
     (no merge; override wins).
  - `gate templates list` (text) tags each entry with its source
    (`[built-in]` / `[content_root]`).
  - `gate templates list --format json` adds `source` per entry
    and `_meta.builtin_dir` / `_meta.builtin_exists`.
  - **Structural cleanup**: the previous one-off
    `data/guild/templates/wave-brief/` at the repo top — which was
    a `<content_root>` convention path masquerading as a tracked
    distribution asset — moves to `templates/wave-brief/` (a
    proper packaged asset). `package.json` `files:` adds
    `templates` so npm publish ships them. The top-level `data/`
    directory no longer holds tracked content.
  - Backwards-compatible: existing instances with content_root
    overrides keep working unchanged; the override path is
    unchanged and still wins precedence.

### Added

- **`gate flow-suggest` — advisory verb for picking a flow shape (closes #307)**
  ([#307](https://github.com/eris-ths/guild-cli/issues/307)).
  New read verb: `gate flow-suggest --severity <low|med|high> --area <s>
  [--scope <s>] [--format json|text]`. Maps the (severity, area, scope)
  tuple to a recommended flow — `fast-track`, `direct-pr`, or
  `full-request` — and returns the reason plus alternative options.
  Pure advisory: no substrate writes, no state. The rule engine lives
  in `application/request/flowSuggest.ts` so a future v2 layer
  (`guild.config.yaml` override) can wrap it without touching the CLI
  surface; v1 ships with the hard-coded default rules from the issue.
  Motivation: ErisMind dogfood surfaced friction where trivial typo
  fixes were getting routed through the full issue → agora → devil
  ceremony — `flow-suggest` lets the operator (human or agent) get a
  one-line "this is a direct PR" answer without re-deriving the
  trade-off each time.

- **`gate wave-status <id>` — per-executor in-flight slice status (closes #295)**
  ([#295](https://github.com/eris-ths/guild-cli/issues/295)).
  New read verb that composes per-executor view from existing
  substrate fields (witness notes + claim state + status_log
  timestamps) — no schema change needed for v1. Sibling of `gate
  boot`'s cross-request overlap surface (#234): boot is actor-axis
  cross-wave, wave-status is wave-axis cross-actor.
  - Works on any state (pending / approved / executing / completed /
    failed / denied).
  - Single-executor renders a compact one-line form so the verb is
    not useless for the common case.
  - Multi-executor renders a per-executor block with witness note +
    claim state + last attributable write.
  - **Age-threshold disambiguation** (per #295 acceptance):
    `< 5 min` suppresses any "no progress" warning (fresh wave —
    witnesses may simply be incoming); `5-30 min` neutral note;
    `≥ 30 min` no attributable activity surfaces `⚠ stale — no
    in-flight progress note recorded` — the ceremony-swarm failure
    mode (a wave with executors named who never landed any
    substrate-side activity).
  - Forward-compatible with #294: v1 uses witness-inference; when
    #294 ships structured `executors[].status`, this verb pivots to
    read that field directly without breaking the JSON shape.
  - `gate schema` lists the verb under `category: 'read'` with full
    input/output schema; the keys snapshot test surfaces the
    addition forward-compatibly.

### Fixed

- **`gate boot` now surfaces enrichment failures via `warnings: string[]`
  (combo C3 / silent-fallback-loses-signal)**.
  Pre-fix, four enrichment paths (issues count, inbox unread,
  unresponded concerns, content_root_health probe) caught their own
  errors silently — `// may not be configured — non-fatal` — so a
  broken issue repository or a partly-quarantined inbox passed
  through invisibly: `status.open_issues = 0` looked identical
  whether there were genuinely zero issues or the repo was unreadable.
  Devil's concern2 on PR #105 (agent-first-session 2026-04-16-0001)
  flagged this; 2026-05-10 dogfood (`substrate/agora/plays/eris-
  dogfood-0510/`) re-surfaced it. New `warnings: string[]` field on
  `BootPayload` (sorted into the keys snapshot per 0.x stability);
  each silent catch now pushes a descriptive single-line entry
  including `e.message`. Empty array = clean case (no extra noise).
  Text format adds a `⚠ N warning(s) raised...` block when non-empty
  with a one-line disclaimer naming which downstream values may be
  inaccurate. Three regression tests pin: clean-empty / broken-repo-
  surfaces / message-includes-error-detail.

### Added

- **hook bus extended for session-boundary events (#290 — closes #290)**
  ([#290](https://github.com/eris-ths/guild-cli/issues/290)).
  The Phase 1 hook bus (#259) was request-shaped only — `HookContext.request`
  was a non-optional `Request` and the event union covered only the six
  request-lifecycle verbs plus review. Phase 2 verbs (`gate rest` /
  `gate wake` / `gate farewell`, #261-#263) now fire `before:` / `after:`
  hooks via a new `ctx.sessionEvent: SessionEvent | undefined` field
  alongside the existing `ctx.request: Request | undefined`. Exactly one
  of the two is populated per invocation — picked by which verb fired
  the hook. The event union grew six entries (`before:`/`after:rest`,
  `wake`, `farewell`). A `before:` veto on a session-boundary event
  blocks the YAML write, so a vetoed `gate rest` leaves no record on
  disk (substrate untouched). The `after:` fires post-save with the
  final id allocated. Existing plugins that read `ctx.request.X`
  directly continue to work for their subscribed events; multi-axis
  plugins discriminate on which subject is populated. Migration
  guidance in `docs/POLICY.md` § "Hook subject migration"; updated
  `examples/plugins/hooks/audit-log.mjs` shows the branching pattern;
  `policy-no-self-approve.mjs` got a defensive null-check for
  forward-compat. Plugin schema doc updated with a `SessionEvent`
  reference section.

- **plugin schema doc drift detection (#283 — closes #283)**
  ([#283](https://github.com/eris-ths/guild-cli/issues/283)).
  New CI test `tests/docs/pluginSchemaDocSync.test.ts` enforces sync
  between `docs/plugin-schema.md` and the actual `Request` / `Review`
  class surfaces. Adding a `Request` getter without updating the doc
  fails CI with an actionable error pointing at the section to update;
  removing or renaming a getter without updating the doc fails the
  same way. Stale `r.X` references in the `extra.review` doc section
  are also caught. The doc carries an `## Intentionally undocumented
  Request getters` allowlist for internal-only getters
  (`loadedVersion` / `currentVersion` / `mutationSeq`); new getters
  must land in either the doc tables OR the allowlist — silently
  skipping is not allowed. Implementation reads the `.d.ts` emitted
  by `tsc` (no extra dependencies) and skips method calls (e.g.
  `request.toJSON()`) since the v1 contract is getter-only.

### Fixed

- **`gate fast-track` now fires lifecycle hooks (#279)**
  ([#279](https://github.com/eris-ths/guild-cli/issues/279)).
  Pre-fix, `reqFastTrack` called the use cases directly (create →
  approve → execute → complete) and skipped every handler-level hook
  fire. Audit-log plugins (`after:approve`, `after:execute`,
  `after:complete`) observed zero events for self-flow waves; policy
  plugins (`before:approve`, ...) were silently bypassed — the exact
  path those policies were designed to govern. Post-fix: each of the
  three sub-transitions runs its before/after hooks identically to
  the multi-step path. A before-hook veto aborts the chain and leaves
  the substrate in the pre-veto state (no synthetic "fast-track
  aborted" state — same contract as the multi-step path). Three new
  regression tests pin the fires + veto semantics. Discovered via
  dogfood walking `examples/plugins/`.

- **strict-mode review hydrate (#134 H2 hotfix)** — review records
  written under `gate.strict_lenses: true` (using a bundled devil
  catalog lense like `injection`) failed re-read by `gate show` /
  `gate list` because the hydrate path only knew the (narrower)
  `config.lenses` allowed-set. `Review.restore` now uses a permissive
  lense parser (`parseLenseLoose`): the allowed-set check fires only
  on fresh writes, not on re-reads. Records-outlive-writers — a
  historical record's lense was already validated at write time, and
  re-validating against a possibly-changed policy would erase the
  audit trail. This also closes a pre-existing latent bug where
  removing a lense from `config.lenses` would silently drop older
  reviews from list output.

### Added

- **opt-in strict lense vocabulary for `gate review` (#134 H2 — closes #134)**
  ([#274](https://github.com/eris-ths/guild-cli/issues/274)).
  New top-level `gate.strict_lenses: bool` config (default `false`,
  **permanently** opt-in). When `false`, gate review's allowed-lense
  set comes from `lenses:` in `guild.config.yaml` — byte-identical to
  pre-H2. When `true`, the allowed set is the unified devil
  `ComposedLenseCatalog` (bundled defaults + content_root extensions
  from G under `<content_root>/devil/lenses/*.yaml`). Composes with G:
  teams that registered `team-perf.yaml` / `team-a11y.yaml` etc. get
  gate-side vocabulary enforcement on the full custom catalog without
  touching devil's coverage discipline. `gate review --help` reflects
  whichever source is load-bearing for the run. Coverage gating
  (devil's "conclude requires every catalog lense touched") is NOT
  propagated — strict mode is vocabulary enforcement only. Default is
  permanently opt-in: we do not flip to `true` at v1.0 or any future
  cut.

- **per-content_root lense extension loader for devil-review (#134 G)**
  ([#134](https://github.com/eris-ths/guild-cli/issues/134)).
  `<content_root>/devil/lenses/<name>.yaml` now extends the bundled
  lense catalog. Each YAML file follows the same shape as `Lense.create`
  input (`name` / `title` / `description` / `ingest_sources?` /
  `delegate?` / `examples?`) and is loaded by `ComposedLenseCatalog`
  on top of `BundledLenseCatalog`.
  - **extend-only, hard-error on collision.** A name collision between
    a content_root extension and a bundled lense raises `LenseCollision`
    at startup. Silent override would make older review records
    ambiguous to re-read (records-outlive-writers). The fix is to pick
    a distinct extension name (e.g. `security-strict`).
  - **provenance pinned at write time.** Every `Lense` carries
    `source: 'bundled' | 'extension'`; entry records persist
    `lense_source: extension` when the lense was loaded from
    content_root (omitted for the bundled-default common case to keep
    YAML terse). A future bundled v2 that adds the same name cannot
    retroactively reinterpret a recorded entry — the record disambiguates
    itself.
  - **doctor-friendly failure modes.** Malformed YAML and schema
    validation failures route through `onMalformed` rather than
    crashing startup, so `gate doctor` can surface them.
  - `devil schema --format json` now exposes `source` per lense so
    consumers can distinguish bundled vs extension entries.
  - H2 (gate-side `gate.strict_lenses` opt-in mode) is the next slice
    and lands as a separate PR; this ship is loader + record
    annotation only.

### Deprecated

- **`--executor` (singular) on `gate request` / `gate fast-track`**
  ([#239](https://github.com/eris-ths/guild-cli/issues/239)).
  Explicit `--executor <name>` now emits a stderr notice pointing at
  `--executors <name>` and announcing v0.7.0 removal. The implicit
  `--executor` fallback in `gate fast-track` (defaulting to `--from`
  when neither flag is given) stays silent — only user-supplied
  values trigger the notice. Behavior is otherwise unchanged through
  the v0.6 cycle; the deprecated surface is removed at v0.7.0 cut
  along with the `executor` JSON alias on rendering.
  Notice introduced for v0.6.0; removal scheduled for v0.7.0.

### Fixed

- **friction bundle — flag aliases / lense help / self-approve discoverability /
  stderr warnings**
  ([#228](https://github.com/eris-ths/guild-cli/issues/228)).
  Four touch-feel improvements that descend to the standard profile
  (sibling to #233 self_approve under swarm):
  - `gate review` now accepts `--note` as the canonical comment flag
    (parity with the six other write verbs — approve / deny / execute
    / complete / fail / fast-track). `--comment` is preserved as a
    deprecated alias for back-compat; passing both is rejected as
    mutually exclusive, and using the alias surfaces a stderr
    deprecation notice (stderr only, so JSON consumers stay clean).
  - `gate review --help` dynamically lists the lenses resolved from
    `guild.config.yaml` rather than the four domain defaults — so a
    project that registered `security` / `perf` / `a11y` sees them
    in help, not just in the post-error hint. Implemented via a new
    optional `extras` field on `HelpRequested` so other verbs can
    surface their own dynamic info without bespoke renderers.
  - `gate request` emits a `suggested_next` line mentioning
    `gate fast-track` whenever the author and the (sole) executor
    coincide — the self-wave case where the standard
    pending → approve → execute → complete dance is overkill. Cross-
    actor waves keep the standard hint without the fast-track nudge.
  - dist staleness warning is verified to ride stderr (was already
    correct in `bin/_lib/checkDistFreshness.mjs` —
    `process.stderr.write`, not `console.log`); the new test pins
    the contract so a regression that flips to stdout is caught.

### Added

- **`gate request --from-agora <play_id>` bridges agora play
  cliff/invitation into request action/reason**
  ([#232](https://github.com/eris-ths/guild-cli/issues/232)).
  Surfaces the substrate-side link from agora (suspended-conversation
  passage) into gate (request passage) without forcing the operator
  to copy/paste prose between two CLIs. Lift policy: `action ←
  invitation` (the "what to do next" half of the cliff), `reason ←
  cliff` (the "what was happening" half); either flag may still be
  passed explicitly to override its corresponding lift while the other
  axis stays bridged. The play id is stamped structurally on
  `Request.sourceAgoraPlay` (YAML key `source_agora_play`) so
  `gate chain`-style walks see the agora→gate edge without scanning
  free-form text. `--game <slug>` disambiguates cross-game play-id
  collisions (each agora game sequences plays independently per day);
  passing `--game` without `--from-agora` is refused as a flag-shaped
  error rather than silently ignored. Refusal cases each carry an
  actionable `next:` hint: concluded plays (terminal — open a fresh
  play or file without `--from-agora`); playing-but-never-suspended
  plays (no cliff to bridge — `agora suspend` first); not-found play
  ids (surfaces the agora content_root the bridge consulted, so a
  multi-root operator sees which tree rejected the lookup); invalid
  id shape (names the YYYY-MM-DD-NNN format). Profile-agnostic — works
  identically under `standard` and `swarm`. Byte-stable persistence:
  `source_agora_play` is omitted from YAML when unset (every plain
  `gate request` and every pre-#232 record); hydrate tolerates the
  absence by leaving the field undefined. `gate show` renders
  `source_agora_play: <id>` in text mode (next to `created:`) and
  exposes the same key under the JSON payload. Mutually exclusive
  with `--template` (#235) at the interface layer — both supply
  action/reason defaults, so combining them is rejected with a
  flag-shaped error rather than silently picking one.
- **`feat(gate templates): wave-brief template registry — list / show /
  --template skeleton expansion
  ([#235](https://github.com/eris-ths/guild-cli/issues/235))**.
  Adds two read subverbs (`gate templates list` / `gate templates show
  <name>`) over a per-instance template SOT at
  `<content_root>/data/guild/templates/wave-brief/`, and threads
  `gate request --template <name>` through to stamp three new fields
  on the request record (`template`, `template_version`,
  `gate_required_acknowledged`). The skeleton expansion populates
  `--action` / `--reason` from the template's frontmatter when the
  caller omits them; explicit overrides win and the template stamp
  survives. Templates are markdown files with YAML frontmatter
  (`template_name` / `template_version` / `intended_use` /
  `gate_required`); malformed frontmatter routes through the
  conventional `onMalformed` warn-and-skip path so one bad file
  doesn't take the registry offline. The public `guild-cli` repo does
  NOT ship templates — each guild instance keeps its own brief
  catalogue under `content_root`, and a missing dir is the legitimate
  empty-registry case (the `list` surface emits a single-line advisory
  rather than failing). Profile=swarm gating for parallel-executor
  waves is in stub form for this phase: when `executors.length > 1`
  is supplied without `--template`, a stderr notice points at the
  registry and `gate templates list`, but the request still lands.
  Enforcement (refuse without `--template` for parallel waves) is the
  follow-up issue. Pre-#235 records lack all three template fields
  and round-trip clean (records-outlive-writers, principle 04). Schema
  declares the new `templates` verb under category `read` with a
  `subcommand` discriminator; the schema-drift detector treats it as
  a subcommand umbrella alongside `issues` and `inbox`. Mutually
  exclusive with `--from-agora` (#232) at the interface layer (both
  supply action/reason defaults).

- **`features.self_approve: { allowed | warn | forbidden }` —
  profile-gated self-approve policy on `gate approve`**
  ([#233](https://github.com/eris-ths/guild-cli/issues/233)).
  Tri-state config gates the case where `--by` matches the request
  author. Three states (not a boolean) because failure modes differ:
  `allowed` passes silently for deployments that actively rely on
  self-approve, `warn` passes with a stderr notice pointing at
  fast-track (the historical default), `forbidden` refuses with exit
  1 and an actionable error naming three recovery paths
  (`gate fast-track`, another actor approving, or switching profile /
  setting `self_approve: warn`). Profile defaults: `warn` under
  `standard` (preserves current behaviour), `forbidden` under `swarm`
  (parallel waves require bias-checked approvals — same shape as
  `worktree_required_for_parallel`). An explicit
  `features.self_approve` always overrides the profile default so a
  deployment can opt in/out without flipping the whole profile.
  Malformed values (non-string, or string outside the enum) surface
  via `onMalformed` and fall back to the profile default rather than
  rejecting the config — same conservative read pattern other
  optional fields use. `fast-track` is unaffected (orthogonal verb,
  never gated). Non-self approve is also unaffected regardless of
  profile/policy — the gate is self-only.
  + Self-detection is now performed on the canonical actor
    representation (case-fold + trim, via `MemberName`) rather than
    the raw CLI argument. Pre-fix, daily typing habits like `--by
    ALICE` or `--by 'alice '` slipped past the swarm `forbidden`
    gate even though the persisted record collapsed both to `alice`
    — a critical bypass surfaced by Asteria during cross-review.
    The same normalization is applied to all handler-side
    self-detection sites (review's self-review warning, thank's
    self-thank notice, message's self-message advisory) and to the
    `# verb id: invoked by X on behalf of Y` surface line, so
    whitespace no longer leaks into the audit trail.
- **`gate witness <id> --by <actor>` / `gate unwitness <id> --by <actor>`
  for non-exclusive cross-session observation**
  ([#244](https://github.com/eris-ths/guild-cli/issues/244),
  [#226](https://github.com/eris-ths/guild-cli/issues/226) phase 2).
  Companion verb to `claim` (phase 1): where claim is "I'm working on
  this right now, do not double-stake" (exclusive, refuses on
  conflict), witness is "I'm watching this" (non-exclusive — multiple
  actors can witness simultaneously, never refuses on conflict with a
  claim or another witness). Re-witness by the same actor is a no-op
  (idempotent — the array doubles as a set ordered by first
  registration). `unwitness` removes only the caller's own witness,
  refusing on a foreign actor (no kick semantics in this primitive).
  State guard: witness allowed on pending/approved/executing (the live
  race window — passive observation of in-progress work is
  legitimate); terminal states refuse and auto-reset existing
  witnesses to `[]` on the transition. Pre-#244 records hydrate as no
  witnesses and YAML stays byte-stable (the `witnesses:` field is
  omitted when empty). `gate show` surfaces `witnesses: a, b, c` below
  the claim line in text mode, and exposes the structured `witnesses`
  array in JSON mode (omitted when empty in both surfaces).
  + Hydrate dedup: hand-edited YAML with duplicate `witnesses` entries
    is collapsed to first-occurrence on load (matching the domain's
    set-by-first-registration semantic) and the migration surfaces via
    `onMalformed` rather than passing silently — without this, a single
    `unwitness` would leave duplicate names visible on `show`.
    + Terminal-aware `unwitness` error: when invoked on a closed record
    (completed/failed/denied) where auto-reset has already cleared the
    list, the error message names the auto-release behavior and signals
    "no action needed", distinguishing a benign cleanup pass from a
    real misnamed `--by` typo (which keeps the original phrasing on
    pending/approved/executing).

- **`gate claim <id> --by <actor>` for cross-session stake**
  ([#226](https://github.com/eris-ths/guild-cli/issues/226) phase 1).
  Two concurrent main-session agents that independently pick up the
  same id (substrate-experiment 5) can now mediate the race by
  claiming the request before working on it. Same-actor re-claim is
  a no-op (idempotent — `claimed_at` is NOT bumped, the timestamp is
  a "since when" stamp, not a heartbeat); a different actor's claim
  is refused while one is held; the claim auto-releases when the
  request reaches a terminal state (completed/failed/denied).
  Pre-#226 records hydrate as unclaimed and YAML stays byte-stable
  (the field is omitted entirely when null). Witness/explicit-release
  verbs are deferred to a follow-up issue — phase 1 ships claim only.

### Fixed

- **`witness` / `unwitness` / `claim` concurrency safety
  ([#244](https://github.com/eris-ths/guild-cli/issues/244) Devil
  REJECT root cause).** Pre-fix: these verbs mutated state without
  appending to `status_log` / `reviews` / `thanks`, so the optimistic-
  lock token (sum of those three array lengths) was non-monotonic
  across them. Two concurrent `gate witness` calls both passed the
  lock check on identical pre-state and last-writer-wins atomic
  rename silently dropped one of the two writes — Devil's repro
  showed 4 parallel witnesses landing exactly 1 entry, parallel
  `unwitness` losing the loser, and `claim ⊥ witness` mixed races
  destroying the #244 core promise that "witness coexists with any
  claim". Fix: each `claim` / `witness` / `unwitness` mutation (and
  every per-actor terminal auto-reset) bumps a new `mutation_seq`
  counter on Request, and `computeVersion` includes it in the
  optimistic-lock token; concurrent writers now throw
  `RequestVersionConflict` and the use case
  (`RequestUseCases.{claim,witness,unwitness}`) retries the load →
  mutate → save loop on conflict (bounded, with stagger). Idempotent
  re-claim / re-witness by the same actor does NOT bump (no-op, save
  skipped). Per-actor accounting on terminal auto-reset means a
  frontier collapsing "claim + 3 witnesses" contributes `+4` so the
  seq delta remains a faithful "how many actors were mediating"
  signal. YAML byte-stable: `mutation_seq` is omitted when 0, so
  pre-#244 records and never-mediated post-fix records round-trip
  identically.

- **darwin path-comparison flakes in `tests/{interface,passages}/`
  ([#238](https://github.com/eris-ths/guild-cli/issues/238)).** Twelve
  tests across `boot`, `doctor`, `register`, and `agora new`/`play`
  asserted on absolute paths derived from `mkdtempSync(os.tmpdir())`
  via `new RegExp(escapeRegex(root))`. On macOS, `os.tmpdir()` returns
  `/var/folders/...` but child processes resolve their cwd through the
  `/var → /private/var` symlink, so subprocess output names the
  `/private/var/...` form and the regex `^...$` anchors miss. Fix:
  wrap `mkdtempSync(...)` results in `realpathSync` at the test
  bootstrap so the root used in assertions matches what spawned
  subprocesses emit. Test-infra only — no production code touched.

- **`optionalOption` rejects bare flags (`--depth`, `--executor`,
  `--state`, ... with no value).** Pre-fix, an optional flag passed
  without a value silently fell through to the env fallback / undefined.
  Surfaced in v0.5 dogfood: `gate request --depth` (intending to set
  the value but forgetting to type it) silently created a request
  with no depth. Same fail-open class `requireOption` already protects
  against; `optionalOption` now mirrors the shape:
  ```
  error: Missing --depth value.
    (If your value begins with "--", use --depth=<value> or place "-- <value>" after the other flags.)
  ```
  Affects every callsite — `--executor`, `--target`, `--state`,
  `--game`, `--note`, etc — uniformly. Bare-flag short-circuits the
  env fallback path so a typo can't be silently overridden by ambient
  GUILD_ACTOR.

- **Inbox text-mode surfaces `(unread, expects response)`.** Phase 1
  of [#220](https://github.com/eris-ths/guild-cli/issues/220) (PR #222)
  stamped `expects_response` on inbox YAML and surfaced it via
  `gate boot`'s `suggested_next`, but the inbox **text** rendering
  only said `(unread)` for both flagged and unflagged broadcasts. A
  human scanning the text inbox couldn't tell them apart without
  re-running with `--format json`. Now the marker shows inline:
  ```
  1. [...] broadcast from nao (unread, expects response)
     audit needed
  2. [...] broadcast from nao (unread)
     FYI only
  ```
  Read state suppresses the marker (Phase 1 ack proxy: read drains
  the surface). Same principle-09 disclosure shape — visible at the
  surface that emits it, in both text and JSON.

### **BREAKING**

- **`gate show --format text` label rename: `executor:` → `executors:`**
  ([#230](https://github.com/eris-ths/guild-cli/issues/230)). text mode
  の label が常に複数形になる (単数 wave でも `executors: miki`)。
  人間スクリプト (`grep '^executor:'`, `sed 's/executor: //'`, etc.)
  を破壊するため BREAKING として明示。
  - **Before**: `executor: miki` (単数 wave のとき) / `executor: miki, leysia` (複数のとき、暫定 v0.5 形式は未存在)
  - **After**: `executors: miki` / `executors: miki, leysia` (uniformly plural)
  - **Migration**: 新 label に追従するか、構造化 consumer は
    `--format json` の `executors` array key を使うこと。永続化
    YAML 側の field rename (`executor` → `executors`) は同じ
    release で起きるが、read-only の legacy hydrate により旧
    record は透過に load される (詳細は
    [docs/storage-format.md](./docs/storage-format.md) §Request
    の Hydrate tolerance)。

- **`gate list` (no `--state`) now defaults to `--state all`**
  ([#218](https://github.com/eris-ths/guild-cli/pull/218),
  closes [#217](https://github.com/eris-ths/guild-cli/issues/217)).
  Pre-fix the no-flag call exited 1 with a hint that disclosed
  the `--state` enum + the `all` sugar. The hint was good but
  the exit-1-on-muscle-memory-call posture was inconsistent with
  every sibling list verb (`agora list`, `devil list`,
  `gate issues list` all "just work" without flags). A v0.5
  dogfood pass surfaced this as the last remaining touch-feel
  asymmetry across the four passages.
  - **Before**: `gate list` → exit 1, hint on stderr.
  - **After**: `gate list` → exit 0, every request across every
    state, identical to `gate list --state all`.
  - **Migration**: callers that explicitly passed `--state pending`
    (or any other state) are unaffected. Callers relying on the
    exit-1 + hint behaviour (likely none — this was a discovery
    affordance, not an API) should migrate to `gate list --state
    pending` if they wanted the pending-only triage view, or
    `gate status` for the count snapshot. The hint itself moves
    to `gate list --help` (the runnable-example surface from
    PR #163), out of the hot path.

### Added

- **`gate request --executors a,b,c` records multiple executors per
  request** ([#230](https://github.com/eris-ths/guild-cli/issues/230)).
  parallel-impl wave 等で複数の executor を attribution として
  正しく保存できるようになる。各要素は member name regex
  (`/^[a-z][a-z0-9_-]{0,31}$/`) で個別検証、重複・空文字は loud に
  reject。`--executor` 単数 flag は後方互換 alias として継続するが、
  `--executors` と同時指定すると排他エラー。永続化 YAML は
  `executors: [<name>, ...]` (array) で書かれ、単数 wave でも
  `executors: [miki]` の形を取る (uniformity)。pre-#230 の
  `executor: <single>` record は read 時に透過 hydrate され、
  次回 save 時に新形式へ rewrite される (in-place migration なし)。
  substrate-experiment 実験 6 で実証された並列実装 attribution
  race を構造的に解く修正。
- **`gate issues promote --executors a,b,c` symmetric with request**
  (Devil concern follow-up from #230). promote 経路でも複数 executor
  を一発で記録できる。`--executor` 単数 alias は同様に継続。

- **`gate request --depth shallow|standard|deep` reviewer-depth advisory**
  ([#221](https://github.com/eris-ths/guild-cli/issues/221) phase 1
  substrate slot).
  Substrate-experiment 実験 2 で発見した sharp edge への対応:
  Devil agent が常時最大深度で grep + 検証するため、極小実装に
  対しオーバーレビューが構造的に発生していた (PR #207 の事例)。
  `--depth` flag を `gate request` に opt-in で追加し、enum
  `[shallow, standard, deep]` で reviewer 側 (Devil agent) に
  advisory を渡せるようにする。
  - `shallow`: surface 点検、grep 自走しない
  - `standard`: 現行と等価 (default、互換)
  - `deep`: arch / threat-model まで掘る
  - **substrate slot のみ**: agent 側の prompt 3 段階化は
    operator/agent setup 側で対応する (本 repo の外)。
    principle 02 (advisory-not-directive) のとおり、reviewer は
    depth を尊重する義務を負わず、substrate は signal を carry
    するだけ。
  - **byte-stable**: `--depth` 省略時は YAML に `depth:` フィールド
    を書かない。pre-#221 record と round-trip-byte-同等
    (principle 04: records-outlive-writers)。
  - hydrate tolerance: 既存 record ですべての older 形 (`depth:`
    なし) が clean に load される test。
  - Schema input + drift detector update + advisory-framing
    description (principle 02 / 10)。

- **`gate whoami` honours `--format json|text` with a typed payload.**
  whoami was the lone read-shape verb without `--format` support —
  every sibling (`status` / `board` / `list` / `show` / `voices` /
  `tail` / `doctor`) accepted both formats, but whoami declared
  only `--limit` and was text-only. That meant the principle-09
  `actor source: ...` disclosure was reachable to agents only via
  regex parsing of prose. JSON now emits
  `{actor, role, display_name, actor_source, recent_utterances}`
  with the schema's `output` properties fleshed out to match
  (previously declared as `{type: "object"}`, contributing to the
  schema-as-contract gap that principle 10 names). Error path
  (missing `GUILD_ACTOR`) returns the standard `ok: false` envelope
  in JSON mode so orchestrators don't switch parsers based on
  outcome. whoami joins the format-symmetry CASES; new focused
  JSON-path tests cover env / file / missing-actor / invalid-format.

- **bin entries set stdio blocking before dispatch.** Pipe-targeted
  `process.stdout.write` is async; on `--format json` payloads above
  ~8 KB (notably `gate schema` once whoami's output shape was
  fleshed out, but every verb is exposed to the same race) the
  trailing `process.exit(code)` would cut the tail of the JSON
  envelope, surfacing as `Unexpected end of JSON input` in
  spawn-based tests and non-tty consumers. All 5 bin entries
  (`gate` / `agora` / `devil` / `ctx` / `guild`) now flip
  `process.stdout._handle.setBlocking(true)` (and stderr) before
  dispatch — tty writes are already synchronous so this is a no-op
  on interactive runs. Latent bug surfaced by the whoami
  schema-as-contract fix above pushing `gate schema` past the
  threshold.

- **Format-symmetry contract test (principle 11 enforcement).** A
  v0.5 dogfood pass found that `gate status` and `gate doctor`
  silently fell back to text mode for unknown `--format` values
  (the inverse symmetry — every `--format`-aware verb must reject
  unknown values uniformly — had no CI guard). New test runs both
  `--format json` and `--format text` against a representative set
  of read verbs (gate status / board / schema / doctor / tail,
  agora list / schema, devil list / schema), asserts both succeed
  and produce parseable output, plus a negative pass that pins
  rejection of `--format yaml`. Two handler fixes shipped together:
  `gate status` and `gate doctor` now validate `--format` at entry
  (matches the existing pattern used by board / list / schema).

- **Schema ↔ handler flag-coverage CI test.** `<cli> schema --verb
  <name>` is the agent-dispatch reflection layer; the handler's
  `*_KNOWN_FLAGS` set is what the CLI actually accepts via
  `rejectUnknownFlags`. There was no CI guard against the two
  drifting. New test enumerates every verb across the 5 passages
  via `<cli> schema --format json`, parses the handler's known-flag
  set from the unknown-flag error message, and asserts set
  equality (after filtering positionals — those carry a
  `description: 'positional; ...'` marker in devil's schema and
  are absent from agora's). Sub-dispatchers (`gate issues`,
  `gate message`) are skipped: their schema models a `subcommand`
  enum rather than a flag set. A floor-check verifies at least 3
  verbs per CLI passed the comparison so a regression in the
  unknown-flag error shape doesn't silently empty the loop.

- **`gate whoami` discloses actor source provenance.** When
  `GUILD_ACTOR` (env) and `.guild-actor` (file) both produce a
  valid identity, the resolved actor looks the same on the
  surface but the *path* that produced it carried different
  signals (env from shell vs. file dropped into the tree by a
  colleague). New `actor source: GUILD_ACTOR (env)` /
  `actor source: .guild-actor (file)` line under `you are X`
  closes the orientation gap. Sibling helper
  `resolveGuildActorWithSource()` exposes the source as a typed
  field for other surfaces that want it. Mirrors principle 09
  (orientation-disclosure) — when two valid configurations
  produce the same value, name which one was used.

### Changed

- **`gate show --format text`: label `executor:` → `executors:`**
  ([#230](https://github.com/eris-ths/guild-cli/issues/230)). uniformity:
  単数 wave でも複数形 `executors: miki` で表示される (record の
  arity に関わらず)。grep / sed で `^executor:` を expecting する
  外部スクリプトは `executors:` に追従が必要 — 移行先は
  `executors:` を grep するか、`--format json` の `executors`
  array key を使う。BREAKING 節にも明示。
- **`gate show --format json` adds `executors: <array>` key**
  ([#230](https://github.com/eris-ths/guild-cli/issues/230); canonical
  shape). 既存の `executor: <string>` key も back-compat として
  first-of-list 値を 1 リリース継続 emit する (consumer の段階
  移行のため)。`executor` JSON key は **v0.7 で削除予定**。
  consumer は `executors` array に migrate すること。
- **`gate list --executor <name>` matches against the array.**
  ([#230](https://github.com/eris-ths/guild-cli/issues/230)). 1 人でも
  array に含まれていれば match。flag 名は `--executor` 単数のまま
  (filter は単一 name 検索なので、複数指定の必要なし)。

- **Actor-flag missing-arg errors unified across agora / devil / ctx
  to the #164 `requireOption` shape.** A v0.5 dogfood sweep found 16
  callsites still using the pre-#164 pattern
  (`optionalOption` + manual `--by required (or set GUILD_ACTOR)`
  stderr write) — the gate sweep had been thorough but agora / devil /
  ctx kept the older bespoke message. Now every actor-flag error
  reads `Missing --by <m> (or set GUILD_ACTOR).` regardless of which
  passage emitted it. Net deletion of ~90 lines (one `requireOption`
  call replaces six lines of manual handling). Tests asserting the
  prior `/--by required/` shape updated to `/Missing --by/`.

### Added

- **Partial-dist-staleness detector at bin entry.** The existing
  guard at #139/#140 catches "dist not built at all" but not
  "dist exists, but lags src after a `git pull`". A v0.5 dogfood
  pass hit the lag case — `agora last` returned `unknown verb`
  because dist held the pre-#179 dispatcher. New shared helper
  `bin/_lib/checkDistFreshness.mjs` (plain ESM, lives outside
  `dist/` to avoid the circular trap) compares newest src/`*.ts`
  mtime against newest `dist/src/*.js` mtime, with a 2-second
  grace for fs clock skew. Emits a single stderr notice and
  continues — staleness is dev-loop friction, not a correctness
  failure (a stale dist often runs fine for the verbs that didn't
  change). Silent when src/ is missing (installed-via-npm shape).
  Wired into all 5 bin entries (gate / guild / agora / devil / ctx).

- **`agora list --state all` and `devil list --state all` accept the
  cross-passage sugar.** A v0.5 dogfood pass surfaced a touch-feel
  asymmetry: `gate list --state all` and `gate issues list --state all`
  both accept `all` as sugar for "every state, no filter" (#170), but
  the sibling `agora list` and `devil list` errored:
  ```
  agora: error: --state must be one of playing|suspended|concluded, got: all
  devil: error: review state must be one of open, concluded, got: all
  ```
  Same friction class #170 closed for `gate` — muscle memory between
  sibling list verbs across passages was breaking on the `agora` /
  `devil` boundary. Both now accept `--state all` and treat it as
  "no filter" at the interface layer; the domain enums are
  unchanged (the sugar is a CLI affordance, not a state). agora's
  invalid-state error now also names `|all` so the option is
  discoverable from the failure itself.

## [0.5.0] — 2026-05-06

> **substrate self-improvement wave** (#207 / #208) closes the loop:
> guild-cli's own `gate` substrate was used to design and ship two
> guild-cli improvements — meta-experiment that doubled as a v0.5
> hardening pass.
>
> - **`gate boot` surfaces authored requests with new reviews**
>   ([#207](https://github.com/eris-ths/guild-cli/pull/207)). Adds a
>   fifth `ActionableKind` `reviewed-authored` (PRIORITY=4) lifted via
>   a derived `lastAuthoredWriteAt(actor)` boundary aggregating
>   `status_log[].at ∪ reviews[].at ∪ thanks[].at` per actor. Zero
>   persistence, READ/WRITE invariants intact, host/member treated
>   uniformly (string actor space). Designed entirely via the
>   guild-cli substrate at `data/guild/` (Noir v1→Devil reject→Noir
>   v2→Devil concern→Noir v3→Devil ratify→Miki impl).
> - **`<write-verb> --help` bypasses the lock**
>   ([#208](https://github.com/eris-ths/guild-cli/pull/208)). Detects
>   `args.options.help` after `parseArgs` and routes dispatch around
>   `withEntryLock` so help is never gated by a contended lock.
>   Closes [#200](https://github.com/eris-ths/guild-cli/issues/200).
> - **Wave 8 (#155 lock landing) + envelope contract (#194 / #205)**
>   — full notes below; v0.5 ships the locking substrate, the JSON
>   error envelope contract across all four entries, and the
>   handler-internal catch fix that closes the envelope gap left by
>   #204.

> **Cross-process write serialization** (#155 — landed via #193 as a
> single squash that combined PR-A and PR-B; docs follow as PR-C).
> Replaces "serialize at the caller" with `withGuildLock`, a
> content-root-wide single-writer mutex enforced by per-entry
> middleware across all five CLIs (`gate`, `guild`, `agora`, `devil`,
> `ctx`). The optimistic per-record CAS is retained as an in-process
> safety net.
>
> Convergence path: design (Eris + Noir) → devil-review surfaced 5
> ship-blockers (entry coverage, host self-attestation, `buildContainer`
> invariant, verb-set SOT, `doctor` chicken-and-egg) → all accepted →
> implementation (Miki) → real-machine validation (Asteria, 14
> scenarios) → final-gate devil pass (zero ship-blockers, 6
> follow-ups filed: #194 / #195 / #196 / #197 / #200 / #201).

### Added

- **`withGuildLock` + `withEntryLock`** lock primitive and middleware
  ([#155](https://github.com/eris-ths/guild-cli/issues/155),
   [#193](https://github.com/eris-ths/guild-cli/pull/193)).
  `${contentRoot}/.guild-lock` via `O_CREAT | O_EXCL`, JSON metadata
  payload, `unlink` in `finally`. Three reclaim branches: dead pid
  (`kill 0` → `ESRCH` with ancestor-pid safety valve), pre-boot lock
  (`os.uptime()`-derived), and `GUILD_LOCK_MAX_AGE_MS` env cap.
  Engaged by per-entry middleware that consults a per-passage
  `verbs.ts` exporting three sets (`READ_VERBS` / `WRITE_VERBS` /
  `LOCK_EXEMPT_VERBS`); decision order is EXEMPT → READ →
  acquire-lock (unknown verbs are fail-safe to the lock side).
  Cross-passage race is exercised in CI by
  `tests/integration/lock/cross-passage-race.test.ts` (spawn-based
  with a shared barrier file via `GUILD_LOCK_TEST_BARRIER`, no-op
  in production). `buildContainer` invariant pin tests on each
  passage (`tests/infrastructure/{gate,agora,devil,ctx}Container.test.ts`)
  catch any regression that would put a write side-effect ahead of
  the lock.
- **`LockBusyError` (DomainError subclass)** — JSON envelope code
  `lock_busy` on the gate path; non-gate parity tracked in #194.
- **`SECURITY.md` § Concurrent writes** rewritten to describe
  guildLock as the serialization boundary, with the threat-model
  caveat (writers with content_root access are out of scope) and
  links to the six follow-up issues.
- **`docs/storage-format.md` § Cross-process serialization** —
  on-disk contract for `.guild-lock` (path, payload shape, reclaim
  rules, test barrier env) so the format is documented alongside
  the rest of the substrate.

> **Touch-feel campaign** (5 PRs, 1 design issue). A P3 dogfood pass
> with fresh-agent eyes surfaced the same friction class repeatedly:
> "the user knows something is wrong / done / different but not what
> to do next." Each PR fixes one layer of that gap; together they
> compound — by the final dogfood, every error / not-found / state
> mismatch / list-shape touch point answers the next-move question
> inline. No architectural changes; substrate, domain, and persistence
> contracts unchanged.

### Added

- **Verb-help shows a runnable usage example.**
  ([#163](https://github.com/eris-ths/guild-cli/pull/163))
  PR #148 made `--help` a universal escape valve and printed each
  verb's flag catalog. What was still missing was a runnable
  invocation. `gate request --help` now reads:
  ```
  gate request: --action, --auto-review, --executor, --format, --from, --reason, --target, --with
    e.g. gate request --action "<what>" --reason "<why>"
    see `gate --help` for the full verb catalog.
  ```
  Examples live in `src/interface/shared/verbExamples.ts`, keyed by
  `cli → verb → string` (same-named verbs across CLIs need scoping
  so an `agora list --help` example doesn't render a `gate ...`
  command). Coverage tests pin the (cli, verb) pairs that exist; an
  invariant test asserts every example begins with its own verb name
  to catch copy/paste typos.

- **`requireOption` errors name the value shape and the env fallback.**
  ([#164](https://github.com/eris-ths/guild-cli/pull/164))
  Pre-fix: `error: Missing --from. --from required` — the second
  sentence repeated the flag name without saying what value to put
  there or that `GUILD_ACTOR` would have satisfied the call.
  Post-fix:
  ```
  error: Missing --from <m> (or set GUILD_ACTOR).
  error: Missing --persona <red-team|author-defender|mirror>.
  error: Missing --severity <low|med|high>.
  ```
  The third argument is renamed `usage` → `shape` (the value
  placeholder); the env hint `(or set <env>)` is composed in one
  place and propagates to every actor-flag callsite (~22 of them).
  All ~50 callsites swept to structured shapes — free text passes
  `"..."`, members `<m>`, enums spell their option set inline.

- **`assertTransition` lists valid next states.**
  ([#167](https://github.com/eris-ths/guild-cli/pull/167))
  Pre-fix: `error: Illegal state transition: pending → completed`.
  Post-fix:
  ```
  error: Illegal state transition: pending → completed.
    valid next states from pending: approved, denied.
  ```
  For terminal states (completed/failed/denied), the message reads
  `X is terminal — no further transitions are allowed` instead of
  empty `valid next: ` (which would have been more confusing than
  the rejection itself). State names are the only domain vocabulary
  added — verb hints belong in the interface layer and intentionally
  stay out of `RequestState.ts`.

- **`not found: <id>` gains a per-entity discovery hint.**
  ([#167](https://github.com/eris-ths/guild-cli/pull/167))
  Pre-fix: `not found: 2026-05-05-9999`. Post-fix:
  ```
  not found: 2026-05-05-9999
    try 'gate list' or 'gate tail' to see existing requests.
  ```
  Centralised in `notFoundMessage(entity, id)`. Three call shapes:
  request → `gate list` / `gate tail`; issue → `gate issues list`;
  member → `guild list`. Wired into `gate show`, `summarize`,
  `transcript`, `why`, `chain`, `issues note`, `guild show`.

- **`gate execute` notice when actor differs from `--executor`.**
  ([#169](https://github.com/eris-ths/guild-cli/pull/169) for
  [#168](https://github.com/eris-ths/guild-cli/issues/168))
  `--executor` records **intent**, not access — anyone with substrate
  access may run `gate execute`. Pre-fix, a fresh agent reading
  `--executor bob` reasonably interpreted it as a gate; when alice
  ran execute on bob's assignment, the substrate captured both but
  the surface gave no signal. Post-fix:
  ```
  notice: alice executed request 2026-05-05-0001 (assigned to bob); --executor records intent, not access.
  ```
  Mirrors the shape of the self-approve notice on `gate approve`.
  Silent when `--executor` was never set or matches the actor.
  AGENT.md cross-links #168 for the design rationale (recorded so
  future readers see the deliberate choice, not an oversight).

- **`gate list --state all` is sugar for "every state, no filter."**
  ([#170](https://github.com/eris-ths/guild-cli/pull/170))
  Pre-fix, `gate list --state all` errored `Invalid state: all`
  while the sibling `gate issues list --state all` already accepted
  it — broke muscle memory between the two list verbs. The hint
  shown when `--state` is omitted now mentions `| all` and includes
  a `gate list --state all` example line.

- **`guild` verbs honour `--help` like every other CLI.**
  ([#166](https://github.com/eris-ths/guild-cli/pull/166))
  PR #148 rolled out the universal `HelpRequested` /
  `rejectUnknownFlags` / `renderVerbHelp` mechanism across gate /
  agora / devil / ctx, but the operator-helper `guild` was out of
  scope. The 4 `guild` verbs (`list` / `show` / `new` / `validate`)
  now honour `--help` with the same shape and `guild new --bogus`
  no longer hardcodes `guild` in the unknown-flag error prefix.

- **`agora` / `ctx` / `devil` get the same did-you-mean as `gate`.**
  ([#173](https://github.com/eris-ths/guild-cli/pull/173))
  Typo'd verbs across the three passages now surface the closest
  matches inline rather than dumping the full HELP. Same Levenshtein
  shape gate already used. Also drops the `agora — v0 skeleton`
  label from agora's HELP block (alpha v1 has shipped).

- **`--version` reports a parseable version across all 5 CLIs.**
  ([#174](https://github.com/eris-ths/guild-cli/pull/174))
  Pre-fix, `gate --version` and `guild --version` printed
  `guild-cli <X.Y.Z>` while `agora` / `ctx` / `devil --version`
  printed status strings without a version number — a shell that
  did `agora --version | grep <version>` was silently broken. Each
  passage now prints `<cli> (under guild-cli <X.Y.Z>) — <status>`
  so the version is grep-able and the status remains visible.
  Also: `agora new` `suggested_next` points at `play` (the natural
  next step) instead of `list`.

- **`agora new` defaults `--kind sandbox` and `--title` to the slug;**
  **`agora move`'s next-hint stops repeating on every move.**
  ([#177](https://github.com/eris-ths/guild-cli/pull/177))
  `agora new --slug <s>` now works without `--kind` or `--title`,
  matching the most common opening shape (Sandbox plays without
  ceremony). And the `next: agora move ... | agora suspend ...`
  block that previously printed after every successful move was
  noise once a play got going — `move` is now a quiet `✓` line.

### Security

- **Sanitize absolute paths in CLI error messages.**
  ([#172](https://github.com/eris-ths/guild-cli/pull/172),
  closes [#153](https://github.com/eris-ths/guild-cli/issues/153))
  Errors from `safeFs` and friends carried the full resolved path
  (e.g. `/Users/alice/work/proj/substrate/requests/pending/foo.yaml`),
  incidentally leaking home-directory and checkout-location info
  into logs / screenshots / bug reports. Each CLI's main() catch
  now collapses the configured `contentRoot` prefix to the literal
  `<content_root>` token via `sanitizeError` (new pure function in
  `src/interface/shared/sanitizeError.ts`). The structural tail is
  preserved so debugging is not impaired. Paths outside contentRoot
  (`/etc`, `/tmp`, user-input absolute paths) are intentionally not
  sanitized — the threat model is single-user, trusted-environment.

- **Close `agora new` collision-error sanitizer hole.**
  ([#175](https://github.com/eris-ths/guild-cli/pull/175))
  Follow-up to #172. The `GameSlugCollision` branch returned 1
  directly from the handler instead of throwing, bypassing main()'s
  catch where `sanitizeError` runs — so its `At: <path>` line still
  leaked the absolute substrate path. Apply `sanitizeError` at the
  handler level so this alternate egress matches the contract every
  other error-path emission already holds.

### Changed

- **DomainError trailing `(field)` tag and `DomainError:` prefix
  dropped from human-readable error output across all five
  dispatchers** (gate / agora / devil / ctx / guild).
  ([#170](https://github.com/eris-ths/guild-cli/pull/170))
  Pre-fix: `error: Invalid lense: "bogus" ... (lense)` — the
  trailing tag was design intent at one point ("name which flag
  was bad") but read as redundant for flag-aligned fields and as
  debug noise for domain-internal fields (`(state)`, `(sequence)`).
  The `DomainError:` class-name prefix on agora/devil/ctx/guild
  also leaked an internal class name. JSON envelopes are unchanged:
  `error.field` still surfaces in `--format json` so orchestrators
  retain the structured info.

### Wave 7 — 4-passage convergence + agora sugar verbs

> Picks up where the touch-feel campaign closed. With `gate` /
> `agora` / `devil` / `ctx` all in active use, the cross-passage
> orientation surface (`gate boot`) finally caught up with the
> 4-passage reality, and agora grew two read-only sugar verbs to
> answer the daily-use questions ("which play am I in?", "what was
> I about to do?") that the v1 core didn't directly address.

- **`agora last` and `agora cliff` sugar verbs.**
  ([#179](https://github.com/eris-ths/guild-cli/pull/179))
  Two read-only verbs on top of the v1 core. `agora last` returns
  the actor's most recent open play (no `agora list` + copy
  required); `agora cliff <id>` peeks the closing
  cliff/invitation of a suspended play without resuming. Both
  preserve agora's JSON envelope contract.

- **`gate boot` cross_passage now surfaces ctx (4th passage).**
  ([#184](https://github.com/eris-ths/guild-cli/pull/184))
  ctx records existed on the substrate but `boot` only reported
  agora and devil activity. Added `ctxOrientation` provider; ctx
  in phase 1 is record-only (no transitions), so `open` is the
  count and `last_state` is `'recorded'`.

- **`agora list --state suspended` sorts by most-recent suspension.**
  ([#182](https://github.com/eris-ths/guild-cli/pull/182))
  Among suspended plays, the one suspended most recently shows up
  first — id-desc (creation date) was the wrong axis when the
  question is "what's been hibernating, and for how long?". Other
  states preserve the id-desc default. Re-sort happens in the
  handler; substrate contract unchanged.

- **`devil entry` lense/persona miss includes catalog + did-you-mean.**
  ([#185](https://github.com/eris-ths/guild-cli/pull/185))
  Typing `devil entry --lense bogus` now lists the 12 lenses + a
  Levenshtein "did you mean: --lense X?" hint on near-matches.
  Same for `--persona` (6 personas). Hint on stderr — JSON
  consumers reading stdout unaffected.

- **`gate boot` default `--tail` lowered 10 → 5 (principle 13).**
  ([#181](https://github.com/eris-ths/guild-cli/pull/181))
  `boot` is the hot-path bootstrap verb; default tail of 10
  produced ~250-line JSON. Override via `--tail <N>` unchanged.
  Codifies principle 13 "affordance density follows verb shape"
  added in [#180](https://github.com/eris-ths/guild-cli/pull/180).

- **Doc sweep: 4-passage architecture reflected across README/AGENT/etc.**
  ([#178](https://github.com/eris-ths/guild-cli/pull/178))
  Audit of cross-passage references caught 4 docs still framed
  around 3 passages. Updated to the current shape (gate / agora /
  devil / ctx).

### v1-prep — touch-feel follow-ups, hardening, contracts

> A focused pass to defendable v1 surface: a touch-feel friction
> that surfaced during a fresh-eyes review of the latest agora
> shape, three v1-prep items from the external deep-dive review
> (#153 sibling cluster), and one CI-signal-reliability bug.

- **`agora last` next-hint includes `--game <slug>`; `list --state
  suspended` text shows suspension timestamps.**
  ([#186](https://github.com/eris-ths/guild-cli/pull/186))
  Surfaced by a 2026-05-05 main-merge dogfood pass. Bare play-ids
  collide across games, so `agora last`'s `next:` hint produced a
  call that errored on the very next line. Hint is now
  `--game`-qualified, state-aware (playing → move/suspend, suspended
  → resume/cliff, concluded → no hint). `list --state suspended`
  surfaces the `at` timestamp so the post-#182 sort axis is visible.

- **Devil-review consistency follow-up: `--game` qualifier across
  play / suspend / resume next-hints.**
  ([#188](https://github.com/eris-ths/guild-cli/pull/188))
  Devil review on #186 caught that the `--game` fix landed only in
  `agora last` while the same hint shape lived unqualified in three
  other verbs. Same logic applies — extended consistently. Also
  documents `concluded`-state intent in `last.ts` and the
  serial-execution dependency of `withCleanCwd` (from #187).

- **Test isolation: `.guild-actor` file leak in develop-cut PRs.**
  ([#187](https://github.com/eris-ths/guild-cli/pull/187),
  closes [#183](https://github.com/eris-ths/guild-cli/issues/183))
  Three env-unset tests in `parseArgs.test.ts` silently failed in
  CI when the PR branch was cut from `develop` — that branch tracks
  `.guild-actor` at repo root for dogfood ergonomics, and PR
  branches inherit it; `resolveGuildActor()` reads both env AND
  file, so deleting `GUILD_ACTOR` alone didn't isolate the call.
  Wrapped affected tests in a `withCleanCwd()` helper. Regression
  test pins both the leak observability and the fix.

- **`docs/storage-format.md` — explicit on-disk YAML contract.**
  ([#189](https://github.com/eris-ths/guild-cli/pull/189),
  closes [#157](https://github.com/eris-ths/guild-cli/issues/157))
  POLICY.md declared the YAML shapes "stable surface" but never
  described them. New doc covers all 7 `Yaml*Repository` adapters:
  layout, fields, hydrate tolerance, versioning expressions,
  backward-compat rules table. Cross-linked from POLICY.md /
  AGENT.md / README.md. Out of scope: format changes themselves
  (separate concern, requires minor bump).

### Security

- **Defense-in-depth prototype-pollution guard in `parseYamlSafe`.**
  ([#190](https://github.com/eris-ths/guild-cli/pull/190),
  closes [#154](https://github.com/eris-ths/guild-cli/issues/154))
  Hydrate layer was leaning on `yaml`-lib's promise that `__proto__`
  lands as a literal key. Added independent guard at the
  `parseYamlSafe` chokepoint: walks the parsed tree, drops
  `__proto__` / `constructor` / `prototype` literal keys at every
  nesting level, rebuilds plain objects via `Object.create(null)`.
  No `Yaml*Repository.ts` changes needed — bracket-index reads work
  transparently. SECURITY.md known-hardening item now marked
  mitigated, sibling shape to #153.

### Tracked follow-ups

- **[#168](https://github.com/eris-ths/guild-cli/issues/168)** —
  `--executor` records intent, not access (closed by #169). Issue
  preserved in the substrate as the design-rationale anchor.

## [0.4.0] — 2026-05-03

> **Three-passage release.** Two new CLI passages land alongside `gate`:
> `agora` (second passage — play / narrative / exploration; suspend
> and resume as first-class primitives), and `devil-review` (third
> passage — security-backstop multi-persona scrutiny that composes
> with `/ultrareview` / Claude Security / supply-chain-guard). The
> three-passage architecture is named in `lore/principles/11-ai-first
> -human-as-projection.md`; the dispatch shorthand (gate=判断 /
> agora=探索 / devil=守備) is now in README / AGENT / per-passage
> READMEs; `docs/playbook.md` collects the cross-passage combos
> (including the bug-killing recipe). Two example content_roots
> are preserved as substrate (`examples/three-passages-framing/`
> shows agora's full propose→suspend→resume→conclude arc).

### Documentation

- **`docs/playbook.md`** ([#131](https://github.com/eris-ths/guild-cli/pull/131))
  — practical guide for combining `gate` / `agora` / `devil` on real
  work. Each section is a recipe: 6 gate-only patterns, 4 agora-only,
  4 devil-only, 4 combos (including the bug-killing flow as
  `issue → agora → gate (+ devil if security)`), and 8 tips for AI
  agents. Linked from AGENT.md (top callout), README.md (depth
  ladder), and docs/concepts-for-newcomers.md (Where-to-go-next).

- **判断 / 探索 / 守備 framing** ([#130](https://github.com/eris-ths/guild-cli/pull/130))
  — single-kanji + English shorthand for the three passages added to
  README / README.ja / AGENT / docs/concepts-for-newcomers + per-passage
  READMEs. Per principle 11 (AI-first), the framing is a dispatch
  tool, not a metaphor — AI agents recognize the shape and route
  to the matching passage. `examples/three-passages-framing/`
  preserves the agora play that captured the framing decision as
  a real artifact (concluded in [#132](https://github.com/eris-ths/guild-cli/pull/132)).

- **agora's `src/passages/agora/README.md`** rewrote post-merge
  (was stale "v0 skeleton" claim from snapshot phase; now reflects
  the v1 surface). New **`src/passages/devil/README.md`** parallel
  to agora's. **Post-merge cleanup pass** ([#128](https://github.com/eris-ths/guild-cli/pull/128))
  removed stale "snapshot / landing soon / v0 scaffold" markers
  across docs and code.

### Fixed

- **devil-review `--from scg` ingest: SCG now runtime-enforced as a
  mandatory delegate.** ([#126](https://github.com/eris-ths/guild-cli/issues/126)
  decision C; e-001 from devil-on-devil dogfood)
  Previously, the supply-chain lense's "mandatory delegate to SCG"
  claim in design docs was not actually enforced at runtime —
  `devil ingest --from scg` accepted any well-formed JSON matching
  the strict v0 shape, with no check that the input came from a
  real SCG run. A reviewer could fabricate a `verdict: CLEAR` JSON
  and satisfy the supply-chain lense gate without SCG ever
  running, defeating the floor-raising design intent.

  Post-fix, `--from scg` probes for the `scg` command on `PATH`
  via `which scg` (POSIX) or `where scg` (Windows) before
  proceeding. If scg is not found, the verb refuses with a
  structured error pointing at the install link
  ([eris-ths/supply-chain-guard](https://github.com/eris-ths/supply-chain-guard))
  and naming the design decision (#126 C) and the dogfood finding
  (e-001) for substrate-as-audit-trail.

  ultrareview / claude-security ingest paths are unchanged; only
  the scg path adds the binary check (it's the only source with a
  named delegate in the lense schema).

  Tests: a new test pins the refusal under an empty PATH
  environment, plus a paired test pins that `--from ultrareview`
  is unaffected. Existing scg-ingest tests now install a fake
  `scg` shim in a tmpdir and prepend it to PATH for the spawned
  devil process — testing the substrate without requiring SCG to
  be installed in CI.

### Added

- **`coherence` lense added to devil-review's bundled catalog (12th
  lense, bird's-eye-as-feature).** Surfaced as a methodology gap by
  mirror persona's e-014 synthesis during a post-merge devil-on-devil
  dogfood: the lense-coverage gate enforces lense-by-lense thinking
  but cannot detect cross-lense coherence drift; bird's-eye review
  had no first-class verb. Promoted to a lense so the audit posture
  itself is auditable. Catches: doc/code drift, naming
  inconsistencies between sibling verbs, contradictions between
  findings under different lenses, architectural-posture
  observations. Reviewers can now write `kind=finding` /
  `kind=resistance` / `kind=synthesis` entries on the `coherence`
  lense to record the bird's-eye observations a single-lense audit
  cannot reach. The `conclude` lense-coverage gate now requires an
  entry on `coherence` (or an explicit `kind=skip` with reason)
  alongside the other 11 — explicit-skip is the substrate-honest
  way to declare "we did not bird's-eye on this review."

### Added

- **`devil` — third passage under guild (alpha, security
  backstop).** ([#127](https://github.com/eris-ths/guild-cli/pull/127))
  A multi-persona, lense-enforced review surface that
  **composes with single-pass tools** (Anthropic `/ultrareview`,
  Claude Security, supply-chain-guard) rather than replacing
  them. Designed to **raise the security knowledge floor** for
  code reviewed by authors who haven't met OWASP top 10 — not
  to guarantee protection, but to keep the dialogue honest when
  a finding is dismissed.

  Complete v1 surface from #126: 11 verbs.

  - `devil open <ref> --type <pr|file|function|commit>` —
    start a review session against a target.
  - `devil entry <rev-id>` — append a hand-rolled entry.
    Per-kind validation: `kind=finding` requires `--severity`
    AND `--severity-rationale` (the friction that forces
    exploitability-context reasoning, Claude Security style);
    `kind=gate` is reserved for `devil ingest`.
  - `devil list` — enumerate reviews (filter by `--state` and
    `--target-type`).
  - `devil show <rev-id>` — full detail (entries / suspensions
    / resumes / conclusion); JSON form is `review.toJSON()`,
    same shape as the on-disk YAML.
  - `devil dismiss <rev-id> <entry-id> --reason <r>
    [--note "..."]` — mark a finding-entry dismissed with a
    structured reason (one of: `not-applicable | accepted-risk
    | false-positive | out-of-scope | mitigated-elsewhere`).
    Refuses re-dismiss and refuses dismiss-after-conclude.
  - `devil resolve <rev-id> <entry-id> [--commit <sha>]` —
    mark a finding-entry resolved, optionally citing the commit
    that landed the fix (`resolved_by_commit` becomes part of
    the substrate).
  - `devil suspend <rev-id> --cliff "..." --invitation "..."` —
    record a cliff/invitation pause on a thread of the review.
    Softer than agora's suspend: does NOT block other entries;
    just records re-entry context.
  - `devil resume <rev-id> [--note "..."]` — pick up the most
    recent un-paired suspension. Surfaces the closing
    cliff/invitation in the response.
  - `devil ingest <rev-id> --from <ultrareview|claude-security|scg> <input>` —
    append entries from an automated source's output. Strict
    v0 input JSON shapes per source; logs each invocation to
    `re_run_history`. SCG ingest produces one `kind=gate`
    entry on the `supply-chain` lense; ultrareview /
    claude-security produce N `kind=finding` entries.
  - `devil conclude <rev-id> --synthesis "<prose>"
    [--unresolved e-001,e-002,...]` — terminal state
    transition. Verdict-less close (no `ok|concern|reject`);
    synthesis prose is required. Lense-coverage gate: every
    lense in the catalog needs at least one entry (a
    `kind: skip` entry counts when its text declares why) —
    silent skipping defeats the floor-raising design.
  - `devil schema [--verb <name>]` — principle 10 dispatch
    contract for the passage.

  Substrate path: `<content_root>/devil/reviews/<rev-id>.yaml`
  (rev-id format: `rev-YYYY-MM-DD-NNN`, sequence per
  content_root per day).

  v1 lense catalog (11): `injection`, `injection-parser`,
  `path-network`, `auth-access`, `memory-safety`, `crypto`,
  `deserialization`, `protocol-encoding` (Claude Security's 8
  categories) plus `composition`, `temporal`, `supply-chain`
  (devil-specific). The `supply-chain` lense delegates to
  [supply-chain-guard](https://github.com/eris-ths/supply-chain-guard)
  (mandatory; hard-error if SCG is unavailable — the floor-
  raising design refuses silent skip on supply chain per #126
  decision C).

  v1 persona catalog (6): three hand-rolled — `red-team`
  (adversarial framing strict), `author-defender` (articulate
  the author's framing + assumptions), `mirror` (read both,
  surface contradictions and shared blind spots) — plus three
  ingest-only personas attributable only via `devil ingest`:
  `ultrareview-fleet`, `claude-security`, `scg-supply-chain-gate`.
  `devil entry` refuses to attribute hand-rolled entries to
  ingest-only personas (`PersonaIsIngestOnly`).

  Entry kinds: `finding` / `assumption` / `resistance` / `skip`
  / `synthesis` / `gate` (the last reserved for ingest paths).
  `assumption` and `resistance` are the load-bearing kinds for
  the design intent — `assumption` makes trust-assumptions
  explicit so they can be contested (`--addresses`); `resistance`
  holds verdict-less concern across re-entry without forcing it
  to `ok|concern|reject`.

  Architecture in practice:
  - principle 11 (AI-first): every verb's JSON envelope is the
    agent contract (snake_case, `where_written`, `config_file`,
    `suggested_next`); text mode is a projection. Stale-prose
    detector applied at the schema level (lessons from #121
    extended).
  - principle 10 (schema as contract): `devil schema`
    advertises every implemented verb's input + output.
  - principle 09 (orientation disclosure): every write verb
    emits the same `notice: wrote <abs> (config: <abs>)` line
    shape as `gate register` and `agora new`.
  - principle 04 (records outlive writers): all state mutations
    are append-only at the array level (entries / suspensions /
    resumes / re_run_history). Status mutation on findings
    (dismiss/resolve) replaces the entry value at the same id
    slot — append-only at the array level preserved.

  State machine (intentionally thinner than agora's):

  ```
  open ──── conclude ────▶ concluded   (terminal)
  ```

  No `suspended` state — suspend/resume cycles are append-only
  history and do **not** block other entries. Multiple
  reviewers can be working simultaneously; the cliff/invitation
  records re-entry context only. (Contrast agora's Play, where
  suspend genuinely blocks moves.)

  Optimistic CAS via `DevilReviewVersionConflict` on every
  appending operation; `saveConclusion` uses state-CAS
  (`open` → `concluded`); `replaceEntry` (used by dismiss /
  resolve) carries CAS on entries.length AND the targeted id.
  The CAS is *sequential* not atomic — it catches the
  load-then-act-then-write race that AI agents naturally
  produce when re-entering between sessions, but does NOT
  prevent two simultaneous writer processes from both passing
  the check (last-write-wins under true OS concurrency). Trust
  assumption named in the repository docstring: "one CLI
  process at a time per content_root."

  Strict v0 ingest input JSON shapes (per source) are
  documented in `src/passages/devil/interface/handlers/ingest.ts`.
  Real-world adapter shims that translate actual upstream tool
  output into those shapes are out of scope for the in-tree
  passage and would land as separate utilities.

  Design rationale, three-source landscape comparison
  (`/ultrareview` vs Claude Security vs SCG), the seven shapes
  single-pass review structurally misses, and decisions A–E
  (naming / lense catalog / SCG mandatory / severity_rationale
  required / gate entry kind) live in
  [issue #126](https://github.com/eris-ths/guild-cli/issues/126).

  Sister project (devil-review's `supply-chain` lense's
  delegate target): [eris-ths/supply-chain-guard](https://github.com/eris-ths/supply-chain-guard)
  — its 8-stage Devil Gate framework is a reference implementation
  of the adversarial-gate-sequence shape devil-review's own
  `kind: gate` entry was designed to ingest.

  Per-content_root custom lense override loader
  (`<content_root>/devil/lenses/<name>.yaml`) is intentionally
  out of scope for v1. The catalog interface (`LenseCatalog`)
  is the seam; v1 ships the bundled defaults adapter only.

  ~5,500 LOC, ~140 contract tests across 14 test files. Built
  iteratively on `snapshot/devil-review` (12 + 5 commits)
  through three dogfood passes — self-review of
  `YamlDevilReviewRepository.ts` surfaced the lense-coverage
  gate gap (e-006) before merge, and the cumulative
  skip-with-reason audit posture (e-014) was named as a
  side-effect of the gate's design.

### Fixed
- **agora `suggested_next.reason` no longer carries stale "(when
  implemented)" / "(... lands in subsequent commits)" prose.**
  ([#121](https://github.com/eris-ths/guild-cli/issues/121))
  agora landed one verb per commit, and each commit's reason
  string was written when the next verb was genuinely future.
  Subsequent commits made those verbs real but didn't rewrite
  the older reason strings. Post-fix, `agora new` and `agora
  move` reason text reads as post-implementation. Regression
  test in `tests/passages/agora/suggestedNextContract.test.ts`
  scans every agora verb's `suggested_next.reason` for known
  stale phrases — guards against drift returning.

  Surfaced by another Claude instance playing agora interactively
  with nao (see [#117](https://github.com/eris-ths/guild-cli/issues/117)).
  Principle 09 (orientation disclosure) adjacent — surface
  drifted from substrate.

### Changed
- **agora `suggested_next.args.by` is no longer pre-filled with
  the just-acted actor.**
  ([#122](https://github.com/eris-ths/guild-cli/issues/122))
  Pre-fix, `agora play / move / suspend / resume` all set
  `suggested_next.args.by` to the calling actor, implicitly
  recommending **same-actor continuation**. For Sandbox plays
  with multi-actor alternation (e.g., AI agent + human, or two
  AI personas), this biased the orchestrator toward "same
  person continues" — counter to the rhythm those plays take.

  Post-fix, `args.by` is omitted from all four. `args` carries
  only the load-bearing field (`play_id`); the orchestrator (or
  human + AI pair) decides who acts next per their own
  alternation model. Per principle 11 (AI-first, human as
  projection): agora's substrate doesn't carry policy about
  who runs verbs.

  Behavior change for any orchestrator that read `args.by`
  without questioning. The verb name (`suggested_next.verb`)
  and `args.play_id` are unchanged and remain the load-bearing
  recommendation.

  Regression test pins the absence of `by` for play / move /
  suspend / resume going forward.

### Added
- **`agora` — second passage under guild (alpha).** A play / narrative
  surface alongside `gate`'s request-lifecycle / review surface.
  Built on the container/passage architecture (PR #116) with
  `gate`'s substrate (safeFs, parseYamlSafe, GuildConfig,
  MemberName, parseArgs) reused without modification.

  Verbs (8 + schema):

  - `agora new` — create a Game definition (Quest or Sandbox)
  - `agora play` — start a play session against a Game
  - `agora move` — append a move (with optimistic CAS)
  - `agora suspend` — pause with **cliff** + **invitation** prose
    (the design pivot; substrate-side Zeigarnik effect)
  - `agora resume` — pick up; surfaces the closing cliff/invitation
    in success output so the re-entering instance reads what was
    paused on without a separate query
  - `agora conclude` — terminal state (playing or suspended →
    concluded; drift-away outcome valid)
  - `agora list` — enumerate games + plays (filterable)
  - `agora show <slug-or-play-id>` — detail view; for plays
    renders full move + suspension/resume history paired by index
  - `agora schema` — principle 10 dispatch contract for the passage

  Substrate path: `<content_root>/agora/games/<slug>.yaml` and
  `<content_root>/agora/plays/<game-slug>/<play-id>.yaml` (per-game
  subdirs scope plays to their definition; each game has its own
  sequence counter).

  Architecture in practice:
  - principle 11 (AI-first): every verb's JSON envelope is the
    agent contract (snake_case, `where_written`, `config_file`,
    `suggested_next`); text mode is a projection
  - principle 10 (schema as contract): `agora schema` advertises
    every verb's input + output; mechanical drift detector test
    enforces input-side equivalence (`tests/passages/agora/schema.test.ts`)
  - principle 09 (orientation disclosure): every write verb emits
    the same `notice: wrote <abs> (config: <abs>)` line shape as
    `gate register`
  - principle 04 (records outlive writers): all state mutations
    are append-only; suspensions and resumes are separate arrays
    paired by index; multi-cycle history preserved

  State machine:
  ```
  playing  ── move ──────▶ playing
           ── suspend ───▶ suspended
           ── conclude ──▶ concluded   (terminal)
  suspended ── resume ──▶ playing
           ── conclude ──▶ concluded   (drift-away outcome)
  ```

  All state-changing appends use optimistic CAS (`PlayVersionConflict`)
  — re-entering instances detect concurrent appenders rather than
  silently overwrite.

  Design rationale (Zeigarnik / rabbit tracker translation for
  AI agents, three-axis convergence of AI-first + gamification +
  human learning) lives in
  [issue #117](https://github.com/eris-ths/guild-cli/issues/117).
  Designed via the kiri/noir/mira three-voice review pattern; the
  pivot of `suspend / resume` as first-class primitives was
  surfaced by mira's mirror role.

  ~3500 LOC, 62 contract tests across 8 test files.

- **`lore/principles/11-ai-first-human-as-projection.md`.** Names
  the order-asymmetry every existing principle has been enacting
  without declaring: design decisions start from "is this AI-
  natural?", not from "is this human-friendly?" The substrate
  belongs to the agent's cognition; human-facing ergonomics are
  a projection layer assembled outside the substrate. Order is
  substrate → projection, never projection → substrate.

  Unlike principles 09 and 10 (which were waited-on for a third
  instance to surface the pattern), 11 was named immediately on
  recognition — it had been the latent stance the project chose
  for every prior decision (`gate` JSON-default, snake_case JSON,
  schema as contract, stderr-only notices, explicit flags refusing
  human-default-intuition, etc.) but had no written rule pushing
  back when "let's make it more human-friendly" PRs would chip
  the substrate. With 11 named, the question becomes structural:
  is the friendlier version a projection, or a substrate change?
  Projections welcome; substrate changes for human-friendliness
  not.

  Cross-referenced from principle 10 (schema-as-contract is one
  concrete face of 11). Will become the upstream rule for agora
  design ([issue #117](https://github.com/eris-ths/guild-cli/issues/117))
  so passage primitives don't re-litigate AI-first per primitive.

- **Schema/KNOWN_FLAGS drift detector test.** Mechanical CI
  enforcement of principle 10's input-side obligation: every flag
  the runtime accepts must appear in the schema, and vice versa.
  PRs #103 (`--dry-run`), #105 (`--with-calibration`), #111 (tail
  `--format`) all hit drift after-the-fact during fresh-agent
  dogfood; this test catches it at PR time.

  The test parses each handler's `*_KNOWN_FLAGS` declaration and
  the `rejectUnknownFlags(args, X, 'verb-name')` calls via static
  regex (no source export needed — KNOWN_FLAGS stays internal),
  builds a verb→flag-set map, and compares to the live `gate
  schema` output. Subcommand umbrellas (`issues`, `inbox`) are
  skipped because the schema collapses multi-handler verbs into a
  single entry — aligning that requires a schema-model change
  rather than drift fixing. The `list`/`pending` indirection
  (one function with conditional const choice) is handled via an
  explicit `INDIRECT_VERB_TO_CONST` allowlist in the test.

  **8 existing drift instances fixed in the same PR**, surfaced
  by running the detector against main:
  - `fail`/`review`/`transcript`: `id` description didn't start
    with `positional;` so the detector treated it as a flag.
    Updated the shared `idStr` const + `transcript`'s inline
    description to mark them positional.
  - `thank.for`: was using `idStr` (which is now positional) as
    a flag-typed id reference. Inlined a non-positional
    description for `for`.
  - `show`: schema lacked `--plain` and `--fields` (which the
    runtime accepted). Added with descriptions naming the
    agent-facing shell-composition use case.
  - `message`/`broadcast`: schema lacked `--type`. Added.
  - `repair`: schema lacked `--format`. Added.

  Going forward, a PR adding a flag to `KNOWN_FLAGS` without
  the matching `schema.input.properties` entry fails at CI.

- **`lore/principles/10-schema-as-contract.md`.** Names the rule
  three input-side drift PRs (#103 dry-run, #105 with-calibration,
  #111 tail format) and ~10 read verbs with bare output schemas
  had been making necessary without articulating: `gate schema`
  is the agent dispatch contract, in BOTH directions. Input side:
  every flag the runtime accepts must appear in
  `schema.input.properties`. Output side: every field the runtime
  emits must appear in `schema.output` (no bare `{ type: 'array'
  }` / `{ type: 'object' }` placeholders). This principle is
  **structurally one level UP from principle 09** — without
  schema-as-contract, "boot's missing-disclosure was a contract
  bug" reduces to "it was annoying"; with it, the asymmetry
  between schema claim and runtime delivery IS the bug.
  Surfaced via the kiri-author / noir-devil / mira-mirror three-
  voice review session in the dogfood sandbox. Mira's mirror
  role flagged that 09 was implicitly leaning on a foundation
  that wasn't named.

- **`gate tail` and `gate voices` output schemas fleshed out
  (first instance of principle 10's output obligation).** Pre-fix,
  both verbs declared `output: { type: 'array' }` with no `items`
  — an MCP wiring saw "an array of something" and had to
  discover the utterance shape empirically. Post-fix, a shared
  `utteranceArraySchema` describes every utterance kind
  (authored / review / thank), every shared field (`kind`, `at`,
  `request_id`), every kind-specific field
  (`from`/`completion_note`/`with` for authored;
  `by`/`lense`/`verdict`/`comment` for review;
  `to`/`reason` for thank), and the optional `invoked_by` proxy
  field. All snake_case (post-#109). Field documentation names
  which kind each field applies to so a JSON-Schema-driven
  consumer reads the discriminated-union semantics without
  needing `oneOf` (the JsonSchema subset gate uses doesn't
  include it). Tracked follow-ups for the remaining bare-output
  read verbs (`status`, `whoami`, `show`, `chain`, `list`,
  `pending`, `repair`, `issues *`) are listed in principle 10.

- **Runtime-validates-schema test for tail + voices.** Mira's
  design suggestion (review on req `2026-05-01-0001`): the
  schema becomes unforgeable when the actual JSON output is
  validated against the declared schema in CI. If the runtime
  emits a shape that doesn't match the schema, EITHER the
  runtime regressed OR the schema is wrong; either way, CI
  catches it at the boundary that matters (what an MCP wiring
  would actually receive). Hand-rolled draft-07-subset
  validator (no new dependencies); validator self-tests its
  own failure modes so the suite can't silently pass with a
  buggy validator. Same approach extends to the other read
  verbs as their schemas are fleshed in follow-ups.

### Tracked follow-ups
- **Schema/KNOWN_FLAGS drift detector test (input side).** PRs
  #103, #105, #111 each added a flag to a verb's `KNOWN_FLAGS`
  but had to add the matching `schema.input.properties` entry
  separately. A CI-level test that compares each handler's
  `KNOWN_FLAGS` against its schema entry is the natural
  enforcement vehicle. Queued as the next mechanical follow-up
  to principle 10 — the principle file names this explicitly.

- **Output schemas for the remaining bare-typed read verbs.**
  `status`, `whoami`, `show`, `chain`, `list`, `pending`,
  `repair`, and `issues *` still declare `output: { type:
  'object' }` / `{ type: 'array' }`. Each is mechanical (read
  the runtime, translate to JsonSchema, add a runtime-validates
  test). Done in clusters where multiple verbs share a shape:
  `show`/`list`/`pending` share the `Request` shape;
  `status`/`board` share the `StatusSummary` shape.

### Added
- **`lore/principles/09-orientation-disclosure.md`.** Names the
  rule three empirical PRs (#108 register stderr notice, #110
  boot text disclosure, this PR's doctor disclosure) had been
  re-deriving instance-by-instance: a verb whose output is a
  count / finding / status *about* a content_root must let the
  operator verify the content_root identity in surprising cases,
  and stay quiet otherwise. The conditional emission is the
  whole design — voice budget says we don't burn a line on the
  99% case where cwd === content_root and config sits where
  expected. Surfaced via the kiri-author / noir-devil / mira-mirror
  review session in the dogfood sandbox; mira's mirror role
  (paraphrase + meta-question) flagged that we'd been ad-hoc'ing
  the same pattern across PRs without naming the rule. Pinning
  it so the next opt-in (status? board?) doesn't re-litigate.

- **`gate doctor` discloses the resolved content_root + config
  when surprising.** Carries the principle 09 pattern to doctor.
  Pre-fix, `gate doctor` reported "members 1 total, 0 malformed"
  with no signal about WHICH content_root those numbers applied
  to. An operator running doctor from a subdir of an active
  guild had no clue the diagnostic walked up to a parent. Post-
  fix, doctor emits the canonical line shape ONLY when
  surprising:
    - Subdir of an active guild → `content root: /abs (config: /abs/guild.config.yaml)`
    - No-config fallback (cwd as implicit root, has data) →
      `content root: /abs (config: none — cwd used as fallback root)`
  Suppressed when `misconfigured_cwd` already fires (no-config +
  no-data, the bigger warning owns disclosure) so the operator
  sees exactly one disclosure surface at a time. `--summary`
  mode also discloses; `--format json` is unaffected (text-only
  per principle 09 boundary). New shared formatter
  `formatContentRootDisclosure` in `internal.ts` so a third
  caller doesn't copy-paste.

- **`gate tail --format json`** closes the asymmetry that left
  `tail` as the lone read verb without JSON output. Sibling verbs
  (`voices`, `list`, `board`, `show`, `status`, `whoami`,
  `inbox`, `issues list`) all support `--format json|text`; tail
  was bare-text-only. Empty stream emits `[]` (not an error
  envelope) so `jq` pipelines don't have to branch on "is this
  an array or an error". Utterance keys are snake_case
  (`request_id` / `invoked_by` / `completion_note` /
  `deny_reason` / `failure_reason`) inheriting the post-#109
  contract — shipping the rename first means tail's JSON debuts
  in the right shape and never goes through a transient
  camelCase phase. The `gate schema` entry for tail now
  advertises both `limit` and `format` flags so MCP wirings
  discover them. A typo on the format value (`--format josn`)
  rejects loudly rather than silently degrading. Devil-reviewed
  in design sandbox (`2026-05-01-0001`).

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
  generic `review comment is required (use --comment <s>, …, or
  run interactively so $EDITOR opens)` error fired — but the
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

[Unreleased]: https://github.com/eris-ths/guild-cli/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/eris-ths/guild-cli/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/eris-ths/guild-cli/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/eris-ths/guild-cli/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/eris-ths/guild-cli/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/eris-ths/guild-cli/releases/tag/v0.1.0
