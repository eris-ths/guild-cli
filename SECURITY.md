# Security Model

## Threat model

`guild-cli` is a local file-based CLI for managing small-team artifacts
(members, requests, reviews, issues, agora plays, devil-review reviews).
It is **not** designed for multi-tenant or network exposure. The trust
boundary is "anyone with write access to `content_root`".

## Security-backstop passage: `devil-review`

Since v0.4.0, `guild-cli` ships **`devil-review`** — a third passage
explicitly designed as a **security-knowledge-floor substrate** for
code reviewed by authors who haven't met OWASP top 10. It is not a
replacement for this Security Model document or for upstream tools
like Anthropic `/ultrareview`, Claude Security, or
[supply-chain-guard](https://github.com/eris-ths/supply-chain-guard).
It composes with them: the upstream tools' findings flow in via
`devil ingest --from <source>`; multi-persona deliberation happens
on top of the substrate.

**What `devil-review` enforces** (relevant to this threat model):

- **Catalog-enforced lense coverage at conclude.** A reviewer cannot
  conclude a `devil-review` session without leaving at least one
  entry per lense in the v1 catalog (12 lenses, including the
  Claude-Security-aligned 8: `injection / injection-parser /
  path-network / auth-access / memory-safety / crypto /
  deserialization / protocol-encoding`, plus `composition /
  temporal / supply-chain / coherence`). A `kind: skip` entry
  with declared reason satisfies coverage; silent skipping is
  refused. The friction is the floor.
- **`supply-chain` lense mandatory delegate to SCG.** When
  `devil ingest --from scg` is invoked, the verb runtime-checks
  for `scg` on `PATH` (POSIX `which scg` / Windows `where scg`)
  and refuses if absent. Documented intent is now runtime-enforced
  (PR #129 e-001 fix).
- **Severity rationale required on findings.** `kind: finding`
  entries require both `--severity` AND `--severity-rationale`.
  The rationale forces exploitability-context reasoning: same
  category may carry different severity in different repos
  (Claude Security influence; the rationale is what makes that
  decision auditable).
- **Append-only audit trail for dismissals.** `devil dismiss`
  requires a structured reason from a fixed enum (`not-applicable
  | accepted-risk | false-positive | out-of-scope |
  mitigated-elsewhere`). The substrate keeps the dismissal trail;
  re-dismissing a dismissed entry is refused. Future audit can
  grep `devil/reviews/*.yaml` for "what did we say about this
  category", not just "what passed".

**What `devil-review` does NOT enforce** (read this carefully):

- It does NOT prevent insecure code from being merged. A reviewer
  who skips every lense with `irrelevant because n/a` and concludes
  with empty synthesis can pass the gate. The substrate captures
  the dismissal so a future audit can see the decision was made;
  it doesn't prevent the decision.
- It is NOT a code scanner. Its `ingest` verbs depend on upstream
  tools producing the strict v0 input JSON shape. Real-world
  adapter shims that translate `/ultrareview` `bugs.json` /
  Claude Security findings export / SCG verdict output into
  devil's shape are **out of scope for the in-tree passage** and
  would land as separate utilities (or in the source tools
  themselves).
- It is shape-mismatched for **general bug-fix review**. See
  `docs/playbook.md` § "When NOT to use devil" — routine bugs
  (off-by-one, null checks, UI fixes) don't fit the
  security-shaped lense catalog and would degrade the substrate
  with cargo-cult skip-with-reason entries. Use `gate review`
  with the configurable lense list (default
  `devil / layer / cognitive / user`) for general code review.

**Trust assumption (named explicitly per PR #129 e-001 / e-002 fix
and propagated to agora in PR #132):** `devil-review`'s optimistic
CAS is **sequential**, not atomic. The same trust assumption applies
across all passages — *one CLI process at a time per content_root*.
Under that assumption, CAS catches the load-then-act-then-write race
that AI agents naturally produce when re-entering between sessions.
Under true OS-level concurrent writers (two processes hitting the
same record in the same scheduler quantum), last-write-wins
semantics apply. File locking is out of v0 scope.

For full details: `src/passages/devil/README.md`,
[issue #126](https://github.com/eris-ths/guild-cli/issues/126)
(design rationale), and `docs/playbook.md` (combos with `gate` /
`agora`).

## Invariants enforced in code

- **Path safety** — every filesystem op goes through
  `infrastructure/persistence/safeFs.ts`, which rejects any target that
  does not resolve under the configured base directory, and refuses to
  follow symbolic links anywhere on the path.
- **No shell execution for data processing.** The only
  `child_process` usage is `spawnSync` in array form (no shell
  expansion) for the interactive editor in `gate review` — see
  Trust Assumptions below. All persistence, parsing, and state
  mutation paths are in-process with no subprocess calls.
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
