---
relevant_until: indefinite
---

# trap: a guard measured by whether it runs, not by whether it can fail

**Pattern.** A check is counted as coverage because it executes and
reports green. Nobody asks the prior question — *is there an input
that makes this red?* A guard with no reachable failure is
indistinguishable, from the outside, from a guard that passes. Both
print the same green, and the green is what gets counted.

The asymmetry that keeps it alive: **a broken verifier survives
silently only when it fails in the direction of the expectation.** We
write checks to confirm what we already believe, so a check that always
confirms feels correct. Re-running it reproduces the green, and
reproducibility gets mistaken for evidence.

Observed (2026-08-04, `exp/03-wasm-userland` dogfood, outside this
repo): of four newly written guards, **two could not express the named
failure**. Two distinct mechanisms:

1. **The assertion did not touch the caller's use of the value.** The
   check asserted a pure mapping in isolation; mutating how callers
   consumed the result left it green. (Contrapositive worth keeping: a
   check that asserts the *returned value itself* does not need a
   separate mutation test — a blanket "mutation-test everything" rule
   becomes ritual.)
2. **The body it ran on could not host the failure.** A width-narrowing
   cast is the identity on a 64-bit host; a comptime-eliminated branch
   never executes. The guard was well-formed and structurally unable to
   fire *on that machine*.

The measurement cost is small: one mutation, 30–60 seconds.

## Trigger conditions for review

Flag any new or modified check where:

- **Nobody can name the input that turns it red.** Ask for the
  concrete case, not a category. "It would fail if the parser broke"
  is a category; "feed it this record with the field removed" is an
  input.
- **The failure branch was never observed.** A guard whose red has
  never been seen is a guard whose red is a hypothesis. Break it once,
  on purpose, and watch it go red before trusting the green.
- **The check counts a skip as a pass.** `⏭`, "environment not
  available", `|| true` on the assertion itself — the run is reported
  as covered while the assertion never evaluated.
- **The number of questions exceeds the number of exit codes.** One
  command yields one status; questions past the first cannot carry
  news of their own failure. Split composite probes so each clause
  returns independently.
- **`grep -c` / `|| echo 0` on the counting path.** Zero matches and
  empty input collapse into the same green.

## Fix shape

Two moves, in order:

1. **Mutate and confirm red.** Introduce the defect the guard names,
   run it, require a non-zero status *and* a message that names the
   defect. Then revert. Do this at authoring time, not as a later
   audit — the authoring moment is the only one where the intended
   failure is still precisely known.
2. **Aim the mutation at the deciding code, not the reporting code.**
   A related miss from the same session: a red-lane probe was fired at
   a size field while the comparison was over a hash, so the mutation
   produced green. The mutation must land where the decision is made.

## Relation to existing lore

This is the constructive counterpart to
`trap_silent_fallback_loses_signal` — that trap is about a *result*
that hides its own degradation; this one is about a *check* that hides
its own inability to degrade. Both produce an authoritative-looking
green with no signal underneath, and both are caught by asking what
the red would have looked like.

It is also the enforcement arm of
`trap_baseline_moves_with_its_subject`: a baseline that moves with its
subject is one specific way to build a guard that cannot fail. This
trap is the general test; that one is the most common instance.

## Promotion history

Single observation (external dogfood, `exp/03-wasm-userland`,
2026-08-04). Pinned rather than promoted pending a second independent
sighting inside `guild-cli`. Candidate second sites: any test asserting
a projection is "stable" without a mutated-input case, and
`gate doctor` findings that report a clean sweep when the sweep found
nothing to inspect.
