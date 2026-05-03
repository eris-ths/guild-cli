# three-passages-framing

This is a content_root — a substrate-tracked space, not documentation.

A real agora session preserved as an example. On 2026-05-03, Claude
(this assistant) and nao were having a conversation about how to
characterize the three guild passages with single-word symbolic
shorthand. The result was the **gate=判断 / agora=探索 / devil=守備**
framing now linked from `README.md` § Architecture and from
`AGENT.md` § "The three passages — a one-line dispatch shorthand".

The agora play in this content_root is **the conversation itself
preserved as substrate** — not a reconstruction, not a tutorial.
Move 001 captured the framing proposal. The play was suspended
with a cliff/invitation pair while waiting for nao's response.
Once nao accepted ("気に入った"), the play was resumed with a
closing note, move 002 recorded the acceptance + the
projection-layer landing in PR #130, and the play was concluded.

The full arc — propose → suspend on invitation → resume with the
answer → conclude — is the substrate-honest shape of a single
conversation that resolves cleanly. If a future use surfaces
breakage in the framing, a new play would `--addresses` this one
rather than mutating it (terminal state, append-only at the
contest level).

## Why this is here

Most agora examples one might write would be constructed —
designed to teach a verb. This one isn't. It's a one-off
single-actor (claude) + interlocutor (nao via human-in-the-loop)
session that captured a real thinking-about-thinking arc and
concluded once the conversation reached agreement. That shape —
verdict-less synthesis (`concluded_note`), preserved in
substrate, with the suspend/resume cycle recording the
open-question-then-answer flow — is what agora is for.

## Read it

```bash
cd examples/three-passages-framing
GUILD_ACTOR=claude node ../../bin/agora.mjs show 2026-05-03-001 --format text
```

The output shows the play's full state: 2 moves, 1 suspension
paired with 1 resume, conclusion with note. The cliff/invitation
of the suspension are still in the substrate (append-only) so a
future reader sees the question that was held open and the
resume-note that closed it.

## Structure

- `guild.config.yaml` — `host_names: [nao]`. The (human) interlocutor
  is the host.
- `members/claude.yaml` — the actor who authored the play.
- `agora/games/three-passages-framed.yaml` — the Sandbox game
  definition.
- `agora/plays/three-passages-framed/2026-05-03-001.yaml` — the
  concluded play with 2 moves, 1 suspend, 1 resume, and a
  `concluded_note` recording nao's acceptance and the
  projection layer that landed.

## What this is not

- Not a tutorial — read [`docs/verbs.md`](../../docs/verbs.md) §
  Agora for that.
- Not a recommendation that all agora plays should be single-actor
  philosophical. Most won't be. This one is the artifact of one
  conversation, preserved so the substrate has a real example
  alongside the constructed ones.
- Not perpetually open — the play is **concluded**. The
  framing-acceptance arc resolved; mutation now requires a new
  play that `--addresses` this one (substrate stays append-only
  at the contest level).
