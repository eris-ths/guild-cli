# Security Model

## Threat model

`guild-cli` is a local file-based CLI for managing small-team artifacts
(members, requests, reviews, issues). It is **not** designed for
multi-tenant or network exposure. The trust boundary is "anyone with
write access to `content_root`".

## Invariants enforced in code

- **Path safety** — every filesystem op goes through
  `infrastructure/persistence/safeFs.ts`, which rejects any target that
  does not resolve under the configured base directory, and refuses to
  follow symbolic links anywhere on the path.
- **No shell execution** — the package never calls `child_process`.
  Verified by `grep -r 'child_process\|exec\b\|spawn\b' src/`.
- **Input validation at the boundary**:
  - `MemberName` — `^[a-z][a-z0-9_-]{0,31}$` + reserved-name blacklist
  - `RequestId` / `IssueId` — strict date-sequence regex
  - `Verdict`, `Lense`, `RequestState`, `IssueSeverity`, `IssueState` —
    enum parsing rejects unknowns
- **Text sanitization** — free-text fields (`action`, `reason`, `note`,
  `comment`) are stripped of ASCII control characters (except `\n\t`)
  and capped (4 KB for request fields, 2 KB for issue text). The
  sanitization policy has a single source of truth at
  `src/domain/shared/sanitizeText.ts`; every caller (Request, Issue,
  Review, MessageUseCases) re-exports the same strip-and-cap
  invariant rather than maintaining its own copy.
- **State transitions** — `assertTransition` rejects illegal moves
  (e.g. `completed → approved`).
- **Issue audit trail (state_log).** Every `Issue.setState` call
  appends to `state_log: [{state, by, at, invoked_by?}]`
  (append-only, max 100 per issue), parallel to Request's
  `status_log`. An `open → resolved → open → resolved` flap stays
  distinguishable from a single resolve. `gate issues resolve /
  defer / start / reopen` require `--by <m>` (or `GUILD_ACTOR`) —
  the transition cannot be recorded without an actor.
- **Strict CLI flag validation.** Every write verb declares its known
  flag set and rejects unknown flags via
  `src/interface/shared/parseArgs.ts#rejectUnknownFlags`. Typos like
  `--executr noir` or `--catgeory pro` error with a listing of
  valid flags instead of silently falling through to defaults.
  Applies to: `register`, `request`, `approve`, `deny`, `execute`,
  `complete`, `fail`, `fast-track`, `review`, `thank`, `message`,
  `broadcast`, `inbox`, `inbox mark-read`, `issues add|list|note|
  promote|resolve|defer|start|reopen`, `repair`, and — among
  read-only verbs — `tail` and `doctor`.
- **Denial-of-service caps** — directory listings (1000), reviews (50
  per request), status log (100 per request), issue state log (100
  per issue), inbox messages (500 per member).
- **YAML safety** — parsing goes through `yaml` lib's default schema
  which refuses custom tags.

## Trust assumptions (v0.3.0)

- **Editor invocation.** `gate review` spawns the user's editor via
  `$GIT_EDITOR` / `$VISUAL` / `$EDITOR` environment variables. The
  editor command is **not validated** — the tool trusts the local
  environment. In multi-user or container environments, restrict
  environment variable mutation or avoid interactive review.
- **Doctor plugins.** Plugins listed in `guild.config.yaml`
  `doctor.plugins` are ES modules executed **in the main process**
  with full Node.js capabilities. Only load plugins from trusted
  sources. There is no sandboxing.
- **MCP server (gate_mcp.py).** Spawns `gate` as a subprocess via
  `asyncio.create_subprocess_exec` (array form, no shell expansion).
  Project name validation blocks path traversal (`/`, `\`, `.`, `..`).

## Known hardening items (not yet addressed)

- **Error messages may leak absolute paths.** Errors from `safeFs`
  include the resolved target. Acceptable for a local CLI; reconsider
  before any network exposure.
- **Prototype pollution from hostile YAML.** Modern `yaml` lib returns
  plain objects and handles `__proto__` safely, but the hydration layer
  does not independently guard against prototype keys.
- **Concurrent writes.** There is no lock file. Two simultaneous
  writes on the same record have a last-writer-wins race unless
  optimistic-lock detection catches the second write's stale read —
  `RequestVersionConflict`, `InboxVersionConflict`, and
  `IssueVersionConflict` each cover their own record class. This
  catches **most** concurrent mutations but is not a full
  serialization barrier (the CAS window between re-read and
  atomic-rename is non-zero). Serialize at the caller for critical
  operations on any record.

## Reporting

Security issues: open a private GitHub Security Advisory on the repo.
