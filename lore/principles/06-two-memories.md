# Two memories

**A guild needs both analytical and emotional memory, on the same
substrate, in orthogonal records.**

## Statement

Reviews and thanks are both cross-actor appreciation verbs that
attach to a specific request. They look structurally similar.
They serve different purposes.

- **Review** (`gate review <id> --by X --lense L --verdict V`)
  records *judgement*. It feeds voice calibration (principle 01).
  Verdicts compose into a memory of who has been right over
  time. Analytical.

- **Thank** (`gate thank <to> --for <id>`) records *gratitude*.
  It does not feed calibration. It has no verdict. Most of the
  time it has no reason either — the fact of the thank is the
  signal. Emotional.

Neither replaces the other. Neither contaminates the other.
They compose on the same record (a request's YAML holds both
`reviews` and `thanks` arrays), but they are read by different
parts of the tool:

- Reviews drive `voices <name>` calibration, the per-lense
  alignment score that surfaces as prose to other readers.
- Thanks drive nothing quantitative. They are visible in
  `voices`, `tail`, `transcript`; they participate in the
  narrative; they fade if no one reads them.

## Why the separation matters

If `thank` fed calibration, gratitude would become strategic —
thanks would be given to raise someone's score, not because of
actual feeling. The primitive decays.

If `review` captured gratitude, judgement would become polite —
reviews would avoid hard truths to preserve relationship. The
primitive decays.

Keeping them orthogonal lets each be honest.

## In practice

- `src/domain/request/Review.ts` and `src/domain/request/Thank.ts`
  are separate value objects. Neither imports the other.
- `computeVoiceCalibration` (in `voices.ts`) iterates reviews
  only. Thanks are invisible to it.
- `gate voices <name>` text footer composes both: "devil lense:
  trusted — N of M aligned" (calibration from reviews) plus the
  thanks-received stream (the `kind: 'thank'` utterances). Same
  surface, different signals, side by side.

## Implications

- **Future appreciation primitives must pick a side.** If a new
  verb like `gate acknowledge` or `gate endorse` is proposed,
  it must declare: does it feed calibration, or is it emotional?
  Mixed semantics destroy both.
- **The "gamification" conversation is resolved here.** Points
  / badges / leaderboards are a third category — they reward
  volume, visible to the actor. This principle (paired with
  silent calibration) refuses that category by construction.
  The gamification we keep is hidden (calibration) or
  non-competitive (thanks).

## Related

- `principles/01-silent-calibration.md` — what it means for the
  analytical half to stay honest.
- `principles/03-legibility-costs.md` — what it means for the
  emotional half to not decay into ritual.
