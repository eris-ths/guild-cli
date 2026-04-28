# Perception, not judgement

**The tool sharpens what you see. It does not decide what you do.**

## Statement

`gate` structures facts so that a reader — human or agent — can
perceive patterns with less effort. It does not close the
interpretive loop: it will not tell you whether a pattern is a
problem, whether a concern has been adequately addressed, or
whether the next action it suggests is the right one.

The difference is load-bearing. A tool that structures facts is
an instrument of perception. A tool that closes the judgement
is an authority. The first amplifies the reader; the second
replaces them.

## What this looks like in code

`gate chain <id>` walks one hop of cross-references in both
directions and shows them. It does not say "these two records
are related because..." — the relationship's *meaning* is the
reader's to assign.

`UnrespondedConcernsQuery` is "deliberately coarse" (its own
header comment). It checks whether any follow-up record mentions
the concern's request id after the concern was filed. If one
exists, the whole request is dropped. It does NOT try to detect
partial-close (two concerns, one addressed). That judgement is
returned to the reader — and if they want to verify, `gate chain`
walks the actual references. The tool surfaces the shape; the
reader reads it.

`computeVoiceCalibration` produces "7 of 7 verdicts aligned with
outcomes" — prose, not a numeric badge. It says "trusted" or
"still learning," not "this reviewer is reliable" or "ignore
this reviewer." The score informs perception; it does not issue
a directive.

`gate doctor` reports findings by area. It does not assign
severity. `self-loop-check.mjs` flags a pattern and says "the
check is a DETECTOR, not an enforcer." `gate transcript` renders
the narrative arc of a request in prose — the story of what
happened, not an evaluation of whether it went well.

`gate resume` stacks open loops by urgency. `gate suggest`
picks one and says "this next." Both carry the `advisory`
marker (principle 02). But the deeper shape is not that they
disclaim — it is that they structure the reader's *perception*
of what is unfinished, what is blocking, what is waiting. The
decision of which loop to close, and how, stays with the reader.

## Why this is distinct from "advisory, not directive"

Principle 02 says: when the tool offers a recommendation, label
it as a recommendation. That is about *labeling* — a honesty
discipline on a specific surface.

This principle is about the tool's *posture*. It describes what
the tool is *for*: structuring perception. Not just
`suggested_next`, but every read verb, every diagnostic, every
narrative rendering. The tool's job is to make the record legible
enough that the reader's own judgement can engage. It is a lens,
not an oracle.

## Implications

- **Resist auto-close on concerns.** If a future feature detects
  "this follow-up addresses concerns 1 and 3 but not 2," the
  detection should surface as a *hint* ("partial coverage
  detected"), not as an action ("concern 2 auto-reopened").
  The reader decides whether partial coverage is sufficient.
- **Diagnostic severity belongs to the reader.** `gate doctor`
  findings carry `kind` and `area`, not `severity: high`. A
  `yaml_parse_error` in a member file and one in a stale inbox
  are structurally identical but operationally different — only
  the reader knows which matters today.
- **Narrative verbs stay descriptive.** `gate transcript` and
  `gate resume` compose prose from facts. If they ever evaluate
  ("this was a productive session," "this request had a rough
  lifecycle"), the tool is judging, not perceiving. The prose
  should read like a mirror, not a critic.
- **Aggregate detectors stay aggregate.** `self-loop-check`
  reports "3 of the last 25 completions were self-loops" — a
  pattern across records. It does not flag individuals, because
  flagging an individual is a judgement call the tool should not
  make (principle 03 names this as the surveillance failure mode).

## Related

- `principles/02-advisory-not-directive.md` — the labeling
  discipline that applies specifically to heuristic outputs.
  This principle is the broader posture that advisory labeling
  is an instance of.
- `principles/03-legibility-costs.md` — perception has costs:
  making behavior recordable changes it. This principle names
  what legibility is *for* (reader perception), which is the
  upside that justifies those costs.
- `principles/01-silent-calibration.md` — calibration is a
  perception aid for *other* readers, hidden from the subject.
  The tool sharpens what others see, without converting the
  score into a judgement the subject has to respond to.
