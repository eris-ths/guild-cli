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
Move 001 captured the framing proposal; the suspend cliff/invitation
held the question "do these words land for you?" for nao to address
at re-entry.

## Why this is here

Most agora examples one might write would be constructed —
designed to teach a verb. This one isn't. It's a one-off
single-actor session that captured a real thinking-about-thinking
arc, then was suspended (not concluded) so the question to nao
remains open in the substrate. That shape — verdict-less,
preserved, suspended-on-invitation — is what agora is for.

If you came here looking for "what does agora look like in
normal use?", read `agora/plays/three-passages-framed/2026-05-03-001.yaml`.

## Read it

```bash
cd examples/three-passages-framing
GUILD_ACTOR=claude node ../../bin/agora.mjs show 2026-05-03-001 --format text
```

The output shows the play's full state including the suspended
cliff/invitation pair. The substrate-side Zeigarnik effect
(issue #117) — whoever opens this play next reads what was
paused on without a separate query.

## Structure

- `guild.config.yaml` — `host_names: [nao]`. The (human) interlocutor
  is the host.
- `members/claude.yaml` — the actor who authored the play.
- `agora/games/three-passages-framed.yaml` — the Sandbox game
  definition.
- `agora/plays/three-passages-framed/2026-05-03-001.yaml` — the
  play with one move and one suspension (no resume yet).

## What this is not

- Not a tutorial — read [`docs/verbs.md`](../../docs/verbs.md) §
  Agora for that.
- Not a recommendation that all agora plays should be single-actor
  philosophical. Most won't be. This one is the artifact of one
  conversation, preserved so the substrate has a real example
  alongside the constructed ones.
- Not concluded — the play is `suspended`. nao's response to the
  invitation will be the next move (resume + move on a real
  content_root).
