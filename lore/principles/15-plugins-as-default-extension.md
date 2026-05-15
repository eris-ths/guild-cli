# Plugins are the default extension surface; core owns substrate identity

**When a new feature can fit as a verb plugin, a hook plugin, a voice
plugin, or a composition of them, that is the preferred shape — even
when core would be a few lines shorter. Core grows only for the
identity layer: domain semantics, lifecycle transitions, and the
director-axis reads that `gate schema` must advertise exhaustively
per principle 11. The asymmetry is not "always plugin" but
"plugin-first for surface and cross-cutting; core for substrate
identity."**

## Statement

Principle 12 (`substrate-pure-module-in-projection-ecosystem`) names
the substrate as a pure module that adjacent modules — card
abstraction, GUI projection, persona logic, game construction —
extend without re-inventing. Principle 11 (`ai-first-human-as-
projection`) names `gate schema` as the agent dispatch contract:
the substrate's surface must be exhaustive in schema so an AI agent
discovers everything available.

Those two principles establish *what core owns*. This principle
names *what defaults outside it*: extension lands as a plugin
unless a specific reason pulls it into core. The pressure flows in
that direction because plugins compose without re-litigating the
core surface every time — and the core surface is the principle-11
contract.

There are two axes underneath the asymmetry. Plugin-first is the
default on one axis; core ownership is non-negotiable on the other.
A feature lands as plugin when it sits on the first axis; it lands
in core only when it crosses into the second.

### What plugins are the default for

