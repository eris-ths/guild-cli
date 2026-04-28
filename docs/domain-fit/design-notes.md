# Design notes

Intuitions the domain tour surfaced. Not design decisions — these
are claims the reader should be able to push back on. Where a
claim gets rejected, strike it through and add the replacement
rather than deleting; the evolution is part of the record.

## The core claim

> **Gate's state machine is not a time axis. It is a
> social-contract protocol between principals.**

The 4 non-terminal states (pending → approved → executing →
completed) plus the 2 early terminals (denied, failed) look like
they encode time, but a careful read says they encode something
tighter:

1. **Declare → sanction gap** (pending → approved). A different
   principal than the author confirms the work may proceed.
2. **Sanction → execute gap** (approved → executing). The
   decision moment is separable from the action moment, often
   with a third principal doing the executing.
3. **Observable execution duration** (executing → completed).
   Work that has beginning and end, not a one-shot event.

None of these are "time" in the wall-clock sense. They're
positions in a social protocol. If one person does all three
roles simultaneously, the gaps collapse — which is exactly what
`fast-track` codifies as an escape valve.

## The dual: review lenses as perspective separation

Where the state machine separates principals across _time_, the
review-lens mechanism separates principals across _perspective_.
A single request can carry multiple reviews at the same moment in
its lifecycle, each from a different lens (devil / layer / user /
…). Each lens is effectively a distinct voice commenting on the
same artifact.

The two separations are **orthogonal axes**:

```
                  sanction separation
                  (state machine)
                        ↑
                        |   [max fit zone]
                        |   incident post-mortem
                        |   meeting
                        |
                        +───────────> perspective separation
                                       (review lenses)
                        |
            [partial] fast-track       [partial]
            all-at-once                multi-voice
            solo journal               game design
            research log               story critique
```

- **Top-right quadrant** (both axes active): incident
  post-mortem, meeting. These are where gate was designed for
  and where it feels best.
- **Top-left** (state machine active, single perspective):
  deployment pipelines, compliance workflows. Gate handles them
  but the review machinery sits mostly unused.
- **Bottom-right** (single principal in time, many voices):
  solo journal, game-design brainstorming. Review lenses carry
  the weight; state machine is overhead and `fast-track` is
  always the answer.
- **Bottom-left** (neither axis active): plain note-taking,
  bookmarking, diary. Don't use gate — a text file does this.

## Predictive taxonomy

If the claim holds, we should be able to predict fit for a new
domain just by looking at whether its native structure has each
axis.

| Domain | declare/sanction gap? | multi-perspective? | prediction | observed |
|---|---|---|---|---|
| Contract law | ✓ (draft → agreement) | ✓ (each party's legal view) | max | not tested |
| Clinical procedures with consent | ✓ (diagnosis → patient consent → procedure) | ✓ (patient/MD/ethics) | max | not tested |
| Academic peer review | ✓ (submit → editor → reviewers) | ✓ (each reviewer) | max | not tested |
| Incident post-mortem | ✓ | ✓ | max | ✓ confirmed |
| Meeting decisions | ✓ | ✓ | max | ✓ confirmed |
| Recipe iteration | △ (taste ≈ sanction?) | ✓ (taste/health/cost) | partial | not tested |
| Diary | ✗ | ✗ | skip | ✓ confirmed (would be overhead) |

When you sit with an uncertain domain and ask "is there a
sanction gap here, really?", the answer usually resolves the fit
question cleanly. "Recipe iteration" is an example where
reasonable people disagree — does tasting-before-serving count as
sanction? That ambiguity IS the prediction: the domain is in the
middle and will feel partial.

## Consequences for design

Some consequences that follow if the claim is right:

1. **The state machine isn't "about time"; marketing and docs
   that say so mislead.** More accurate: "gate records
   deliberative multi-principal work." The time thing is a
   surface feature of the social protocol underneath.

2. **Fast-track is not a shortcut, it's a declaration**: "no
   sanction gap in this particular case." Treat it as part of
   the contract vocabulary, not an afterthought.

3. **Custom lenses are already a principal-separation mechanism
   on the perspective axis.** There's currently no analogue on
   the time axis — no way to declare "this domain's sanction
   protocol is not approve/execute/complete, it's submit/review/
   publish." See `open-questions.md` for whether this matters.

4. **Domain conventions = choosing which axis to activate.** The
   6-domain tour in `domain-conventions.md` shows that every
   domain can be modeled by choosing consciously which
   separations matter. Story mode chose to collapse the time
   axis (fast-track) and keep the perspective axis (narrator/
   character/critic lenses). Incident mode used both. This is
   the right register for domain conventions: declare the
   separations the domain has.

## What the claim doesn't explain

- **Why append-only feels right across _every_ domain.** The
  six-domain tour didn't produce a single case where append-only
  was a problem, including story mode (where wall-clock order
  ≠ story order, but even there, the solution was "add overlay
  metadata," not "make it mutable"). Append-only seems to be a
  more foundational invariant than the time/perspective axes.
  It might be the "what" gate does; the axes might be the "when
  it helps vs. when it's overkill."

- **The role of issues and chain** across domains. Both worked
  in every domain. Issues seem to model "open threads" at any
  granularity; chain surfaces reference structure regardless of
  whether the records are deliberative. These two features might
  generalize further than the axes framework suggests.

- **The emotional/affective dimension**, especially for the solo
  journal case. The framework treats principals as interchangeable;
  the real reason solo-journal worked was the affordance of
  externalizing an internal voice and then seeing it in writing.
  That's not a property of principal separation; it's a property
  of records-as-mirrors. The framework may be under-specifying
  this. (See also `lore/principles/07-perception-not-judgement.md`
  — the tool as a lens that sharpens perception without closing
  the judgement loop. The mirror effect may be a specific instance
  of that broader posture.)

## Earlier framings (kept for posterity)

Earlier version of the central claim read:

> Gate's state machine encodes time; domains whose native time
> structure matches get the benefit.

This was wrong in an important way: it made "time" the central
abstraction, when the observed pattern was that _time_ was
always present but the _principal separation_ was the thing that
varied between fitting and non-fitting domains. A clock ticks in
every domain; what varies is whether different principals control
different parts of the record's lifecycle. The corrected version
(above) makes principal separation central and time the surface.
