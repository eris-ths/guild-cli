# agora — second passage (alpha, v1)

Second passage under `guild`, after `gate`. Where gate is the
**判断** (judgment / decision-shaped) surface, agora is the
**探索** (exploration-shaped) surface — Quest and Sandbox style
games with suspend/resume as a first-class primitive.

The shape: `agora` holds work that **shouldn't be forced to a
verdict yet**. A play accumulates moves; a `suspend` records a
cliff (what just happened) and an invitation (what the next
opener should do); `resume` picks up the thread later, possibly
in a different session, possibly by a different actor. Concluded
plays close with prose, not with `ok|concern|reject`.

If your work is decision-shaped, use `gate`. If it's
defense-shaped (security review against a code change), use
`devil`. If it's exploration-shaped, agora.

## Lore upstream

- [`lore/principles/11-ai-first-human-as-projection.md`](../../../lore/principles/11-ai-first-human-as-projection.md)
  — the substrate is AI-natural; humans get a projection layer.
- [`lore/principles/10-schema-as-contract.md`](../../../lore/principles/10-schema-as-contract.md)
  — the schema agents read is the dispatch contract; `agora schema`
  advertises every implemented verb.
- [`lore/principles/04-records-outlive-writers.md`](../../../lore/principles/04-records-outlive-writers.md)
  — the substrate persists across sessions; agora reuses gate's
  YAML file substrate.
- [`lore/principles/09-orientation-disclosure.md`](../../../lore/principles/09-orientation-disclosure.md)
  — agora's stderr `notice:` line follows the same shape as
  `gate register`.

## Design issue

[Issue #117](https://github.com/eris-ths/guild-cli/issues/117)
captures the design conversation that shaped this passage: the
Zeigarnik / rabbit tracker translation for AI agents, the
suspend/resume centrality, the Quest/Sandbox over Match selection.

## Layout

```
src/passages/agora/
  domain/
    Game.ts                         # Game value object
    Play.ts                         # Play value object + state machine
  application/
    GameRepository.ts               # port
    PlayRepository.ts               # port
  infrastructure/
    YamlGameRepository.ts           # adapter (uses gate's safeFs substrate)
    YamlPlayRepository.ts           # adapter (per-game subdirs)
  interface/
    index.ts                        # CLI dispatcher (entry point)
    handlers/                       # one handler per verb
  README.md                         # this file

bin/agora.mjs                       # passage binary
tests/passages/agora/               # contract tests
```

## Substrate sharing with gate

agora reuses gate's substrate without modification — `safeFs`,
`parseYamlSafe`, `GuildConfig`, `MemberName`, `parseArgs`. This is
the container/passage architecture in action: passages share the
container's substrate but author their own domain / application /
infrastructure / interface verticals.

agora-specific records live under `<content_root>/agora/`:

```
<content_root>/
  members/                          # shared with gate (container-level)
  guild.config.yaml                 # shared
  agora/
    games/<slug>.yaml               # game definitions
    plays/<game>/<play-id>.yaml     # play sessions (sequence per game per day)
```

## Verbs (v1, complete)

- `agora new` — create a Game definition (Quest or Sandbox)
- `agora play` — start a play session against a Game
- `agora move` — append a move (with optimistic CAS)
- `agora suspend` — pause with cliff + invitation (the design pivot)
- `agora resume` — pick up; surfaces closing cliff/invitation in
  success output so the resumer reads paused-on context without a
  separate query
- `agora conclude` — terminal state from playing or suspended
  (drift-away outcome valid)
- `agora list` — enumerate games + plays (`--game` / `--state` filters)
- `agora show <slug-or-play-id>` — detail view with full move +
  suspension/resume history paired by index
- `agora schema` — agent dispatch contract per principle 10

The substrate-side Zeigarnik (issue #117) is in place: every
suspend records `cliff` (what just happened) and `invitation`
(what the next opener should do), both append-only. Multi-suspend/
resume cycles are preserved as separate entries; the
state-derivation invariant holds:

```
suspensions.length === resumes.length     → playing (or concluded)
suspensions.length === resumes.length + 1 → suspended
```

## Play state machine (v1)

```
playing ── suspend ──▶ suspended ── resume ──▶ playing
   │                       │
   └──── conclude ─────────┴───────▶ concluded (terminal)
```

`conclude` is allowed from both `playing` and `suspended` because a
suspended play that's never picked back up is a valid outcome
("the conversation drifted away"). The cliff/invitation prose
remains in the record either way.

## Worked example

A real agora session preserved as a content_root example lives at
[`examples/three-passages-framing/`](../../../examples/three-passages-framing/) —
single-actor Sandbox play recording the gate=判断 / agora=探索 /
devil=守備 framing decision, with a suspend/resume cycle holding
nao's response.
