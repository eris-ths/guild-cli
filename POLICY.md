# POLICY — Versioning and Stability

This document describes the versioning contract `guild-cli` offers to
consumers, and which parts of the API are considered stable surface.

## Versioning

`guild-cli` uses a **strict 0.x variant** of [Semantic Versioning](https://semver.org/):

| Bump        | Meaning in 0.x                                                    |
|-------------|-------------------------------------------------------------------|
| **`0.X.0`** (minor) | MAY contain breaking changes. Always documented in `CHANGELOG.md` with a **BREAKING** marker and a migration note. |
| **`0.x.Y`** (patch) | MUST be backward-compatible. Bug fixes, documentation, performance improvements, new verbs/flags that do not change existing behavior. |

This is **stricter** than the loose "anything goes under 0.x" convention:
we use patch as a stability promise even pre-1.0, so consumers can pin
to a minor line and receive only safe updates.

When the project reaches `1.0.0`, the standard SemVer rules apply
(major = breaking, minor = additive, patch = fix).

## Stable surface

The following layers are considered **stable** — changes require a minor bump
and a migration note:

### `domain/` (pure model)
- `Member`, `MemberName`, `MemberCategory`
- `Request`, `RequestId`, `RequestState` and its transition graph
- `Review`, `Verdict`, `Lense`
- `Issue`, `IssueId`, `IssueSeverity`, `IssueState` and its transition graph
- `DomainError`

If you are extending `guild-cli` by embedding it as a library, build
against this layer.

### `application/` (use-case boundary)
- The `*UseCases` classes and their method signatures
- The `ports/` interfaces (`MemberRepository`, `RequestRepository`, `IssueRepository`, `NotificationPort`, `Clock`)

If you are adding a new storage backend or notification channel, implement
against this layer.

### CLI surface
- The verbs and flags documented in `README.md` and `gate --help` / `guild --help`.
- Exit codes (`0` = success, non-zero = error).
- The YAML shapes written under `<content_root>/members/`, `requests/*/`, `issues/`, `inbox/`.

Output **text** formatting is **not** part of the stable surface — if you
need a machine-readable output, use `--format json` where available.

## Internal surface (unstable)

The following layers may change without notice in any release, including
patch bumps:

- `infrastructure/` (YAML repositories, `safeFs`, config loader).
  If you need a different storage backend, write a new `*Repository`
  against the port interface rather than modifying the YAML one.
- `interface/` internals (argument parser, container DI helpers,
  formatter helpers). The CLI verb surface is stable; the *code that
  implements it* is not.
- Anything under `src/` not listed above.

## YAML file forward-compatibility

Files produced by an older version of `guild-cli` are expected to remain
readable by newer versions within the same major line (0.x or 1.x).

- New optional fields MAY be added. Readers ignore unknown fields.
- Existing fields MUST NOT be renamed or repurposed within a major line.
- Removing a field is a breaking change (minor bump in 0.x, major in 1.x).

## Deprecation policy

When a stable surface element is scheduled for removal:

1. It is marked `@deprecated` in code with a pointer to the replacement.
2. The deprecation is announced in `CHANGELOG.md` under the minor release that introduces the warning.
3. The element is removed **no earlier than one minor release later** in the 0.x line (or one major in 1.x).

## Security fixes

Security patches may ship in any release type (patch, minor, major).
They are always noted in `CHANGELOG.md` with a **SECURITY** marker.

If a security fix requires a breaking change, we will ship the fix as a
minor bump with a clearly documented migration path — consumers on older
lines are expected to upgrade.

Report security issues via GitHub's private vulnerability reporting
(see `SECURITY.md`).

## Distribution context

`guild-cli` is currently distributed within the Anotete group of
companies as an internal tool, in addition to being public OSS. This
policy applies uniformly to both audiences: there are no private
breaking changes. All consumers — internal and external — see the same
`CHANGELOG.md` and the same stability guarantees.
