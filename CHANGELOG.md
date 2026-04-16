# Changelog

All notable changes to `guild-cli` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to the versioning policy described in [POLICY.md](./POLICY.md).

## [Unreleased]

### Added
- **Atomic writes for request files.** `YamlRequestRepository.save()` now
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
