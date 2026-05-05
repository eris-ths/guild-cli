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
| `executor` / `executor_actual` / `executor_preferred` | string | optional | tries the three keys in order |
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
executor: claude
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
`synthesis`, `lense-coverage`) ship without storage churn. See devil
issue #134 for the catalog/lense extension discussion.

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
