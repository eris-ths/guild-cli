# Alternatives — when gate is the wrong tool

guild-cli isn't the only tool in its neighborhood, and no single
"opposite" of gate exists. This file maps the landscape axis by
axis, so readers who find gate's stance wrong for their situation
can reach for the right alternative instead of bending gate against
its grain.

Written in the same lab-notebook register as the rest of
`docs/domain-fit/`: provisional, honest, revisable. If you try one
of these alternatives and come back with a sharper comparison, PR
it here.

One frame to keep in mind across the axes below: gate's primary
caller is an **AI agent**, not a human. "Multi-principal" in the
axes usually means "an agent plus its human observer" or "an agent
plus another agent through the same `content_root`" — not "several
humans at keyboards". The CLI is the protocol surface agents use;
humans read the YAML trail the agents leave behind. Alternatives
that assume a human-at-keyboard as the primary operator are solving
a different shape of problem.

## Axes that define gate's position

The preference axes that bring a reader either toward or away from
gate:

1. **Append-only vs editable.** gate records never mutate; edits are
   new records. Readers who want to correct-in-place are fighting
   the invariant.
2. **Opinion-heavy vs neutral.** gate has a thesis (Two-Persona
   Devil, review lenses, state machine as social protocol).
   Readers who want a tool without a thesis bounce off.
3. **Multi-principal vs single-user.** gate's state machine is
   social-protocol-shaped: declare → sanction → execute → complete.
   Solo users mostly fast-track past it, and the machinery is
   overhead.
4. **Deliberation-focused vs execution-focused.** gate records the
   conversation about the work, not just the work. Task-closing
   tools are different.
5. **CLI vs GUI.** gate is CLI + YAML files. Readers who want
   graphical boards are outside the niche.
6. **Custom vocabulary vs industry-standard.** gate uses "lens",
   "pair-mode", "fast-track", "Two-Persona Devil". Readers who
   want standard Jira/GitHub vocabulary bounce on learning cost.

## Per-axis alternatives

| Preference | Reach for |
|---|---|
| Editable, personal notes | Obsidian, Logseq, Notion, plain markdown + vim |
| Task tracking, no deliberation | taskwarrior, Linear, GitHub Issues, Todoist |
| Opinion-free CLI journal | jrnl, todo.txt |
| Standard ticket vocabulary | GitHub Issues, Jira, Redmine |
| Append-only CLI with domain-specific invariants | ledger / hledger (accounting), adr-tools (decisions) |
| Multi-user discussion without state machines | Discourse, GitHub Discussions, Slack threads |
| Structured code review | Gerrit, GitHub PR reviews |
| Event log in plain text, no tool opinions | git-notes, plain `git log` with convention |

## Closest siblings

Three tools that sit near gate on multiple axes and are genuine
"consider instead" candidates:

### `adr-tools` — gate without the lens framework

Architecture Decision Records kept as markdown files in your repo,
CLI-managed. Append-only in spirit. CLI-native. Decision-focused.

What it's missing compared to gate:
- No multi-actor model (no `--by`, no `review`, no `lens`)
- No state machine (ADRs are linear, not lifecycled)
- No request/issue distinction

What it's better at:
- Zero philosophical overhead
- Widely understood format (ADR is an established pattern)
- Fits into any existing repo with minimal setup

**Pick adr-tools over gate if**: you're a solo engineer or small
team wanting append-only decision memory, and the Two-Persona
Devil apparatus feels heavy.

### `taskwarrior` — multi-actor-less, state-machine-less, powerful

CLI task manager. Filter-heavy, tag-based, powerful UDA (user-
defined attributes). Solid for a single user managing many tasks.

What it's missing:
- Multi-user / multi-principal coordination
- Review as a first-class concept
- Any notion of append-only — tasks are fully mutable

What it's better at:
- Raw task-tracking velocity
- Filter / query sophistication
- Maturity (decade+ of development, huge userbase)

**Pick taskwarrior over gate if**: you want to track your own
work aggressively, and review/deliberation lives elsewhere (Slack,
PR comments, etc.).

### `jrnl` — append-only single-user journal

Append-only journal entries, CLI-native, zero opinion about
structure. Plain text on disk.

What it's missing:
- Multi-user anything
- State machine
- Review / lens
- Cross-references (no `chain` equivalent)

What it's better at:
- Minimal learning curve
- Zero philosophy
- Perfect for personal memory

**Pick jrnl over gate if**: you want "what happened today" in a
line, and none of the deliberation apparatus.

## Nobody sits at gate's exact opposite

Worth noting: **no single existing tool is the complete opposite
of gate on all six axes**. Obsidian is editable + opinion-light +
deliberation-agnostic but not multi-user + CLI. Linear is
multi-user + opinion-light + execution-focused but not CLI +
editable. taskwarrior is CLI + opinion-light but single-user.

This has two readings:

- **Gate is a niche intersection.** The specific mix of "multi-
  actor + CLI + append-only + deliberation-shaped + opinion-heavy"
  isn't commodity territory. Whether that's good (underserved
  niche) or bad (ignored for a reason) depends on who's asking.
- **Partial alternatives cover most objections.** If you disagree
  with gate on 1–2 axes, one of the tools above is almost
  certainly a better fit than bending gate. If you disagree on
  4–5 axes, you're not in gate's audience at all.

## When explicitly NOT to use gate

- **Tasks are ephemeral.** Grocery lists, TODO for an evening —
  the append-only apparatus is pure overhead.
- **You're alone and the work is private.** No multi-actor loop
  means the review machinery sits unused. `jrnl` is better.
- **You need a GUI for your team.** Linear / Jira / Notion.
- **Your team already has a working review protocol.** Adding
  gate on top is duplicate ritual, not value.
- **You dislike opinion-heavy tooling.** The opinion is load-
  bearing here; it's not a thin layer to strip off.

## Cross-links

- [`docs/domain-fit/design-notes.md`](./design-notes.md) — the two-
  axes framework (principal-separation in time × in perspective)
  that predicts which domains benefit from gate's specific
  combination.
- [`docs/domain-fit/domain-conventions.md`](./domain-conventions.md)
  — six domains tried end-to-end; for each, whether gate was a
  gift, a partial fit, or a mismatch.
