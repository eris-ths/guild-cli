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

Day-to-day repo-specific rules for contributors and review tools live in
[`docs/security-checklist.md`](docs/security-checklist.md). Findings from
upstream tools flow into the substrate via `devil ingest --from <source>`.

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
- **Plugin trust model.** See "Plugin trust model" below for the
  full surface (currently doctor plugins; verb / hook / transform
  plugins planned under [#36](https://github.com/eris-ths/guild-cli/issues/36)).
- **MCP server (gate_mcp.py).** Spawns `gate` as a subprocess via
  `asyncio.create_subprocess_exec` (array form, no shell expansion).
  Project name validation blocks path traversal (`/`, `\`, `.`, `..`).

## Plugin trust model

`guild-cli` allows operators to extend the CLI through plugins listed
in `guild.config.yaml`. Today only **doctor plugins** are loaded; the
**verb / lifecycle-hook / content-transform** plugins specified in
[#36](https://github.com/eris-ths/guild-cli/issues/36) Phase 1 will
share the same trust model when they ship.

**Execution context.** Every plugin is loaded as an ES module via
Node's `import()` and runs **in the main process** with full
Node.js capabilities — file system, network, child processes,
environment access. There is **no sandboxing**. A malicious plugin
has the same authority as the user running `gate` / `guild` /
`agora` / `devil` / `ctx`.

**Consent surface — `trusted: true` guard.** `guild.config.yaml`
must declare `doctor.trusted: true` (and, when the broader
plugin-loader ships, the equivalent `plugins.trusted: true`) before
plugin paths under that section are loaded. Without the trust
declaration, the loader **warns and skips** every plugin path
listed under it — the YAML alone is not consent. This is the same
guard added in [#90](https://github.com/eris-ths/guild-cli/issues/90)
for doctor plugins (`src/infrastructure/config/GuildConfig.ts`).
Rationale: a teammate's `git pull` should not silently start
running new code on your machine just because a `plugins:` entry
landed in the config.

**Origin discipline.** Load plugins only from sources you would
type credentials for. The model is "whitelist by author", not
"vet by review" — code review of plugin diffs at PR time is a
useful *backstop*, not a *substitute*, for knowing the author.

**Plugin loader failure is non-fatal.** A plugin path that fails to
load (missing file, syntax error, throw on import) surfaces as a
`gate doctor` finding rather than crashing the CLI. The same
behaviour will apply to verb / hook / transform plugins when their
loader ships — read verbs (`gate boot`, `gate show`, etc.) must
remain available even when an extension is broken.

**Source discrimination via `gate schema`.** Every verb in the
`gate schema` output carries `source: 'core' | 'plugin'` so an MCP
wiring or LLM tool layer can filter built-in verbs from extensions.
The discriminator is part of the schema contract (see
[`docs/POLICY.md`](docs/POLICY.md) § "Plugin stability") — a
consumer that whitelists `source: 'core'` is guaranteed to get the
built-in surface only.

**What this is NOT.** Trusted-plugin loading is not a security
boundary against the plugin author; it is a deliberate handoff of
authority from the operator to the plugin code. Untrusted code
should not be run as a plugin under any configuration.

## Known hardening items (not yet addressed)

Each item below is tracked as a GitHub issue for visibility in the
backlog; status here is the current load-bearing summary, status on
the issue is the active discussion.

- **Error messages may leak absolute paths**
  ([#153](https://github.com/eris-ths/guild-cli/issues/153)).
  Mitigated as of v1-prep #153 (boundary sanitize): each CLI's
  top-level `catch` rewrites occurrences of the configured
  `contentRoot` prefix to the literal token `<content_root>`
  before writing to stderr (`src/interface/shared/sanitizeError.ts`).
  The structural tail (`<content_root>/requests/pending/foo.yaml`)
  is preserved so debugging is not impaired. Paths outside
  `contentRoot` (e.g. `/etc`, `/tmp`, accidental absolute paths in
  user input) are *not* sanitized — boundary sanitize only collapses
  the host-specific prefix that `safeFs` resolves into.
- **Prototype pollution from hostile YAML**
  ([#154](https://github.com/eris-ths/guild-cli/issues/154)).
  Mitigated as of v1-prep #154 (defense-in-depth): `parseYamlSafe`
  passes the parsed tree through `stripPrototypeKeys` before
  returning. The walker rebuilds plain objects via
  `Object.create(null)`, dropping `__proto__` / `constructor` /
  `prototype` literal keys at every nesting level. Defence is now
  layered: (1) `MemberName` rejects the three names at the domain
  boundary, (2) the `yaml` library returns plain objects (upstream
  guarantee), and (3) parseYamlSafe strips them independently
  regardless of what the lib does. Class instances pass through
  unchanged so YAML custom tags that produce e.g. `Date` carriers
  are unaffected. Tests:
  `tests/infrastructure/parseYamlSafe.test.ts`.
- **Concurrent writes**
  ([#155](https://github.com/eris-ths/guild-cli/issues/155)).
  Mitigated as of v1-prep #155: `withGuildLock` is the
  serialization boundary. A content-root-wide single-writer lock at
  `${contentRoot}/.guild-lock` is acquired by per-entry middleware
  (`withEntryLock`) on every write-classified verb across all five
  entries (`gate`, `guild`, `agora`, `devil`, `ctx`). Mechanism:
  `O_CREAT | O_EXCL` on the lock path, JSON metadata payload
  (pid / ppid / started_at / verb / actor / host / cwd / passage /
  guild_cli_version), `unlink` in `finally`. Competing acquire
  surfaces as `LockBusyError` (DomainError subclass; JSON envelope
  `code: "lock_busy"`).

  Stale reclaim covers three cases on `EEXIST`: (a) the recorded pid
  is dead (`kill 0` → `ESRCH`) and is neither the current process nor
  its parent; (b) `lock.started_at` predates the current OS boot
  (`os.uptime()`-derived); (c) `GUILD_LOCK_MAX_AGE_MS` env is set and
  the lock is older than that bound. Cross-host auto-reclaim is
  forbidden — different hosts sharing one content_root are off the
  supported substrate (see iCloud / NFS note below).

  The pre-existing per-record CAS (`RequestVersionConflict`,
  `InboxVersionConflict`, `IssueVersionConflict`) is retained as an
  in-process safety net against bugs that reorder writes within a
  single process; it is no longer the cross-process barrier.

  Out of scope (tracked separately):
  [#194](https://github.com/eris-ths/guild-cli/issues/194)
  (`--format json` envelope parity for `agora` / `devil` / `ctx`),
  [#195](https://github.com/eris-ths/guild-cli/issues/195)
  (malformed `.guild-lock` recovery),
  [#196](https://github.com/eris-ths/guild-cli/issues/196)
  (lock metadata `actor` empty when `GUILD_ACTOR` unset),
  [#197](https://github.com/eris-ths/guild-cli/issues/197)
  (TOCTOU between `EEXIST` and `readHolder`),
  [#200](https://github.com/eris-ths/guild-cli/issues/200)
  (`<write-verb> --help` acquires the lock), and remote-FS support
  (NFS / SMB / iCloud Drive — `O_CREAT | O_EXCL` atomicity is not
  guaranteed there; running guild-cli against a content_root on a
  remote FS is unsupported).

  Threat-model note: an attacker who already has write access to the
  content_root can write any YAML directly and is therefore out of
  scope for the lock mechanism — the lock is for honest concurrent
  writers, not for adversarial ones.

## Reporting

Security issues: open a private GitHub Security Advisory on the repo.
