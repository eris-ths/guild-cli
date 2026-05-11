# Design — per-executor slice closure (#294)

Status: **Design lock proposal** — submitted to drive PR-A2 (schema
migration). Subsequent slices PR-B (wave-status pivot) and PR-C
(template-bound failure policy) sequence after PR-A2's merge.

## Problem recap

A multi-executor `gate request` lifecycle is wave-scoped:

```
pending → approved → executing → completed
```

When two executors split work into independent slices, only the actor
named on `gate complete` leaves a substrate-side terminal stamp for
the wave. The other executor's slice arc lives entirely off-substrate:
its terminal state is implicit in the git history (cherry-picked
commits) but invisible to `requests/completed/<id>.yaml` readers.

Two independent observations anchor the trigger:

- #230 (multi-executor request shape) surfaced the awkwardness when
  the field was introduced; per-executor closure was deferred.
- 2026-05-11 PR #291 swarm experiment hit it concretely: agent-issues
  completed the wave, agent-hookbus's terminal slice-state lives only
  in git history, not in the gate substrate.

## The chosen shape — Shape B (structured executors)

Change the substrate-side `executors:` from a flat `string[]` to a
structured `Executor[]`:

```yaml
# Before (current — flat names)
executors: [agent-issues, agent-hookbus]

# After (#294 — structured slice records)
executors:
  - name: agent-issues
    status: completed
    completed_at: 2026-05-11T01:00:00Z
    note: "issues.ts hardening — 2 commits cherry-pickable"
  - name: agent-hookbus
    status: completed
    completed_at: 2026-05-11T01:08:00Z
    note: "ctx.sessionEvent orthogonal field added"
```

Rejected alternative — Shape A (`gate slice-complete` intermediate
verb + `slice_log: []` array) — was discussed in the issue body. Two
reasons it loses:

1. Slice closure is **structural**, not lifecycle-internal. A reader
   asking "did agent-hookbus's slice land?" should read a field, not
   scan a log tail for the most recent entry naming the actor.
2. PR-B (`gate wave-status`) wants to read per-executor status
   directly. With Shape A it would have to scan a log; with Shape B
   it reads the field. The same shape supports both verbs.

## Verb surface — no new verb

`gate complete --by <executor>` is the only write verb for slice
closure. It is **redefined** (not extended) to mean "this executor's
slice is now terminal," with the wave-level transition derived:

- Setting `status: completed` on the named executor.
- If all executors are terminal (`completed | failed`) after this
  call, the wave itself transitions to `completed` (or `failed` per
  the composition rule, scoped to PR-C — phase 1 defaults are below).
- If some executors are still non-terminal (`pending | executing`
  on their slice), the wave stays in its current state. The verb
  succeeds — it stamps that one slice — but emits a notice listing
  the executors whose slices remain open:

  ```
  agent-issues slice marked completed; 1 executor slice still open:
    - agent-hookbus (status: executing)
  next: agent-hookbus must run `gate complete --by agent-hookbus` to
        close the wave.
  ```

Slice failure uses the same verb: `gate complete --by X --status
failed --note "..."` (the existing `gate fail` verb also remains, but
in PR-A2 it composes through this same field-set mechanism).

**Why no new verb**: the existing lifecycle verb already names the
semantic event ("X is done with their slice"). A `slice-complete`
verb would put orchestrators in the awkward position of remembering
which form to call when — wave-shape vs slice-shape. Reusing
`complete --by <executor>` keeps the surface flat and makes
"complete the wave" a derived event (all slices closed) rather than
a separate primitive that can drift from slice state.

## Wave-state composition rule (PR-A2 phase-1 default)

Until PR-C lands the template-bound policy, the phase-1 default is:

| Slice mix on last `complete` call | Wave state |
|---|---|
| All `completed` | `completed` |
| Any `failed`, rest `completed` | `failed` (any-fail-wave-fail) |
| Some still non-terminal | (no change — verb stamps the slice; wave stays) |

`any-fail-wave-fail` is the natural default for the most common
wave-shape (`parallel-impl`). PR-C generalizes by reading
`slice_failure_policy` from the wave's brief template
(parallel-impl → `any-fail-wave-fail`; compare-and-ratify →
`all-must-pass`; etc.).

The phase-1 default is **per-wave-shape rule**, not a global flag, so
PR-C is purely additive: it replaces the hard-coded default with a
table lookup keyed on `template`.

## Hydrate tolerance — legacy form

Pre-#294 records carry `executors: [name1, name2]` (or
`executor: name` for single, or the field absent entirely). Hydrate
normalizes:

```yaml
# legacy flat-array form
executors: [agent-issues, agent-hookbus]
↓ hydrate
executors:
  - { name: agent-issues, status: unknown }
  - { name: agent-hookbus, status: unknown }
```

`status: unknown` is the in-memory normalization; it does **not**
round-trip to disk. A read-then-resave of a pre-#294 record without
any mutation emits the same flat-array form it loaded — byte-stable
round-trip per principle 04.

`status: unknown` is the honest answer for "what was the slice state
of this executor on a record written before the field existed?" —
we cannot retroactively determine completion. The status surfaces in
`gate wave-status` (PR-B) as `?` so the operator sees the legacy
shape without misreading "unknown" as "incomplete."

