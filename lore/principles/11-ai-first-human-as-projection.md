# AI-first, human as projection

**Design decisions start from "is this AI-natural?" — never from "is
this human-friendly?" The substrate the agent reads, writes, and
re-enters belongs to the AI's cognition; human-facing ergonomics are
a projection layer assembled outside the substrate. The asymmetry
of order is the principle.**

## Statement

There are two possible orders for designing a tool that both AI
agents and humans use:

1. **Human-first → AI-adapted.** Begin from the human's affordances
   (intuition, narrative summary, mutable state, implicit context)
   and adapt for the agent later.
2. **AI-first → human-projected.** Begin from the agent's
   substrate (machine-parseable, append-only, schema-driven,
   idempotent, explicit) and project to humans through a UI layer
   that doesn't compromise the substrate.

Order (1) seems polite. It produces a substrate that the AI cannot
honor, because human-first encodes assumptions the AI structurally
lacks: psychological persistence, flowing time, implicit inference
from "you should know what I mean." When the agent comes through,
those assumptions appear as silent failures (forgetting context
between sessions, mis-inferring tone, mutating state nobody
witnessed).

Order (2) seems harsh — humans get a CLI before they get a TUI —
but it produces a substrate every actor can honor. Humans use the
AI-natural surface directly when the rigor doesn't burden them; when
it does, a projection layer (TUI / web / pretty rendering) wraps
the same substrate. The substrate is unchanged. The human gets the
ergonomics in the projection; the agent gets the contract in the
substrate.

The principle is the **direction of derivation**: substrate →
projection, never projection → substrate.

## What "AI-natural" means concretely

Operative heuristics already running through `gate`:

- **Machine-parseable contract.** JSON envelopes, snake_case keys,
  declared schema (principle 10).
- **Substrate-persistent.** Records outlive writers (principle 04);
  the agent re-enters cold and reconstructs everything from disk.
- **Append-only.** No mutation surprise on re-read; the agent's
  second pass over the same file produces the same view.
- **Schema-driven dispatch.** The agent wires from `gate schema`
  alone (principle 10); no hidden runtime that the schema doesn't
  advertise.
- **Idempotent on safe paths.** Re-running a read verb is free;
  re-running a write verb is either explicitly OK or fails with a
  structured collision error (`RequestIdCollision`,
  `RequestVersionConflict`).
- **Explicit declaration over implicit inference.** Every `--by`,
  every state transition, every cross-reference is named. The
  agent is never asked to guess what a human would have implied.
- **Stderr / stdout separation.** Notices on stderr (humans),
  payload on stdout (machines). Pipelines stay clean.
- **Exit codes carry contract.** 0 = clean; 1 = expected failure
  (drift, collision); the agent branches on numeric codes, not
  parsed prose.

These aren't AI luxuries. They're the minimum substrate that an
agent re-entering a session can trust.

## What "human-projected" means concretely

A projection layer wraps the AI-natural substrate without changing
it:

- **TUI / web** wrap the CLI; they call the same verbs and parse
  the same JSON. The substrate is what the projection projects.
- **Pretty rendering** of JSON envelopes — colors, icons, tables —
  is added at the projection layer.
- **Truncation, summarization, narrative framing** for human
  digestibility happens in the projection. The substrate keeps
  the full record.
