# Storage Format — On-disk YAML Contract

This document describes the YAML shapes guild-cli writes and reads
under `<content_root>/`. It exists because [`POLICY.md`](POLICY.md)
declares the on-disk shapes "stable surface" — and stable surface
that isn't documented quietly drifts.

Treat this as the **contract** for anyone:

- consuming substrate from another tool (parsing YAML directly)
- adding a new `Yaml*Repository` adapter
- changing field names, adding fields, or tightening hydrate
  tolerance in an existing repository
- reasoning about backward compatibility before a release

**Scope.** This is a description of the *current* shape, not a
redesign target. Format changes require a minor bump per
[POLICY.md § Versioning](POLICY.md#versioning).

---

## Conventions

- **YAML keys are `snake_case`.** Code uses `camelCase` internally;
  the boundary lives in each `Yaml*Repository`.
- **Timestamps are ISO-8601 strings** (e.g. `2026-05-05T08:13:53.376Z`).
  Always UTC, always millisecond-precision in fresh writes; older
  records may have second-precision and are accepted on read.
- **Identifiers** follow per-record formats (see each section).
  `RequestId` / `IssueId` accept both `YYYY-MM-DD-NNN` (3-digit legacy)
  and `YYYY-MM-DD-NNNN` (4-digit current) on read; new writes always
  produce the wider form.
- **Strict on write, tolerant on read.** Fresh writes go through
  domain `create()` (rejects malformed input). Hydrate goes through
  domain `restore()` (accepts historical malformations and applies
  documented fallbacks). PR #156 made this an explicit two-method
  pattern; see each repository's "Hydrate tolerance" subsection.

---

## Layout

| Record | Path under `<content_root>` (or `paths.*`) |
|---|---|
| Member | `<paths.members>/<name>.yaml` |
| Request | `<paths.requests>/<state>/<id>.yaml` (file moves between state dirs on transition) |
| Issue | `<paths.issues>/<id>.yaml` |
| Inbox file (per recipient) | `<paths.inbox>/<member>.yaml` |
| Agora Game | `<content_root>/agora/games/<slug>.yaml` |
| Agora Play | `<content_root>/agora/plays/<game-slug>/<play-id>.yaml` |
| Devil Review | `<content_root>/devil/reviews/<rev-id>.yaml` |
| Ctx | `<content_root>/ctx/<id>.yaml` |
| Observation | `<paths.observations>/<id>.yaml` |

`paths.*` are configurable via `guild.config.yaml`; the table shows
the configured path for each. Defaults: `members/`, `requests/`,
`issues/`, `inbox/` directly under `<content_root>`.

---

## Versioning (optimistic CAS)

Most repositories support concurrent-write detection via an
**implicit version** computed from on-disk state. The version is not
stored — it's derived per read, compared per write, and detected via
file-stat or content equality before the atomic rename.

| Record | Version expression |
|---|---|
| Request | `status_log.length + reviews.length + thanks.length` |
| Issue | `state_log.length + notes.length` |
| Agora Play | `(moves.length, suspensions.length, resumes.length)` tuple compared field-wise |
| Devil Review | `(entries, suspensions, resumes, re_run_history)` lengths |
| Inbox | **explicit** `version: number` field — incremented per write |
| Member, Game, Ctx | none — read-once-write-once |

Why implicit (except inbox): all of these records are append-only
collections of timestamped events. Length growth is the only mutation
shape, so the count is a sufficient sequence number without
introducing a stored field that could itself drift.

Inbox is explicit because it has a FIFO cap (`MAX_INBOX_SIZE`) — old
messages are dropped from the head, so length isn't monotonic.

The optimistic CAS is retained as an in-process safety net even after
`.guild-lock` (next section) became the cross-process serialization
barrier. CAS catches reordering bugs **inside** a single process;
the lock catches concurrency **between** processes.

---

## Cross-process serialization (`.guild-lock`)

Path: `${contentRoot}/.guild-lock`. Created by every write-classified
verb across all five entries (`gate`, `guild`, `agora`, `devil`,
`ctx`) via the `withEntryLock` middleware. Readers do not acquire the
lock.

Mechanism: `openSync(path, 'wx')` (i.e. `O_CREAT | O_EXCL`). The
holder writes a JSON payload, runs the verb, and `unlink`s the file
in `finally`. A competing acquire receives `EEXIST` and surfaces it
as `LockBusyError` — a `DomainError` subclass that maps to JSON
envelope `code: "lock_busy"` (gate path; other entries are tracked
in #194).

Lock metadata (treated as untrusted input on read — fields are
escaped before display):

| Field | Type | Purpose |
|---|---|---|
| `pid` | number | Holder's process id. Used for `kill 0` liveness check during reclaim. |
| `ppid` | number | Holder's parent pid. Debug aid; also feeds the ancestor-pid safety valve in reclaim. |
| `started_at` | ISO 8601 string | When the holder acquired. Used by both age-based and boottime-based reclaim. |
| `verb` | string | The verb being executed. Surfaced in the busy-error message. |
| `actor` | string | Resolved guild actor (env / `.guild-actor`). Currently empty when neither is set — see #196. |
| `host` | string | Holder's hostname. Recorded for diagnostics; **not** trusted in reclaim judgement. |
| `cwd` | string | Working directory at acquire. Helps disambiguate worktrees. |
| `passage` | string | Entry that acquired (`gate` / `guild` / `agora` / `devil` / `ctx`). |
| `guild_cli_version` | string | Version of the binary that wrote the lock. |

Stale reclaim (best-effort, single retry on `EEXIST`):

1. **Dead pid**: `kill(holder.pid, 0)` returns `ESRCH`, and
   `holder.pid !== process.pid && holder.pid !== process.ppid` (the
   ancestor-pid safety valve prevents reclaiming a still-running
   ancestor).
2. **Pre-boot lock**: `holder.started_at < (Date.now() - os.uptime() *
   1000)` — the lock predates the current OS boot, so the original
   process cannot be alive.
3. **Age cap**: `GUILD_LOCK_MAX_AGE_MS` env is set, holder is older
   than that bound. CI runners are expected to set this (e.g. 5
   minutes); local development normally leaves it unset.

If none match, the acquire fails with `LockBusyError` and surfaces
the holder's metadata. Cross-host auto-reclaim is not implemented —
multiple hosts sharing one content_root is off-substrate (NFS / SMB /
iCloud Drive: atomicity of `O_CREAT | O_EXCL` is not guaranteed and
running guild-cli there is unsupported).

Test-only env: `GUILD_LOCK_TEST_BARRIER=<file>`. When set, acquire
busy-polls for the file's existence before attempting `openExclusive`;
production callers leave it unset and the hook is a no-op. Used by
`tests/integration/lock/cross-passage-race.test.ts` to align spawned
children inside a ~5ms contention window.

Out-of-scope follow-ups: #194 (JSON envelope parity for non-gate
entries), #195 (malformed lock recovery), #196 (`actor` empty when
unset), #197 (TOCTOU between `EEXIST` and `readHolder`), #200
(`<write-verb> --help` taking the lock), #201 (race-test child
cleanup on barrier-wait timeout).

