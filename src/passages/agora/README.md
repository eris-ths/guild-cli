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
  domain/Game.ts                    # Game value object
  application/GameRepository.ts     # port
  infrastructure/YamlGameRepository.ts  # adapter (uses gate's safeFs substrate)
  interface/
    index.ts                        # CLI dispatcher (entry point)
    handlers/new.ts                 # `agora new` verb
  README.md                         # this file

bin/agora.mjs                       # passage binary
tests/passages/agora/new.test.ts    # contract tests (8 tests)
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
- [ ] `agora list` — list games + plays
- [ ] `agora show <slug|play-id>` — detail view
- [ ] `agora play <slug>` — start a play session
- [ ] `agora move <play-id>` — append a move
- [ ] `agora suspend <play-id>` — first-class suspension with
      cliff/invitation prose
- [ ] `agora resume <play-id>` — pick up from a suspension
- [ ] `agora schema` — agent-dispatch contract (principle 10)

Each verb lands as a separate commit on this branch with its own
test surface. Lore graduates (e.g., suspend/resume mechanics
becoming a principle) when prototyping pulls them into focus.
