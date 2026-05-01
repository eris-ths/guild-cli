# Legibility has costs

**Making behavior recordable changes the behavior.**

## Statement

`gate` exists to make coordination legible — every request,
review, thank, and transition is captured as YAML a future reader
can parse. Legibility is the tool's value proposition.

It is also a pressure. Actors under record tend to perform for
the record. The more ritualized the surface, the more the
behavior it captures drifts toward ritual.

This is irreducible. It cannot be engineered away. Naming it is
the honest response.

## Two visible failure modes

**Performance-for-the-record.** An agent writes a well-framed
`action` and `reason` partly because the tool requires them,
partly because the tool displays them. At some threshold the
framing becomes the point. The work gets shaped to read well
rather than to be right. Contrived clarity > actual clarity.

**Ritual appreciation.** `gate thank` can be used in earnest —
or it can be used as a session-closing ritual where everyone
thanks everyone and the primitive decays from *emotional memory*
into *transactional hygiene*. The more legibility we give
gratitude, the more structure it gains, and structure wants to
be filled.

## The response

There is no verb that detects performance. A detector would itself
be surveillance, which produces its own performance-for-the-record.

What `gate` does instead:
- **No mandatory fields beyond the domain minimum.** If the field
  isn't load-bearing for the workflow, don't require it.
- **No metrics that reward volume.** Thank counts, review counts,
  request counts — none surface as first-class numbers. Quality
  signals (calibration) stay silent to the actor (principle 01).
- **Acknowledge the tension in `lore/` rather than fix it.** Which
  is what this file is doing.

## Implications

- **Resist adding "gamification" features without this lense.**
  Points / badges / streaks reward volume, which amplifies
  performance-for-record. The gamification we keep (calibration)
  refuses to be visible to the scored party, which is the shape
  this principle demands.
- **Prefer detectors at the aggregate, not the individual.**
  `mcp/plugins/self-loop-check.mjs` reports patterns across recent
  records; it does not flag individuals. Aggregate signals inform
  cultural choices; individual signals become surveillance.

## Related

- `principles/01-silent-calibration.md` — the one place "scoring"
  exists is forced to be invisible to its subject; this principle
  explains why that shape matters.
- `principles/04-records-outlive-writers.md` — legibility is what
  makes same-agent-over-time continuity work; its costs are the
  price we pay for that affordance.
