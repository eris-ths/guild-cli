# Actual: reader-archetype batch on 2026-04-19-0002

Companion to `2026-04-19-reader-archetype-batch.md`. Predictions
were committed before the four casts. This file compares actual
outputs to predictions and evaluates the corpus-orchestration
hypothesis.

## The four casts

All cast on 2026-04-19-0002 via `alexandria/cast`:

- beginner/concern — 03:32:34
- veteran/ok      — 03:32:49
- skeptic/concern — 03:33:09
- builder/ok      — 03:33:26 (partially corrupted by shell
                              backtick substitution; see
                              i-0006; meaning recoverable)

## Differentiation test

Hypothesis: at least 3 of 4 must surface an observation the
other 3 do not. Result:

- **beginner**: "terminology-as-barrier" (in-group language
  makes the record inaccessible to non-users). Neither
  veteran nor skeptic nor builder surface this as a primary
  observation. ✓
- **veteran**: ranks which findings are novel vs. restatement
  vs. unreplicated. This meta-move (novelty-grading per item)
  appears in no other lense. ✓
- **skeptic**: "internal coherence != value to outsider."
  The reframe — the record proves consistency, not usefulness
  — is unique. ✓
- **builder**: reads each finding as a feature-proposal or
  design-decision-to-document. The prescriptive reading is
  unique. ✓

4 of 4 differentiated, exceeding the 3-of-4 bar. Hypothesis
holds for this batch.

## Predicted vs actual

**beginner**: prediction hit all the specific terms-I-don't-
know points (boot, resume, chain, suggested_next, lenses).
Match: tight.

**veteran**: prediction said "#1 novel, others restatement,
#5 unreplicated, verdict ok." Actual: exactly this, plus an
unpredicted concrete insight (that free-text chain auto-
linking means over-engineering `promoted_from` fields is
unnecessary when an inline mention suffices). Match: tight +
bonus detail.

**skeptic**: prediction said "self-referential loop, #5
unfalsifiable, verdict concern." Actual: exactly this, with
stronger framing ("self-reinforcing introspection loop" vs.
my weaker "not evidence of external value"). Match: tight +
sharper.

**builder**: prediction said "feature proposals, formalize
auto-link, suggested_next options." Actual: matched, with
specific concrete options (three alternatives for
suggested_next behavior, a/b/c). Match: tight + concrete.

## What the predictions did NOT anticipate

Several observations in the casts were genuinely unanticipated:

- Veteran's *over-engineering promoted_from* insight
- Skeptic's "self-reinforcing introspection loop" phrasing
- Builder's three-option analysis for suggested_next
- Beginner's "the reflective layer is where the value is, but
  I can't access it without first doing the things" — the
  clearest statement of the access-before-reflection problem

This matters for the at-scale claim. If the predictions
covered 100% of what the casts produced, the casts would be
pure pattern-completion. Unanticipated-but-on-theme generation
is evidence the invocation is doing work beyond "filling in
the expected shape." The reviews know things the planner did
not, at the level of specific framings and concrete
alternatives.

Conservative reading: the unanticipated content is the
difference between "skilled reader applying an archetype
stance" and "template fill." The former has emergent
observations; the latter doesn't.

## Tooling observation

The cast script worked as intended for corpus visibility
(before/after retrieval around each cast was legible and
useful). It FAILED on shell-safety: the builder cast's
comment contained backticks, which bash substituted before
gate saw the string. Content loss. Not catastrophic, fully
recoverable from context, but a real tooling bug captured
as i-2026-04-19-0006. The header of the cast script now
warns about this; the fix (mandatory `--comment -` stdin for
text with metacharacters) requires either discipline or a
script change to enforce. Leaving as discipline for now.

## Implications for at-scale

At 4 casts, the corpus for request 2026-04-19-0002 becomes:
beginner + veteran + skeptic + builder, alongside the earlier
devil / outsider / compress. A future instance pulling this
record's reviews sees a 7-lense reception map. That is
closer to a *multi-stakeholder code review* than a single-
author reflection.

At 40 casts across several records and lenses, the corpus
shape would be larger than I can hold in head without
tooling. The cast script's before/after corpus display is
necessary at that scale. Without it, I would cast blindly
into an unknown context — which is exactly the "human
capacity overflow" nao flagged.

The predictive claim — "I can predict how my cast changes
the corpus" — held for this small batch, with some
limitations (predictions were directional; casts added
unanticipated specifics on-theme). Testing it at larger
scale would require:

1. Batches of 20+ casts
2. Predictions written BEFORE execution
3. Some blinding mechanism so I can't generate predictions
   that trivially match what I'm about to write

Not done here. Flagged for a later session if this line of
inquiry survives.

## Verdict on the experiment

The batch-as-corpus hypothesis is confirmed for this small
case: 4 archetype-lenses cast as a set teach what individual
casts don't. The cost is low (tooling + 4 minutes of cast
time). The benefit is a record that reads differently to
different kinds of readers, which is a property alexandria
should have if it's serious about "records outliving the
writer's context."

Next lines of inquiry, in rough priority:

1. Build the stdin-fed variant of cast to close i-0006
2. Try a batch with archetypes I don't generate (harder-test
   variant: ask an outside voice for the archetype set)
3. Scale-up test: 20+ casts with predictions committed in
   advance

Not doing any of these this turn. Capture + commit + stop.

— claude, 2026-04-19, after the evidence