---

## Records

### Member

`<paths.members>/<name>.yaml`

| Field | Type | Required | Default on hydrate |
|---|---|---|---|
| `name` | string | optional | filename stem (e.g. `alice.yaml` → `alice`) |
| `category` | string | optional | `'core'` |
| `active` | boolean | optional | `true` (only `false` is honored) |
| `display_name` | string | optional | absent |

**Hydrate tolerance.** All fields fall back as listed. `displayName`
(camelCase) is also accepted for legacy reasons; new writes use
`display_name`.

```yaml
name: alice
category: professional
active: true
display_name: Alice
```

---

### Request

`<paths.requests>/<state>/<id>.yaml` — **file moves between state
directories on every transition** (pending → approved → executing →
completed / cancelled / denied / failed).

| Field | Type | Required | Default on hydrate |
|---|---|---|---|
| `id` | string (`YYYY-MM-DD-NNNN`) | required | — (validated by `RequestId.of`) |
| `from` | string (member name) | required | — (validated by `MemberName.of`) |
| `action` | string | optional | `'(no action)'` |
| `reason` | string | optional | `'(no reason)'` |
| `state` | string | optional | directory name (`stateHint`), else `'pending'` |
| `created_at` | ISO-8601 | optional | now (`created` accepted as legacy alias) |
| `executors` | array of `MemberName` | optional | each element validated by `MemberName.of`; empty array drops the field |
| `executor` (legacy, read-only) | string | optional | hydrated as `executors: [<value>]` if `executors` is absent; never written back |
| `executor_actual` / `executor_preferred` | string | optional (legacy) | tried in order if both `executors` and `executor` are absent |
| `auto_review` | string | optional | absent |
| `target` | string | optional | absent |
| `with` | string[] | optional | absent (each parsed as `MemberName`) |
| `promoted_from` | string | optional | absent (set when promoted from issue) |
| `status_log` | array of `StatusLogEntry` | optional | `[]` |
| `reviews` | array of `Review` | optional | `[]` |
| `thanks` | array of `Thank` | optional | `[]` |
| `completion_note` / `deny_reason` / `failure_reason` | string | optional (legacy) | back-filled into `status_log[-1].note` if missing there |

