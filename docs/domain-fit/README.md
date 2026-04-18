# Domain fit — working notes

Exploration of how `guild-cli` behaves when used beyond the "agent
request lifecycle" it was built for. Notes from hands-on dogfooding
across six domains, plus the design intuitions the tours surfaced.

Everything here is **provisional**. No design decision is locked by
anything in this folder. The goal is to have a place where "how
does this tool flex to X?" stays durable across sessions, instead
of evaporating with a chat context.

## What's here

- [`domain-conventions.md`](./domain-conventions.md) — per-domain
  recipes. Six sections covering story, meeting, game design,
  research log, incident post-mortem, and solo journal. Each one
  has a reproducible sandbox setup, what felt natural, and what
  pushed back.
- [`design-notes.md`](./design-notes.md) — the design intuitions
  the tours surfaced. Central one: **gate's state machine encodes
  a social contract between principals, not a time axis.** The
  review-lens mechanism is the dual — principal separation in the
  perspective dimension. Two axes; domains that hit both get the
  most out of the tool.
- [`open-questions.md`](./open-questions.md) — unresolved design
  tensions. The story-mode plugin (three layers of depth), a
  predictive taxonomy of fit, and whether state-machine aliasing
  is worth building.

## How to use / contribute

If you try gate on a new domain and it teaches you something:

- **Add a section** to `domain-conventions.md` following the
  existing shape. The reproducible sandbox is the load-bearing
  part — it lets the next reader verify (or falsify) the claim.
- **Append to `open-questions.md`** if you hit a design tension
  that isn't obviously a bug. Tensions that stay unresolved for
  weeks are more interesting than ones that get patched; keep
  them visible.
- **Amend `design-notes.md`** if you find an angle that reframes
  an existing claim. Don't delete the old framing — strike it
  through or move it to "earlier framings" so the evolution
  stays visible. These are working notes; the history is part
  of the content.

All three files are in a register that's closer to a lab notebook
than a spec. They're trying to think out loud, not ship a
pronouncement.

## How this relates to the rest of `docs/`

- [`docs/concepts-for-newcomers.md`](../concepts-for-newcomers.md)
  — the "first 30 seconds" map. User-facing, authoritative.
  `domain-fit/` is the opposite register: internal, exploratory.
- [`docs/verbs.md`](../verbs.md) — the per-verb reference.
  `domain-fit/conventions` shows the verbs in action across
  domains; it's the "how to compose them" side of the same story.
- [`POLICY.md`](../../POLICY.md) — versioning + invariants.
  Anything in `domain-fit/` that graduates into a hard design
  decision should move into `POLICY.md` or a real design doc.

## History / provenance

This folder started as the writeup of one session's dogfood
exploration (2026-04-18). The commits that introduced each
domain's convention are linked from the per-domain sections so
the original exploration context is recoverable.
