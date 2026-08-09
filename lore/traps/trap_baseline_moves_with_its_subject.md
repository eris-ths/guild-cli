---
relevant_until: indefinite
---

# trap: the baseline moves with its subject

**Pattern.** A guard compares the thing under test against a baseline
that is *derived from the same source as the thing under test*. The
comparison is well-formed, the guard runs, the guard is green — and it
is structurally incapable of ever being red. The two sides move
together, so no drift can open between them.

The canonical shape is "working tree vs `HEAD`":

```sh
build_from "$(git show HEAD:subject)" > baseline.out
build_from "subject"                  > current.out
cmp baseline.out current.out    # green on every committed state
```

Before the commit, the comparison is meaningful. **After the commit,
both sides build from the same `HEAD`** — so CI, which only ever sees
committed states, is green by construction. The guard reports on a
window that CI never observes.

Observed (2026-08-07, `exp/03-wasm-userland` dogfood, outside this
repo) in four guards at once. Each one claimed "the shipped artifact
is byte-identical to `HEAD` ∴ this change is additive." While they
claimed it, the artifact grew from 89,395 B to 93,644 B — **4,249
bytes of unobserved growth** across roughly two weeks. A second
failure mode compounded it: on the pre-commit path where a real
difference *could* appear, the guards reported `⏭` (skipped) rather
than incrementing the failure count — so the only branch that could
have gone red also could not fail the run.

## Trigger conditions for review

Flag any check where:

- **The baseline is computed, at check time, from the same repository
  state the subject is computed from.** `HEAD`, `origin/main` after a
  fast-forward merge, "rebuild it and compare to the rebuild", "diff
  against the last release tag we just moved" — all the same shape.
  Ask: *name a commit at which this goes red.* If the answer requires
  an uncommitted working tree, CI never sees it.
- **A guard's only failing branch is a skip.** `⏭` that leaves the
  failure counter untouched means the check has one reachable outcome.
- **A size, count, or duration is asserted "unchanged" without a
  literal.** "Unchanged relative to a moving reference" is not a bound.

## Fix shape

Pin the baseline as a **tracked constant** — a literal in a committed
file (`verify/init-wasm.baseline`), not a computation. Mismatch is red.
The machine never raises the constant; a human does, the same division
of labor as a coverage floor.

Two riders make the constant workable rather than merely annoying:

- **The red must print the delta as a number.** Otherwise every bump is
  a rubber stamp and a human ratchet degenerates into an automatic one.
- **Accept that it goes red often.** A byte-stable shipped artifact is a
  precondition several downstream claims rest on; if it moves, those
  conclusions move too, and the red is the notification.

## Why this belongs in trap memory here

`guild-cli`'s own persistence layer asserts byte-stable YAML as an
invariant, and its test suite compares emitted records against
fixtures. Those comparisons are safe *because the fixtures are tracked
literals*. The trap is what happens when someone, reasonably, replaces
a literal fixture with "regenerate the expected value and compare" —
the diff shrinks, the test still passes, and the guard quietly stops
guarding.

## Promotion history

Single observation (external dogfood, `exp/03-wasm-userland`,
2026-08-07). Pinned as a trap rather than promoted: the
*felt-not-just-read* bar wants a second, independent sighting inside
`guild-cli` itself. A likely second site is any future guard asserting
"record bytes unchanged" against a regenerated rather than committed
fixture.
