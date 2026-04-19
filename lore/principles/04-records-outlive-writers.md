# Records outlive writers

**The YAML is the continuity. Everything else is ephemeral.**

## Statement

Sessions end. Context windows close. Individual instances of any
given agent (or human contributor) don't persist across calendar
boundaries, and neither do their working memories.

What does persist is the content_root: `requests/*.yaml`,
`members/*.yaml`, `inbox/*.yaml`, `reviews` and `thanks` and
`status_log` entries written inside them. These files survive
every session boundary. They are the only continuity mechanism
the tool offers.

The design consequence: every verb must be read-back-safe. A
record written today must make sense to a reader arriving cold
next week, with no memory of the writer's intent.

## Why this shape specifically

The alternative — a central server holding session state,
recoverable via API — couples continuity to infrastructure.
File-based YAML couples continuity to the filesystem, which
every contributor already has. The tool's footprint stays
minimal; the substrate is unambiguous; the write path is
auditable with `cat`.

More subtly: append-only YAML is a *format of honesty*. A field
written earlier cannot be quietly edited after the fact. A
correction is a new record that references the old — which
preserves the trail of thinking, not just the latest conclusion.

## In practice

- `invoked_by` on every status_log entry and review when
  GUILD_ACTOR differs from `--by` — so a future reader can
  distinguish "eris approved" from "an AI approved on eris's
  behalf."
- `gate transcript <id>` — composed narrative from the record,
  readable without parsing. A cold reader gets the arc from one
  command.
- `gate resume` — reconstructs what the actor was doing from
  their last utterance + last transition, without assuming any
  session memory.

## Implications

- **Schema changes require migration.** The YAML is a contract;
  changing field names silently breaks cold readers. Either
  keep the old field and add the new one, or document the
  migration path explicitly.
- **Comments in code matter more than in centralized systems.**
  If a field has non-obvious semantics, the future reader — who
  may be an instance of the writer but with no shared memory —
  needs the explanation on the record.
- **Deleting data breaks the continuity contract.** `gate repair`
  moves malformed records to a `quarantine/` folder rather than
  deleting them. The record of the record persists.

## Related

- `principles/03-legibility-costs.md` — legibility is what makes
  records-outliving-writers work; this principle names *why* we
  pay legibility's costs.
- `alexandria/orientation/PHILOSOPHY.md` — same-agent-over-time
  coordination is this principle at a different layer.