Once any mutation lands on the record post-#294 (a `complete --by X`
call), the record migrates to the structured form on the next save.
This is one-way: a structured-form record cannot revert to the flat
form. Acceptable because the structured form is a strict superset of
the information.

## Mutation accounting — does slice status bump mutation_seq?

Yes. Per `RequestProps.mutationSeq` rationale (Devil REJECT root
cause on #244): any mutation that doesn't grow `status_log` /
`reviews` / `thanks` length must bump `mutation_seq` so concurrent
writers don't pass the optimistic-lock check on identical pre-
mutation length.

Slice closure DOES grow `status_log` (each `complete --by X` appends
an entry with `by: X` and a slice-scoped `note`). But the wave-level
state transition derived from the slice closure may or may not
append a second entry: when the closing call also closes the wave,
one call produces two log entries (one slice-stamp + one wave-
terminal). Tests must cover both shapes (last-slice-closes vs
intermediate-slice-only).

`mutation_seq` is not separately bumped — the log entries are
themselves the version delta. Same accounting as today.

## Migration concerns

### Read paths to update

Every handler that reads `executors` as a `string[]` of names must
change to read `e.name`. Inventory (from a grep at design time):

- `bin/gate.mjs` doesn't touch the field directly — handlers do.
- `src/interface/gate/handlers/`: boot, request, approve, execute,
  complete, show, fail, wave-status, claim, witness, unwitness.
- `src/passages/devil/`: lense lookups that read the executor names
  for "actor-axis" reviews.
- Tests that hand-craft YAML for executor records.

Mechanically: change `r.executors` (returns `readonly MemberName[]`)
→ getter renamed to `r.executorNames` (returns `readonly string[]` of
names) plus a new `r.executorRecords` (returns the structured form).
The membership predicate `r.hasExecutor(name)` stays unchanged in
shape — its internal lookup walks `r.executorRecords` and matches
on `.name`.

### Write paths to update

- `Request.complete(by, note?)` becomes
  `Request.completeSlice(by, note?, status='completed')`. The
  internal flow:
  1. Find the executor record matching `by`; if absent, `Request`
     stays the same (`complete` on an actor not in executors keeps
     the historical behavior of stamping the wave-level transition
     directly — for backward compat with pre-#294 records that have
     no executor list at all).
  2. Stamp `status`, `completed_at`, `note` on that record.
  3. Check if every executor record is terminal. If yes, fire the
     wave-level state transition. If no, leave the wave state and
     emit the "slices still open" notice.

- `Request.fail(by, reason)` same as `complete` but stamps
  `status: failed`.

### Test surface

- New tests: structured-form round-trip, legacy-form hydrate +
  resave-after-mutation migrates the record, partial-closure leaves
  wave in current state, last-slice-closure transitions wave,
  hasExecutor still works post-migration.
- Updated tests: every existing test that handcrafts an `executors:
  [a, b]` YAML stays valid (legacy form is tolerated forever); tests
  that read `r.executors` are updated to read `r.executorNames`.

## Sequencing

| PR | Scope | Closes |
|----|-------|--------|
| PR-A1 (this) | This design doc | N/A (drives the rest) |
| PR-A2 | Schema migration, `Request.completeSlice`, hydrate tolerance, handler updates, tests | Closes #294 contract; wave-status will keep working on legacy form via witness-inference until PR-B |
| PR-B | Pivot `gate wave-status` to read structured form, surface `?` for legacy `unknown` | (none — improvement) |
| PR-C | `slice_failure_policy` from template, replace phase-1 default with table lookup | #235 phase 2 |

PR-A2 is the load-bearing change. PR-B and PR-C are mechanical
follow-ups that improve surface UX without altering the substrate
shape.

## Out of scope (deferred)

- **Restart / reopen a closed slice** — once an executor's slice is
  terminal, no verb un-closes it. Re-doing a slice means filing a
  new request that links back. This matches how wave-level terminal
  is treated today.
- **Slice-level status_log** — each slice has only the current
  `status`. The history is the wave-level `status_log` with `by:`
  attribution. Adding per-slice log entries is theoretically
  possible but would compose poorly with `mutation_seq` and the
  byte-stable round-trip invariant; deferred until a use case
  surfaces.
- **Concurrent slice closes by different executors** — handled by
  the optimistic-lock token. Two simultaneous `complete --by` calls
  on the same wave race normally; second writer sees `mutation_seq`
  / log-length delta and retries.

## Decision summary

1. **Shape B** (structured executors with per-executor status).
2. **No new verb** — reuse `gate complete --by X` with redefined
   "per-slice" semantics; wave terminal is derived.
3. **Phase-1 composition default**: `any-fail-wave-fail`. PR-C
   replaces with template-bound policy.
4. **Hydrate tolerance**: legacy flat-array form → in-memory
   `{ name, status: 'unknown' }[]`; byte-stable round-trip until a
   post-#294 mutation lands, then the record migrates to structured
   form.
5. **Slice migration on save** is one-way and triggered by any
   mutation; legacy records that are never re-saved stay legacy
   forever.

## Disclosure

Drafted by eris during the 2026-05-11 close-out of the #291 dogfood
arc. The 2026-05-11 issue comment proposed template-bound failure
policy (PR-C); this design doc folds that proposal in as the PR-C
sequencing step rather than relitigating it.
