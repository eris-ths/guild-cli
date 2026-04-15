# Changelog

All notable changes to `guild-cli` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to the versioning policy described in [POLICY.md](./POLICY.md).

## [Unreleased]

### Fixed
- **Windows path-separator crash (first-startup bug).** Previously
  `safeFs.assertUnder` and `GuildConfig.resolveUnder` checked
  containment with `absTarget.startsWith(absBase + '/')` which
  hardcoded the POSIX separator. On Windows, `path.resolve()` returns
  backslash-separated paths, so `C:\Users\foo\content/` never matched
  any legitimate subpath and every invocation threw
  `DomainError: Path escapes base` before any verb could run. The
  CLI was unusable on Windows despite the test suite passing on
  Linux CI. Replaced the literal-`/` check with a new
  `isUnderBase(absTarget, absBase)` helper in
  `src/infrastructure/persistence/pathSafety.ts` that uses
  `path.relative` for structural containment, plus a `makeIsUnderBase`
  factory so the logic can be unit-tested against `path.posix` AND
  `path.win32` from a Linux host. The `while (cur !== '/')` loop
  terminator in `assertUnder` is similarly cleaned up — it now relies
  on the cross-platform `parent === cur` root detection instead of a
  hardcoded separator literal. Also, the `npm test` script no longer
  depends on POSIX `find | xargs`; it uses Node's native
  `node --test "dist/tests/**/*.test.js"` glob which works
  identically on Linux and Windows.
- **Error messages on path-safety failures now name the base.**
  The old `DomainError: Path escapes base: kato.yaml` and
  `DomainError: Config path escapes base: x → y` hid the base path,
  forcing operators to read source to figure out which base the
  target was being compared against. Both errors now include
  `(resolved=..., base=...)` so the mismatch is visible without
  a debugger.

### Added
- **`$EDITOR` fallback for `gate review`.** When `gate review <id>
  --by X --lense Y --verdict V` is called with no `--comment`,
  no positional comment, no `--comment -` STDIN redirection, and
  stdin is a TTY, the CLI now opens the user's editor on a temp
  file — matching the `git commit` convention. Editor selection
  follows `GIT_EDITOR > VISUAL > EDITOR > platform default`
  (`notepad` on Windows, `vi` everywhere else). The template uses
  git's "scissors" sentinel
  `# ------------------------ >8 ------------------------`: everything
  at and below the scissors line is stripped from the body, so
  legitimate `#`-prefixed markdown headings inside the review are
  preserved. This sidesteps the Windows git-bash pipe handling
  quirks that made `--comment -` unreliable, and removes the
  friction of quoting multi-paragraph reviews on one shell line.
  Pure helpers `stripEditorComments` and `pickEditor` are exported
  from `internal.ts` and covered by 12 unit tests.
- **CI matrix now covers `windows-latest`** alongside `ubuntu-latest`
  on Node 20 and Node 22. Four combinations total, `fail-fast: false`
  so one OS's flake doesn't abort the others. This is the regression
  gate that will catch the next POSIX hardcode before it ships.
- **POLICY.md: value-object invariants under `domain/`.** `MemberName`'s
  ASCII-only shape (`^[a-z][a-z0-9_-]{0,31}$`) is now declared a
  *stable contract*, not just a current-implementation detail. The
  read-side verbs (`gate voices` / `tail` / `whoami` / `chain`)
  rely on this invariant to do case-insensitive matching via
  `.toLowerCase()` at the interface layer without routing through
  `MemberName.of()`; freezing the invariant explicitly means a
  future relaxation to non-ASCII identifiers is a breaking change
  that forces a Unicode-normalization audit of every caller.
  Similarly, `RequestId` / `IssueId` lexical shape (accepts both
  3-digit legacy and 4-digit current sequence suffixes, ceiling
  9999/UTC-day) is now pinned as a documented consumer contract.
- **POLICY.md: `domain/diagnostic/` and `domain/repair/` partial
  stability.** These layers are declared *partially stable*: the
  top-level JSON shapes of `DiagnosticReport` and `RepairResult`
  are frozen for a given 0.x line, but the enum variants inside
  (`DiagnosticKind`, `RepairActionKind`, outcome statuses) are
  **additive only**. External tools that pipe `gate doctor --format
  json` into dashboards or migration scripts should code against
  the shape rather than enum exhaustiveness and treat unknown
  kinds as opaque pass-through — this gives clean forward-compat
  as the taxonomy grows. Closes the implicit-curation ambiguity
  surfaced by the 0.2.0 PR #17 retrospective (where `yaml_parse_error`
  was added as an additive variant but POLICY did not explicitly
  say that was the contract).

## [0.2.0] — 2026-04-15

Second alpha release. Focus: **observation layer** (`gate doctor`),
**intervention layer** (`gate repair`), **cross-cutting read verbs**
(`voices` / `tail` / `whoami` / `chain` / `show --format text` time
deltas / `list` review markers), and the **interactive-identity**
affordance (`GUILD_ACTOR` env var fallback). Breaking changes are
concentrated in the `OnMalformed` application port — if you've
embedded `guild-cli` as a library, see the migration note below.

### Fixed
- **`gate doctor` no longer crashes on unparseable YAML.** Previously,
  a file containing YAML syntax the library couldn't parse (e.g. a
  truncated flow sequence, a compact-mapping conflict) propagated the
  parser exception out of `listByState` / `listAll` / `findById` and
  took down the diagnostic tool that was supposed to report it. The
  six `YAML.parse(raw)` call sites across `YamlRequestRepository`,
  `YamlIssueRepository`, and `YamlMemberRepository` now route through
  a single `parseYamlSafe(raw, source, onMalformed)` helper which
  catches the parse error, notifies `onMalformed` with the
  `"yaml parse failed: "` prefix (collapsed to one line), and returns
  `undefined` so the caller drops the file and moves on. This closes
  the last gap in the silent-fail taxonomy surfaced during a dogfood
  smoke test of `gate doctor` against a synthetic broken-YAML root.

### Added
- **`DiagnosticKind = 'yaml_parse_error'`** — new kind for
  lexer/parser-level YAML failures. The classifier prefix is
  `"yaml parse failed"` and is checked *before* `hydration_error` so
  parser error text containing "invalid" doesn't drift into the wrong
  bucket. `RepairPlan.actionForKind` routes it to `quarantine` with
  rationale "YAML syntax error; file is unparseable at the
  lexer/parser level". `VALID_KINDS` in `gate repair` includes it so
  doctor → repair pipelines accept it as input. Fifteen new tests
  exercise the helper, the classifier ordering, and end-to-end
  surfacing across all three repos.
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

[Unreleased]: https://github.com/eris-ths/guild-cli/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/eris-ths/guild-cli/releases/tag/v0.1.0