- **Implicit defaults** that humans expect (date guessing, "you
  meant alice", soft confirmations) are projection-layer
  conveniences. The substrate stays explicit.

A projection that requires the substrate to mutate (e.g., "let's
make state field free-form so humans can write whatever") is a
sign the substrate was AI-natural in name only — and the
projection is leaking back into the contract. Resist.

## Why this is a separate principle

Principles 02 (advisory not directive), 03 (legibility costs),
07 (perception not judgement), 09 (orientation disclosure), and
10 (schema as contract) all assume AI-first implicitly without
naming the order. **They all enact this principle. None of them
declare it.**

The cost of leaving it implicit: every PR that wants to "make
something more human-friendly" can chip at the substrate without a
written rule to push back against. The chip looks reasonable
locally ("this one error message could be friendlier"), but
accumulates into substrate degradation. With this principle named,
the question becomes structural: "is the friendlier version a
projection, or a substrate change?" Projections are welcome.
Substrate changes for human-friendliness are not.

This principle also resolves the "passage scope" question for
agora and any future passage: passage substrates are AI-natural
first; human UIs are projections built on top. A passage doesn't
need to decide whether it's "for AI" or "for humans" — the
substrate is for AI, the projection is for humans, both are part
of the same passage's lifetime.

## Concrete obligations

For any new feature or change:

1. **AI-natural check first.** Does the agent re-entering cold
   read this and act correctly? If not, the substrate isn't
   ready. Don't proceed by adding implicit state for humans.

2. **Projection check second.** Can a human-friendly UI wrap this
   substrate without modifying it? If not, the substrate is
   leaking projection concerns into itself.

3. **Tension breaks toward the substrate.** When AI rigor and
   human ergonomics conflict, AI rigor wins. The ergonomics get
   built in the projection layer where they belong.

4. **No psychological assumptions in the substrate.** "The user
   will remember to..." or "they'll naturally..." is a
   psychology assumption. The agent has no psychology. Make it
   explicit (a flag, a verb, a record field) or remove it.

5. **Don't bundle projection layers into passages.** A TUI for
   gate or agora lives outside the passage's CLI; the passage
   stays AI-natural.

## What this principle is NOT

- **Not "humans can't use the tool."** Humans use the AI-natural
  CLI today. It's a CLI; it's bearable. The principle just says
  if humans want more (visualization, summarization, theming),
  build a projection — don't reshape the substrate.

- **Not "build TUI/web layers."** This principle doesn't require
  any projection to be built. It says *if* one is built, here is
  the direction of derivation. Today there is no projection; the
  CLI is everyone's surface. That's fine.

- **Not "AI knows best."** This is about substrate shape, not
  about who decides. Humans decide content_root, members, lenses,
  policy. The principle says: the *substrate where those
  decisions live* should be shaped to AI-natural cognition,
  because the agent is the one re-entering it cold across
  sessions.

- **Not freezing the substrate.** The substrate evolves —
  principles 09, 10, the orientation disclosure work, the schema
  drift detector — under AI-natural pressure. What it doesn't
  evolve toward is human-implicit shape.

## Why naming this now

This principle has been operative throughout `guild-cli`:

- `gate` JSON-default for write verbs returning `suggested_next`
- snake_case JSON across every surface (PR #109, drift detector
  in PR #114)
- `gate schema` as the dispatch contract (principle 10)
- `gate boot` reconstructing full state from disk (principle 04)
- stderr-only notices on edge crossings (PRs #101, #108)
- explicit `--by` / `--from` flags refusing to default-to-human-
  intuition

It's been the latent stance the project has consistently chosen,
without ever pinning the rule. Naming it now (rather than waiting
for a third or fourth instance, as principles 09 and 10 did)
because:

- Every existing principle implicitly leans on it.
- The next passage (`agora`) needs it as the explicit upstream
  rule before its own design begins, so AI-first vs human-first
  is not re-litigated per primitive.
- The risk of leaving it implicit is visible: any future PR that
  argues "let's make this more human-friendly" can erode the
  substrate without a named principle to push back.

## Tracked follow-ups

- **agora design starts under this principle.** Suspend / resume,
  cliff / invitation, motif / echo / invocation are all to be
  decided under "AI-natural first, human-projection optional."
  See issue #117.
- **Cross-reference audit.** Existing principles (02, 03, 07, 09,
  10) implicitly enact this principle. A future pass can add
  cross-references explicitly so a reader of any principle sees
  that it derives from 11.
- **PR-level checklist.** Optional addition to CONTRIBUTING.md:
  "AI-natural check / projection check" as a question to answer
  for every new feature PR.
