# Substrate-pure module in a projection ecosystem

**guild-cli is not a standalone harness. It is a multiply-referenced
substrate-pure module within a larger projection ecosystem of
sibling AI-first CLIs (yori-code, gemini-cli) and a shared GUI lens
(projector). Its responsibility is judgment-accumulation — nothing
more. The boundaries with adjacent modules are intentional: card
abstraction, GUI projection, persona logic, and game construction
all live in other modules and are not re-invented here.**

## Statement

Earlier principles (10 schema-as-contract, 11 ai-first-human-as-
projection) establish that guild-cli speaks a substrate language
intended for AI agents first. This principle names where the
substrate ends and other ecosystem modules begin.

The ecosystem, as of 2026-05-04:

- **guild-cli** — judgment-accumulation substrate. Multi-actor
  ledger, gate / agora / devil passages, lense-attributed reviews.
- **yori-code** (with `atelier/`) — AI-first game engine. Inherits
  gate's append-only ledger architecture and generalizes it via the
  Card abstraction. Vendors guild-cli as a pinned submodule under
  `external/guild-cli/`.
- **gemini-cli** — general-purpose Gemini agent CLI; sibling, not
  a dependency.
- **projector** — universal CLI → GUI projection infrastructure.
  Reads `.projection.yaml` manifests and JSON Lines event streams
  from sibling CLIs and renders a shared GUI sandbox. Loose
  coupling: no CLI is forked or vendored by projector.

Inside guild-cli the design grammar is a five-layer composition:

| Layer | Static elements | What it provides |
|---|---|---|
| 1. Passage | `gate` / `agora` / `devil` (+ future shapes) | the *shape* of agent activity |
| 2. Lense | `devil`/`layer`/`cognitive`/`user` + per-content_root extensions | the *angle* of observation; target-invariant |
| 3. Verb | per-passage action sets (`request`, `move`, `entry`, ...) | the *act* on the substrate |
| 4. Card | borrowed from external skill systems (THS, atelier) | *enhancement* attached to the substrate |
| 5. Infrastructure | `safeFs`, `parseYamlSafe`, `pathSafety`, passage-registry seam | *invariants* that cross every passage |

Dynamic compositions arise from this static base:

- **Combo** — short verb chains within or across passages
- **Flow** — long combo chains forming a complete piece of work
  (the bug-killing flow in [`docs/playbook.md`](../../docs/playbook.md#c4)
  is canonical)
- **Loop** — flows that recur (improvement loops, time-aware
  Zeigarnik recovery via suspend/resume cliffs)
- **Hooks** — event reactors (not yet implemented in guild-cli;
  the harness host typically provides this layer)
- **Cycle** — self-renewing flow shapes that arrive once a
  reflective layer composes with the rest

Three usage shapes are all first-class:

1. **Standalone.** Run `gate` / `agora` / `devil` directly inside a
   harness session.
2. **Vendored.** Sit pinned at a SHA inside another tool's tree
   (`yori-code/external/guild-cli/`) and serve its judgment needs.
3. **Lensed.** Be observed through a `.projection.yaml` manifest
   by a GUI projection layer without surrendering CLI primacy.

## Why the asymmetry

Three reasons the substrate stays narrow:

1. **Card abstraction belongs in atelier.** atelier's eight Card
   kinds (action, effect, rule, role, zone, lense, observer,
   scenario) and its packs (e.g. fireworks, tictactoe, werewolf,
   silence) are the canonical CDD implementation. Reproducing
   even a subset inside guild-cli would create two parallel card
   vocabularies that drift.
2. **GUI projection belongs in projector.** A guild-cli rendering
   layer would couple substrate evolution to GUI evolution, which
   contradicts principle 11 — projection is downstream, not
   upstream.
3. **Persona logic belongs to the host harness.** guild-cli
   records *who acted* via `--by` / `--from` / `--with`, but does
   not model *who that actor is*. Persona shape (Yuki, Miki,
   Eris, Noir, Asteria, ...) is host-side and arrives through
   actor names, not through guild-cli concepts.

## Consequences

- **No completion-driven design.** guild-cli does not need to
  "finish" — adjacent modules cover the gaps a standalone tool
  would have to fill.
- **Three ways to opt in.** Users may run guild-cli alone,
  vendor it inside another CLI, or watch it through projector.
  All three are intended; none is the canonical use.
- **Responsibility orthogonality.** A change in atelier's Card
  catalog should not require a guild-cli release. A new GUI tab
  in projector should not require a guild-cli verb. A new persona
  in THS should not require a guild-cli member-category change.
  When any of these couples appear, that is a design smell to
  investigate, not a feature to embrace.

## Meta-note

This principle is **descriptive** of the ecosystem state on
2026-05-04, not **prescriptive** of how the ecosystem must be.
The composition above will shift as `atelier`, `projector`,
`yori-code`, and adjacent CLIs evolve. Future agreement is welcome
to supersede this principle; supersession is the native motion of
`lore/principles/` (per principle 04).

This principle was written aware of its own gravity — once a
record exists in `lore/principles/`, it is read later as
inheritance. Readers who arrive at this file because grep
surfaced it are asked to read this section before treating the
content above as binding. The writing emerged from a three-voice
conversation (eris / noir / asteria) reading the May-2026 repo
shape against the (then private) `yori-code` substrate; the trace
of that reading is held in the authors' working substrate, not
shipped here. Treat the content above as the trace of a specific
reading on a specific date, not a universal claim.
