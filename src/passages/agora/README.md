# agora — passage v0 (snapshot/agora)

Second passage under `guild`, after `gate`. Where gate is the
**request-lifecycle / review / dialogue** surface, agora is the
**play / narrative / cast** surface — Quest and Sandbox style games
with suspend/resume as a first-class primitive.

This is **the v0 skeleton** living on `snapshot/agora`. It exists
to prove the container/passage architecture works in code, not to
be feature-complete. Only `agora new` is implemented; `play`, `move`,
`suspend`, `resume`, `list`, `show` will land iteratively as the
prototype surfaces what shape they need.

## Lore upstream

- [`lore/principles/11-ai-first-human-as-projection.md`](../../../lore/principles/11-ai-first-human-as-projection.md)
  — the substrate is AI-natural; humans get a projection layer.
- [`lore/principles/10-schema-as-contract.md`](../../../lore/principles/10-schema-as-contract.md)
  — the schema agents read is the dispatch contract (TODO: add
  `agora schema` verb when there's enough surface to advertise).
- [`lore/principles/04-records-outlive-writers.md`](../../../lore/principles/04-records-outlive-writers.md)
  — the substrate persists across sessions; agora reuses gate's
  YAML file substrate.
- [`lore/principles/09-orientation-disclosure.md`](../../../lore/principles/09-orientation-disclosure.md)
  — `agora new`'s stderr `notice:` line follows the same shape as
  `gate register`.

## Design sandbox

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
    handlers/new.ts                 # `agora new` verb
    handlers/play.ts                # `agora play` verb
  README.md                         # this file

bin/agora.mjs                       # passage binary
tests/passages/agora/
  new.test.ts                       # `agora new` contract (8 tests)
  play.test.ts                      # `agora play` contract (7 tests)
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
    games/<slug>.yaml               # NEW — game definitions
    plays/<game>/<play-id>.yaml     # FUTURE — play sessions
    casts/<persona>.yaml            # FUTURE — character ledgers
    moves/<play-id>/<move-id>.yaml  # FUTURE — append-only moves
```

## Status

- [x] `agora new` — create a Game definition
- [x] `agora play` — start a play session against a Game
- [x] `agora move` — append a move (with optimistic CAS)
- [x] `agora suspend` — pause with cliff + invitation (the design pivot)
- [x] `agora resume` — pick up; surfaces closing cliff/invitation
- [ ] `agora conclude` — terminal state from playing or suspended
- [ ] `agora list` — list games + plays
- [ ] `agora show <slug|play-id>` — detail view
- [ ] `agora schema` — agent-dispatch contract (principle 10)

The substrate-side Zeigarnik (issue #117) is in place: every suspend
records `cliff` (what just happened) and `invitation` (what the next
opener should do), both append-only. Resume surfaces them in its
success output so the agent re-entering reads the paused-on context
without a separate query. Multi-suspend/resume cycles are preserved
as separate entries; the state-derivation invariant holds:

  suspensions.length === resumes.length     → playing (or concluded)
  suspensions.length === resumes.length + 1 → suspended

## Play state machine (v0)

```
playing ── suspend ──▶ suspended ── resume ──▶ playing
   │                       │
   └──── conclude ─────────┴───────▶ concluded (terminal)
```

`conclude` is allowed from both `playing` and `suspended` because a
suspended play that's never picked back up is a valid outcome
("the conversation drifted away"). The cliff/invitation prose
remains in the record either way.

Each verb lands as a separate commit on this branch with its own
test surface. Lore graduates (e.g., suspend/resume mechanics
becoming a principle) when prototyping pulls them into focus.