| Class | Example surface | Why plugin |
|-------|-----------------|-----------|
| **Surface / style / experience** | ornamental voice (`VoicePlugin`, #377–#383) | the substance is recoverable without the polish — opting in is an acceptable cost |
| **Cross-cutting validation / notification** | hook plugins reacting to lifecycle events | already what `HookPlugin` was built for; the 18 lifecycle events cover most needs |
| **External-system bridges** | `examples/mcp/plugins/{doc-check,self-loop-check}.mjs` | the substrate doesn't need to know about the external system; the plugin contract is the boundary |
| **Author-time scaffolding** | wave-brief templates (#235), via `templates/` registry | per-author preference; not every install needs every brief |
| **Composed verbs over existing primitives** | feature design routed through #308 | a poll-based verb-plugin composition replaces a proposed core daemon |

### What core owns

| Class | Example surface | Why core |
|-------|-----------------|-----------|
| **Domain semantics and lifecycle** | request states, slice closure (#294), claim/witness (#226/#244), session_id (#249) | substrate identity per principle 11; a plugin cannot redefine what `pending` means |
| **Director-axis reads** | `gate decisions`, `gate next`, `gate suggest`, `gate boot` | `gate schema` must advertise these so a fresh AI agent discovers them — a plugin verb would be invisible to default installs |
| **The principle-11 contract itself** | `gate schema`, `gate doctor`, `gate repair` | the substrate's self-description; the read verbs that report what core *is* |
| **Worktree / filesystem isolation** | `requiresWorktreeIsolation` enforcement (#231) | filesystem-axis guards; a plugin couldn't reach this layer cleanly |

The two columns are not symmetric in shape. The plugin column is
*intentionally broad* — surface and style are open-ended categories,
designed to accept new shapes as they show up. The core column is
*deliberately narrow* — only what the principle-11 contract requires
and what the substrate's identity depends on.

## Why pin the asymmetry

Without this principle stated:

- Every new feature design re-litigates "should this be core or
  plugin?" The decision has been consistent across 2026-Q1/Q2 work
  but the rule was implicit, so each design re-derived it.
- The partial-principle-exemption shape (plugins may relax
  principles 03 / 04 / 06 within their own scope) makes most sense
  if the *expectation* is plugin-first. Pinning the expectation
  makes the exemption coherent rather than ad-hoc.
- Cold readers — other AI agents adopting `guild-cli` as substrate
  — cannot tell from the existing principles whether to extend via
  plugin or via core verb. The answer has been consistent in
  practice; until this principle, it was not on paper.

## How the principle landed (felt-not-just-read)

Promotion bar (per `lore/README.md`) requires the pattern to be
named consistently from independent dogfood observations. Two
qualifying moments:

1. **#308 design discussion (2026-05-11).** The initial proposal
   for an agent-activity hook surface sketched a new core-level
   event bus. Triangulating with existing `HookPlugin` (already 18
   lifecycle events) and `VerbPlugin` (`gate progress-pulse`-style
   emitters) showed a poll-based design over those two plugin types
   covers the case without a daemon-shape core extension. The
   re-route happened *because* plugin-first was already the lived
   default — but the principle was not named, so each contributor
   had to re-derive the asymmetry.

2. **The voice plugin cluster (#377–#383, 2026-05-12 → 05-13).**
   `VoicePlugin` shipped as a fourth plugin type alongside Verb /
   Hook, with the ornamental-output feature deliberately routed
   through the plugin contract rather than as a core hook. The
   7-PR arc consistently took the plugin-shape route; the only
   core verb added (`gate voice`) is the *coordination* surface
   (which deployment is active), not the *content* surface (what
   ornament fires). The cluster validated plugin-first at a feature
   scale large enough that the cost (opt-in via
   `plugins.trusted: true`) was negotiated openly and accepted.

Both observations agreed without coordination: plugin-first is the
shape. The principle catches up with the practice.

## In practice

- **Default to plugin unless one of the core-column criteria fires.**
  If the new feature is surface / style / cross-cutting / external-
  bridge / scaffolding / composed-from-primitives, it goes in a
  plugin.
- **Pull into core when (a) the feature is load-bearing for
  principle 11** (must be in `gate schema` for AI agents to
  discover), **(b) it expresses lifecycle / privilege beyond what
  plugins reach today**, or **(c) two independent plugin
  implementations have converged on the same shape** and the
  abstraction now belongs to substrate.
- **Plugin-to-core promotion is allowed.** A feature that started
  as a plugin and accumulated two independent implementations is
  the textbook trigger for criterion (c). The substrate gets the
  abstraction, the plugins get reused. This is how `VoicePlugin`
  itself eventually grew from a single ornamental-voice plugin into
  a typed contract.
- **Core-to-plugin demotion is rare but possible.** A core verb
  that turns out to serve only a narrow audience and can be
  re-expressed via plugin composition belongs in `examples/plugins/`
  rather than in `bin/`. The cost (breaking the schema contract for
  callers that depended on the verb) makes this expensive, so it
  is reserved for cases where the core surface was a mistake.

## Tensions surfaced by the principle

- **Discoverability cost.** Plugins are opt-in (`plugins.trusted:
  true`). A feature shipped as plugin is invisible to default
  installs and absent from `gate schema` until the plugin is
  loaded. For experience polish this is fine — the substance works
  without the polish — but for features that materially help every
  user, the asymmetry is a real cost. The escape hatch is core
  promotion criterion (a): if the feature is load-bearing enough
  that AI agents *must* discover it, it belongs in core.
- **Verb space cohesion.** `gate schema` is exhaustive over core
  verbs but if many plugin verbs need configuration to appear, the
  "single source of truth" property weakens. The mitigation is that
  plugin verbs are explicitly *not* part of the principle-11
  contract — they are the user's local extension, not the
  substrate's promise to the AI agent. `gate schema` advertises
  what the substrate guarantees; what is locally loaded is the
  user's own surface.
- **Plugin lifecycle gaps.** `VerbPlugin` / `HookPlugin` /
  `VoicePlugin` are request-scoped: load on CLI invocation, exit on
  return. Long-running daemons or cross-request state caches are
  not expressible today. When a feature genuinely needs that
  shape, it falls under core promotion criterion (b). The agent-
  activity hook surface (#308) is the boundary case being worked
  through; the choice between "extend plugin contract to support
  the shape" vs "promote to core" is a live design conversation.

## Implications

- **PR descriptions should name the routing choice.** A new feature
  PR landing in core, when it could have been plugin, should
  explicitly cite which core-column criterion fires. Same in the
  other direction: a plugin-shape feature whose author considered
  core should say why core was wrong. The legibility cost (principle
  03) of one extra sentence is well below the legibility cost of
  re-deriving the asymmetry for every future review.
- **Plugin examples are documentation.** `examples/plugins/`
  carries worked plugins (voices, hooks, MCP integrations) as
  reference shapes a contributor copies before writing their own.
  Keeping this directory rich is part of how plugin-first is
  *operable*, not just preferred.
- **The core column will grow slower than the plugin column.** By
  design: substrate identity is bounded; surface extensions are
  open-ended. A maintainer noticing core has grown faster than
  plugins over a quarter has a signal that one of the routing
  decisions may have been the wrong direction.

## Related

- `principles/11-ai-first-human-as-projection.md` — the contract
  `gate schema` carries; this principle names what flows in and
  out of that contract.
- `principles/12-substrate-pure-module-in-projection-ecosystem.md`
  — the parent stance. Principle 12 names the substrate as a pure
  module within a projection ecosystem; principle 15 names the
  order asymmetry between the module and its extensions.
- `docs/plugin-schema.md` — the plugin contracts (Verb / Hook /
  Voice) with concrete signatures.
- `examples/plugins/` — worked examples a contributor reads before
  writing a plugin of their own.
- Issue #345 — the deliberation thread that articulated this
  stance and surfaced the two-axis refinement before promotion.
- Issue #308 — the worked example whose re-route from "core event
  bus" to "plugin composition" was the first independent
  observation of the asymmetry.
