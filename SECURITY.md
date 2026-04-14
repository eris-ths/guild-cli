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
  and capped (4 KB for request fields, 2 KB for issue text).
- **State transitions** — `assertTransition` rejects illegal moves
  (e.g. `completed → approved`).
- **Denial-of-service caps** — directory listings (1000), reviews (50
  per request), status log (100 per request), inbox messages (500 per
  member).
- **YAML safety** — parsing goes through `yaml` lib's default schema
  which refuses custom tags.

## Known hardening items (not yet addressed)

- **Error messages may leak absolute paths.** Errors from `safeFs`
  include the resolved target. Acceptable for a local CLI; reconsider
  before any network exposure.
- **Prototype pollution from hostile YAML.** Modern `yaml` lib returns
  plain objects and handles `__proto__` safely, but the hydration layer
  does not independently guard against prototype keys.
- **Concurrent writes.** There is no lock file. Two simultaneous
  `gate approve` calls on the same request have a last-writer-wins
  race. Serialize at the caller.

## Reporting

Security issues: open a private GitHub Security Advisory on the repo.