**`status_log[*]`**: `state` (required, entries without it skipped),
`by` (default `'unknown'`), `at` (default now), `note` (optional),
`invoked_by` (optional).

**`reviews[*]`**: `by`, `lense`, `verdict` (all coerced to string),
`comment` (default `''`), `at` (optional), `invoked_by` (optional).

**`thanks[*]`**: `by`, `to` (required), `at`, `reason`, `invoked_by`
(optional).

**Hydrate tolerance.**
- `action` / `reason` — empty after trim re-defaults to the
  `'(no ...)'` placeholder. This is the load-bearing tolerance the
  issue (#157) specifically called out; do not tighten without a
  minor bump.
- `executor` (singular, legacy) — records written before
  [#230](https://github.com/eris-ths/guild-cli/issues/230) use a
  singular `executor: <name>` field. gate reads them transparently
  as `executors: [<name>]` and rewrites them in the new array form
  on the next save (no in-place migration; the rewrite happens
  organically when the request transitions state). External tooling
  reading raw YAML should expect either shape until all live records
  have been touched at least once.
- `state` — falls back to the parent directory name (CLI invariant
  is "the state matches the directory"). If that fails too,
  `'pending'`.
- Legacy closure keys — `completion_note` / `deny_reason` /
  `failure_reason` are back-filled into the last `status_log` entry's
  `note` if that note is missing. If both the legacy field and
  `status_log[-1].note` are present and disagree, the repository
  surfaces a warning via `onMalformed` and prefers `status_log`.

**Worked example** (a completed request):

```yaml
id: 2026-05-05-0001
from: alice
action: ship the agora touch-feel patch
reason: noir's devil review surfaced a consistency break across 4 verbs
state: completed
created_at: 2026-05-05T08:13:53.376Z
executors: [claude]
status_log:
  - state: pending
    by: alice
    at: 2026-05-05T08:13:53.376Z
  - state: approved
    by: nao
    at: 2026-05-05T08:30:00.000Z
    note: looks good — proceed
  - state: executing
    by: claude
    at: 2026-05-05T08:31:00.000Z
  - state: completed
    by: claude
    at: 2026-05-05T08:42:00.000Z
    note: PR #186 merged
reviews:
  - by: noir
    lense: layer
    verdict: ok
    comment: contract holds; no concerns at this layer
    at: 2026-05-05T08:35:00.000Z
thanks: []
```

**Worked example** (a parallel-impl wave with multiple executors,
post-[#230](https://github.com/eris-ths/guild-cli/issues/230)):

```yaml
id: 2026-05-08-0003
from: eris
action: docs + src split fix for #230 multi-executor wave
reason: devil review flagged doc drift; parallel impl preserves attribution
state: executing
created_at: 2026-05-08T09:00:00.000Z
executors: [miki, leysia]
status_log:
  - state: pending
    by: eris
    at: 2026-05-08T09:00:00.000Z
  - state: approved
    by: nao
    at: 2026-05-08T09:05:00.000Z
  - state: executing
    by: miki
    at: 2026-05-08T09:06:00.000Z
    note: kicked off; leysia on docs, miki on src
```

Single-executor records are still written in the new shape
(`executors: [miki]`, not `executor: miki`) — uniformity matters
for downstream parsing, and `gate show --format text` always
prints the plural `executors:` label regardless of arity.

**`--format json` back-compat.** `gate show --format json` emits
both `executors: <array>` (canonical) and `executor: <string>`
(deprecated, equal to the first element of `executors`) for one
release. The singular `executor` JSON key is scheduled for removal
in v0.7; consumers should migrate to `executors`.

---

### Issue

`<paths.issues>/<id>.yaml`. Issues are lighter-weight than requests
(no state-dir layout — just one flat file per id).

| Field | Type | Required | Default on hydrate |
|---|---|---|---|
| `id` | string (`i-YYYY-MM-DD-NNNN`) | required | — |
| `from` | string | required | — |
| `severity` | string (`critical|high|med|low`) | required | — |
| `area` | string | required | — |
| `text` | string | required | — |
| `state` | string (`open|in_progress|resolved|wontfix`) | optional | `'open'` |
| `created_at` | ISO-8601 | optional | now |
| `invoked_by` | string | optional | absent |
| `notes` | array of `{ by, text, at, invoked_by? }` | optional | `[]` |
| `state_log` | array of `{ state, by, at, invoked_by? }` | optional | `[]` |

**Hydrate tolerance.** Required top-level fields (`id`, `from`,
`severity`, `area`, `text`) error if missing — no fallback. State
(top-level + log entries) parses through `parseIssueState`; unknown
enum values are skipped from `state_log` with a warning rather than
failing the whole record.

---

### Observation

`<paths.observations>/<id>.yaml`. **Append-only.** There is no state
field, no state log, and no version counter — an observation is a
machine-emitted fact about a run that already happened, so there is
nothing to transition and nothing for two writers to race over. The
repository port exposes `saveNew` and no `save`; the absence is the
invariant.

Everything in this directory is machine-origin *by construction*. That
is the point of it being a separate store rather than a flavour of
request: a projection asking "what did a person decide?" reads
`requests/` and is done, with no prefix matching and no discriminator
field anyone has to remember to set.

| Field | Type | Required | Default on hydrate |
|---|---|---|---|
| `id` | string (`o-YYYY-MM-DD-NNNN`) | required | — |
| `kind` | string (`rom`) | required | — |
| `by` | string (member name) | required | — |
| `at` | ISO-8601 | required | — |
| `subject` | string (request id) | optional | absent |
| `source` | string (emitting tool, e.g. `rom-stamp`) | optional | absent |
| `envelope` | mapping (kind-specific body) | required | — |

For `kind: rom` the `envelope` is a v1 `RomPlugin` report — see
`docs/design/rom-plugin.md` for the contract and
`src/domain/rom/RomEnvelope.ts` for the checks.

**Hydrate tolerance.** Deliberately low. `kind`, `id`, `by` and the
envelope all error out rather than falling back, and the envelope is
re-validated in full on every read — a record hand-edited into an
inconsistent state must fail when it is read, not be trusted because it
passed once on write. Unknown top-level keys are ignored, so an engine
whose wire format is ahead of this table keeps validating.

**Size.** The envelope is bounded by the engine's declared window
count: every variable-length field (`engine.names`, `capabilities.
used_names`, `policy.granted`, `policy.denied`, `timeline`) holds at
most one entry per declared window, so the whole record grows linearly
in that one number and in nothing else. Small in practice — the
reference engine's is under 2 KB. `docs/storage-format.md` still states
no general per-record size discipline; this record does not establish
one, and a future kind with an unbounded body should be pushed to a
digest reference instead of inlined here.

**One-directional link.** `subject` names the wave an observation
belongs to; the request record does **not** list its observations. A
completed wave is terminal, and letting later machine output mutate it
would make it not so. Readers join from this side
(`gate rom list --for <request-id>`).

---

### Inbox

`<paths.inbox>/<member>.yaml`. One file per recipient; messages are a
capped FIFO ring (`MAX_INBOX_SIZE = 500`).

```yaml
version: 17                       # explicit, increments per write
messages:
  - from: alice                   # member name or external string
    to: claude                    # always the recipient (= filename stem)
    type: request_created
    text: 2026-05-05-0001 created — please review
    at: 2026-05-05T08:13:53.376Z
    read: false                   # boolean, mutable via gate inbox mark-read
    related: 2026-05-05-0001      # optional cross-reference
```

**Versioning**: explicit (see [Versioning](#versioning-optimistic-cas)).
**Read mutation**: `read: false → true` is the only field allowed to
flip post-write; `read_by` (member who marked it) is appended atomically.

---

### Agora Game

`<content_root>/agora/games/<slug>.yaml`

| Field | Type | Required | Default |
|---|---|---|---|
| `slug` | string | optional | filename stem |
| `kind` | string (`quest|sandbox`) | optional | `'quest'` |
| `title` | string | optional | `''` |
| `description` | string | optional | absent |
| `created_at` | ISO-8601 | optional | now |
| `created_by` | string | optional | `'unknown'` |

No nested arrays. No versioning (read-once-write-once).

---

### Agora Play

`<content_root>/agora/plays/<game-slug>/<play-id>.yaml`. Per-game
subdirectories give each game its own `YYYY-MM-DD-NNN` id sequence.

| Field | Type | Required | Default |
|---|---|---|---|
| `id` | string (`YYYY-MM-DD-NNN`) | optional | `''` (downstream errors will catch) |
| `game` | string | optional | parent directory slug (`gameSlugHint`) |
| `state` | string (`playing|suspended|concluded`) | optional | `'playing'` |
| `started_at` | ISO-8601 | optional | now |
| `started_by` | string | optional | `'unknown'` |
| `moves` | array | optional | `[]` |
| `suspensions` | array | optional | `[]` |
| `resumes` | array | optional | `[]` |
| `concluded_at` / `concluded_by` / `concluded_note` | string | optional | absent (only present once `state == concluded`) |

**`moves[*]`**: `id`, `at`, `by`, `text` — **all four required per
entry**; missing-field entries are silently dropped on read (not
back-filled — the contract is that move text is always authored, so
a missing field signals real corruption).

**`suspensions[*]`**: `at`, `by`, `cliff`, `invitation` — all required.

**`resumes[*]`**: `at`, `by` required; `note` optional.

---

### Devil Review

`<content_root>/devil/reviews/<rev-id>.yaml`. `<rev-id>` is
`rev-YYYY-MM-DD-NNN`.

| Field | Type | Required | Default |
|---|---|---|---|
| `id` | string | optional | `''` |
| `target` | object | required | — (cast as-is, no tolerance — the schema is enforced upstream by `target.type`) |
| `state` | string (`open|suspended|concluded`) | optional | `'open'` |
| `opened_at` | ISO-8601 | optional | now |
| `opened_by` | string | optional | `'unknown'` |
| `entries` | array | optional | `[]` |
| `suspensions` | array | optional | `[]` |
| `resumes` | array | optional | `[]` |
| `re_run_history` | array | optional | `[]` |
| `conclusion` | object `{ at, by, synthesis, unresolved: string[] }` | optional | absent (only present when `state == concluded`) |

**Entry / suspension / resume / re-run shapes** are defined in
`src/passages/devil/domain/Entry.ts` and validated at the domain
layer rather than the YAML hydrate. The repository passes arrays
through as `unknown[]` — this lets new entry kinds (`mirror`,
`synthesis`, `lense-coverage`) ship without storage churn.

**`entries[*].lense_source`** (#134 G) — optional, only persisted
when the entry's lense came from a `<content_root>/devil/lenses/*.yaml`
extension (value: `extension`). Bundled-catalog lenses omit the field
to keep the common-case YAML terse; readers treat absence as
`bundled`. Pinning provenance at write time means a future bundled
catalog that adds the same name cannot retroactively reinterpret an
older entry — the record disambiguates itself.

**Per-content_root lense extension files** live at
`<content_root>/devil/lenses/<name>.yaml` (one lense per file). Same
shape as `Lense.create` input — `name` / `title` / `description` /
optional `ingest_sources` / `delegate` / `examples`. Loaded by
`ComposedLenseCatalog` on top of the bundled defaults; name collisions
fail loud at startup (extend-only — see #134 G).

---

### Ctx

`<content_root>/ctx/<id>.yaml`. Flat directory, no per-actor
subdirectories.

| Field | Type | Required | Default |
|---|---|---|---|
| `id` | string | optional | filename stem |
| `created_at` | ISO-8601 | optional | now |
| `created_by` | string | optional | `'unknown'` |
| `fact` | string | optional | `''` |
| `tags` | string[] | optional | `[]` (non-string entries filtered out) |

No versioning (v0 is read-once-write-once). Future iterations may
introduce `updates: [...]` for incremental fact refinement; at that
point a versioning rule will be added here.

---

## Backward-compat rules

Cross-link from [POLICY.md § Stable surface](POLICY.md#stable-surface).

| Change | Bump | Notes |
|---|---|---|
| Add a new optional field with a hydrate default | **patch** | Old readers ignore the unknown key; old writers don't emit it (defaulted on read for new readers). |
| Rename a field | **minor** + migration note | Both names accepted on read for one minor cycle; new writes use the new name. |
| Remove a field | **minor** + migration note | Hydrate continues to accept and discard for one minor cycle. |
| Add a new required field | **minor** + migration note | Existing records hydrate via a documented default; CHANGELOG names it. |
| Tighten a tolerant fallback for fresh writes | **patch** | Only if `restore()` keeps the tolerant path. PR #156's `Review.create` (strict) vs `Review.restore` (tolerant) is the canonical example. |
| Tighten the `restore()` path | **minor** + migration note | This is the only change that breaks reads of historical data. |
| Add a new entry kind to a `passages/devil/domain/Entry.ts`-style domain enum | **patch** | Repository passes `unknown[]` through; old readers see them via `kind: <new-kind>` and the Entry restore decides. |

---

## See also

- [`POLICY.md`](POLICY.md) — versioning + stable surface index
- [`SECURITY.md`](../SECURITY.md) — known hydrate hardening items (#154)
- [`AGENT.md`](../AGENT.md) — actor-facing shape (cross-passage)
- `src/infrastructure/persistence/` — Yaml*Repository implementations
- `src/passages/*/infrastructure/Yaml*Repository.ts` — passage-specific
