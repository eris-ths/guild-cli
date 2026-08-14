---
relevant_until: indefinite
---

# trap: the post-condition also holds when nothing happened

**Pattern.** A check reads a condition that is true *after* the action
succeeded — and is also true when the action never ran. The two worlds
produce the same reading, so the check confirms an event it never
observed. Unlike a guard that cannot fail, this one is perfectly
capable of going red; it is simply pointed at a world where the
distinction it needs was never present.

The shape is always the same triple collapsing into one appearance:

- **it has not happened yet**
- **it already happened**
- **it did not happen at all**

An invariant separates none of these. `stat` says a file exists — but
not whether *this* run wrote it. A tree hash is unchanged — but a merge
that aborted also leaves the tree unchanged. A status field reads
`in_progress` — but so does a stale copy of a run that finished.

Observed three times in one session (2026-08-14, dogfood outside this
repo), by three unrelated mechanisms:

1. **Stale artifact.** A mutation lane copied its whole working
   directory, including a previously built binary, then rebuilt with a
   mis-resolved source path. The build step declined with a skip and
   exited 0, so the *old* binary was measured. The mutation was never
   in the thing under test, and the lane reported the mutation had no
   effect.
2. **Aborted operation, unchanged invariant.** A merge was expected to
   leave the tree byte-identical (its content was already upstream).
   The merge hit a conflict and stopped — and the tree was, of course,
   byte-identical. The invariant was read as proof the merge had
   succeeded.
3. **Cached view of remote state.** A completed job was polled and kept
   returning `in_progress` from a cached response. Two further waits
   were spent on a run that had finished eleven minutes earlier.

None of these involved a check that could not go red. Each would have
gone red on the world it was meant to inspect. Each was reading a
different world.

## Why it survives

The reading is *correct* — that is what makes it durable. Nothing is
broken, no error is swallowed, no fallback fires. The check answers the
question it was asked. The defect is in the question: an invariant was
asked to testify about an event.

It also arrives dressed as rigour. Pinning a value, hashing a tree,
asserting byte-equality — these are the moves of someone being careful.
The care is real; it is aimed one step short of the claim.

## Trigger conditions for review

Flag any check where:

- **The asserted condition is also true before the action.** State it
  out loud: *what would this read if the step had not run at all?* If
  the answer is "the same thing", the check is not evidence.
- **An artifact is consulted without evidence that this run produced
  it.** Existence, size, and content are all properties of the file,
  not of the run. Freshness needs its own witness.
- **A setup step can decline and still exit 0.** Never-blocking startup
  is correct for a body that must come up anyway; inside a verifier it
  is a manufacturer of quiet greens. Same code, opposite sign, decided
  by which layer it sits in.
- **A remote status is read through anything that may cache.** Poll a
  monotonic field — an id, a completion timestamp, an attempt counter —
  not a status word that has the same value before and after.
- **An operation's exit status is discarded because its post-condition
  is checked instead.** These are not substitutes; the post-condition
  cannot see an abort.

## Fix shape

Pair every invariant with a **liveness witness** — something that is
demonstrably false before the action:

- `rc == 0` **and** the invariant, joined, never the invariant alone.
- Build into a directory the check just emptied, so the artifact cannot
  predate the build.
- Compare identity that advances: run id, `completed_at`, generation
  counter — then assert the invariant against *that* identity.
- When a step may legitimately decline, make declining loud enough to
  fail the verifier that depends on it (`⏭` that increments nothing is
  a pass in disguise).

## Relation to existing lore

Sibling to `trap_guard_measured_by_running_not_by_failing`, and the
distinction is worth keeping sharp: that trap is about a check with no
reachable red; this one is about a check whose red is reachable but
whose *subject* was substituted. Mutation-testing catches the former
and passes the latter — in observation 1 above, the mutation test
itself was the victim.

`trap_silent_fallback_loses_signal` explains why observation 1 stayed
quiet (a skip returned success), but not 2 or 3, where nothing was
caught and nothing degraded.

`trap_baseline_moves_with_its_subject` is the neighbouring failure on
the other side: there the reference moves with what it measures; here
the reference is fine and the *measured world* is the wrong one.

## Promotion history

Three observations, one session, one external dogfood repository, all
by the same actor — independent in mechanism, not in observer. Pinned
rather than promoted: the *felt-not-just-read* bar wants a sighting
from a second actor, or from inside `guild-cli`. Candidate second
sites: any verify lane that consults a build artifact it did not just
produce, and any `gate doctor` check that reads a file's presence as
evidence a write occurred.
