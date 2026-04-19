# Advisory, not directive

**Heuristics must be labeled as heuristics, at the point of use.**

## Statement

When the tool offers a next-step recommendation (`suggested_next`,
priority orderings, etc.), the recommendation is **advisory** —
an informed guess the caller is free to override. That framing
must be encoded into the data surface, not left to ambient
documentation.

## Why

An agent running `gate suggest` in a loop will, by default, treat
the returned `verb` as a command. The loop is tight enough that
reading the accompanying `reason` feels like overhead. Over many
iterations, the tool's heuristic calcifies into authority for the
loop. The more the loop runs, the less the agent questions.

The correction is structural: make the recommendation *named* as
a recommendation wherever the payload is read. A schema
description. A stderr footer. Prose in the relevant docstring.
Not all at once — once per surface where a reader arrives.

## In practice

- `gate schema --verb boot --format json` — `suggested_next`
  field carries `description: "Advisory — NOT a directive..."`
- `gate schema --verb suggest --format json` — same, plus
  explicit naming of the anti-pattern ("a suggest loop that
  dispatches the verb without reading the reason is treating a
  heuristic as a command")
- `gate suggest --format text` — footer line `# advisory —
  override freely` on stderr

Stderr over stdout for the footer: humans scanning the terminal
see it, `$(gate suggest)` shell composition stays clean.

## Implications

- **Runtime disclaimers carry cost.** A prose disclaimer in
  every JSON response wastes tokens on repetition. Put the
  durable version in the schema; put the conversational version
  in the text rendering. Don't repeat on every poll.
- **Agent loops should read `reason`.** The field exists to be
  read. An agent that dispatches on `verb + args` without
  checking `reason` is violating the contract this principle
  establishes, even when the dispatch happens to be correct.

## Related

- `principles/01-silent-calibration.md` — both principles refuse
  to let the tool accumulate unwarranted authority over its users.
- `principles/03-legibility-costs.md` — another angle on "the
  tool's shape influences the behavior it records."
