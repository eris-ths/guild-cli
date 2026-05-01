# Voice as doctrine

**The tool's prose is the running embodiment of lore. Voice is how
principle reaches readers who do not read lore.**

## Statement

Most readers of `gate` — human or AI — never open `lore/principles/`.
They read `boot` payloads, `show` text, `suggest` reasons, the
stderr footer of `gate suggest --format text`, the rationale
strings in `gate doctor` findings. That prose is the place
principle actually *lands*.

So voice is not decoration. It is the substrate by which 02
(advisory not directive), 03 (legibility costs), and 07 (perception
not judgement) reach the loop that won't stop to read a markdown
file. Voice carries lore into the runtime.

## Why this is a separate principle

Principles 02, 03, 07 each speak to *what* the voice should do —
label, name costs, refuse to judge. None speak to what the voice
*is*: the running expression of the design's stance, held in the
prose of advisories, footers, JSON-Schema descriptions, and
finding messages.

The tool could be redesigned to speak less — barer payloads, no
"all first-class" clauses, no "DETECTOR, not an enforcer"
disclaimers. The principles 02 / 03 / 07 would still hold in the
abstract, but they would no longer reach the reader who only sees
`gate boot --format json`. The voice's *presence* is the
load-bearing piece this principle names.

## In practice

- **Voice is held in handlers, not in plugins.** The phrasing of
  `suggested_next.reason`, `unresponded` footers, and schema
  descriptions lives in `src/interface/**/*.ts`. It is intentionally
  not pluggable — pluggable voice would let a third party detach the
  prose from the lore it carries.
- **Voice is bounded by an explicit budget.**
  `tests/interface/voiceBudget.test.ts` enumerates the named voice
  phrases and the files they are permitted to appear in (the
  current set lives in `VOICE_BUDGET` inside that file — by design,
  this principle does not enumerate them inline; lore is the why,
  the test is the what). Adding a new occurrence — or a new phrase
  — fails the test until `VOICE_BUDGET` is updated with a
  rationale. The test is a detector, not an enforcer of
  correctness: paraphrase escapes it. The discipline is "if you
  reach for an existing pedagogical phrase, account for it; if you
  write a new one, declare it."
- **Voice is preserved across surface additions.** When a new
  advisory or hint surface lands (PR #94's six-point set is the
  archetype), each new payload's prose is held to the same budget.
  Repetition of named phrases across multiple surfaces is
  *intended*: it conditions the reader through exposure. Stripping
  the repetition to look bare would gain cleanliness and lose the
  pedagogical effect.

## Implications

- **Bareness is not the goal.** A `gate boot --format json` payload
  with terse mechanical fields would be cleaner to parse but
  poorer at carrying lore. The current shape — payload fields plus
  human-meant `reason` prose — is the trade explicitly accepted by
  this principle.
- **Voice must resist drift, not contraction.** The budget catches
  proliferation (the same phrase spreading across new surfaces
  without justification), not the inverse. If a phrase is used in
  fewer places than budget allows, that's fine — the budget is a
  ceiling, not a floor.
- **Paraphrase is a stance violation the test cannot catch.**
  Replacing a named pedagogical phrase with a synonymous one would
  pass voice budget while violating its intent. This failure mode
  is named in the test header and watched in code review; this
  principle file itself is the standing observation place — when
  the discipline drifts, the next revision lands here.
- **Plugins inherit voice; they don't override it.** A doctor
  plugin may add findings; the *framing* of those findings borrows
  from the project's voice vocabulary (the named phrases in
  `VOICE_BUDGET`). Plugins are encouraged to reuse named phrases
  rather than coin new ones, because the existing phrases carry
  the project's stance whereas new ones carry the plugin author's.

## Related

- `principles/02-advisory-not-directive.md` — the labeling
  discipline voice carries on a specific surface
  (`suggested_next.reason`, schema descriptions). This principle
  names *what voice is for*; 02 names *what voice must say at the
  point of use*.
- `principles/03-legibility-costs.md` — voice is itself a
  legibility surface, and 03's warning about
  performance-for-the-record applies to it (a writer can shape an
  `action` field to read well rather than be right). Voice budget
  is the corresponding pressure on the *tool's own* prose:
  proliferating advisories shape themselves toward "look thorough"
  rather than "stay honest."
- `principles/07-perception-not-judgement.md` — voice is the
  texture through which perception is offered. A judgement-flavored
  voice (e.g. "this concern is unresolved" rather than "concern
  recorded") would violate 07 even when the data shape is identical.
- `principles/04-records-outlive-writers.md` — voice in payload
  fields (e.g. `suggested_next.reason`) is *not* persisted to YAML;
  it is regenerated at read time. This means voice can be evolved
  without breaking records, which is exactly the freedom this
  principle leverages: prose can be tightened without migration.
