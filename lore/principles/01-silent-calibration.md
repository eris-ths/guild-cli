# Silent calibration

**The scored party cannot see the score.**

## Statement

When the tool keeps a quality score about an actor — how well
their review verdicts predict outcomes, how consistent their
contributions are, anything derived from their own behavior —
that score is shown to *other* readers, not to the actor
themselves.

## Why

A score you can see is a score you shape behavior around. The
moment a reviewer knows "my calibration is 0.6," they will push
verdicts toward the threshold, not toward honest judgement. The
signal decays into theater.

Hiding the score from its subject is not paternalism. It preserves
the raw behavior that makes the score informative. Other readers
still see the calibration prose when deciding how much to weight
this voice — they get the benefit without the gaming pressure.

## In practice

`gate voices <other_actor>` shows calibration ("devil lens:
trusted — 7 of 7 verdicts aligned"). `gate voices $GUILD_ACTOR`
hides it. Implemented in `src/interface/gate/voices.ts`
(`computeVoiceCalibration`) and `handlers/read.ts` (the
`isSelfView` check).

## Implications

- **No leaderboard.** Comparing actors to each other makes the
  score legible to all of them.
- **No achievements or badges.** These are scores made visible
  to the holder — the exact failure mode this principle refuses.
- **Derivative scores obey the same rule.** If a future feature
  composes calibration + thanks + something else into a
  "reputation," that composite must also be invisible to its
  subject.

## Related

- `principles/02-advisory-not-directive.md` — a cousin principle
  about keeping the tool from calcifying into authority.
- `principles/06-two-memories.md` — calibration is the analytical
  half; thanks is the explicit half. Both together.
