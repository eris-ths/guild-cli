# Schema as contract

**`gate schema` is the agent dispatch contract. The runtime must
not accept inputs the schema doesn't advertise, and must not emit
outputs the schema doesn't describe.**

## Statement

When an AI agent (or any orchestrator) integrates `gate` via MCP
or any schema-driven dispatch, it reads `gate schema` to learn
what verbs exist, what flags each takes, and what shape each
returns. From that read, it builds a wiring it then trusts at
runtime. If the schema is incomplete, the agent's wiring is
either narrower than the runtime (missing flags it could be using)
or broader than the runtime (advertising features the runtime
doesn't honour). Both forms are silent failures: the wiring
"looks right" but produces wrong behaviour at the moment of use.

So the schema isn't documentation — it's the **contract**. It must
match the runtime in both directions:

- **Input side.** Every flag the runtime accepts via
  `KNOWN_FLAGS` must appear in `schema.input.properties`. Every
  property in `input.properties` (that isn't a positional) must
  be a runtime-accepted flag.
- **Output side.** Every field the runtime emits in JSON must
  appear in `schema.output`. The output schema must describe
  the actual shape, not be a placeholder like
  `{ type: 'object' }`.

## Why this is a separate principle

Principle 02 (advisory not directive) says the tool flags edges
without forbidding crossings. Schema-as-contract is a corollary:
**the tool can only flag edges the agent knows exist.** A bare
`output: { type: 'array' }` says "you'll figure it out at
runtime" — which forfeits the advisory role entirely on that
surface.

Principle 03 (legibility costs) says label what's silenced. Bare
output schemas silence the contract. The cost is "every agent
doing schema-driven dispatch reads either source code or
empirical responses" — and empirical responses are not
contracts; they're observations of one moment.

Principle 04 (records outlive writers) applies here doubly: the
schema is part of the public surface that outlives the writer.
A schema that's incomplete now becomes a load-bearing source of
ambiguity for every downstream wiring.

Principle 09 (orientation disclosure) names that verbs disclose
content_root identity when surprising. **That principle was
implicitly leaning on this one** — without "schema is contract"
you cannot meaningfully say "boot's missing-disclosure was a
contract bug," only "it was annoying." With it, the asymmetry
between what `gate boot` claimed (via schema) and what it
delivered (via the JSON envelope) was the bug.

## Concrete obligations

A verb's schema entry must satisfy:

1. **Input completeness.** `Object.keys(input.properties)`
   minus positionals equals the runtime's `KNOWN_FLAGS`. PRs
   that add a flag to `KNOWN_FLAGS` must add the matching
   `input.properties` entry in the same change. PRs that
   remove a flag must remove both. Mechanical CI test pending
   (this is a tracked follow-up).

2. **Output specificity.** `output` must describe the actual
   shape — not `{ type: 'array' }` or `{ type: 'object' }`
   alone. For arrays, declare `items`. For objects, declare
   `properties`. Use named sub-schemas (e.g., `utteranceSchema`,
   `requestSchema`) when the same shape appears across verbs so
   updates land in one place.

3. **Snake_case keys.** Every property name in any output schema
   uses snake_case (matching the project's JSON convention from
   PR #109). camelCase is a regression.

4. **Runtime validates against schema.** A test exists that
   takes a real invocation's output and validates it against
   the declared schema. This makes the schema unforgeable at
   the TS-implementation/schema-declaration boundary: if the
   runtime emits a shape that doesn't match the schema, EITHER
   the runtime regressed OR the schema is wrong; either way,
   CI catches it.

## What this principle is NOT

- **Not a freeze on schema evolution.** Adding a flag, fleshing
  out an output, deprecating a deferred entry — all welcome.
  The principle says "no drift between schema and runtime,"
  not "no change to schema."

- **Not a mandate to schemafy text-mode output.** Schema
  describes JSON shapes, not text rendering. `gate doctor`
  emitting `content root: ... (config: ...)` in text mode while
  the JSON envelope omits the field is intentional asymmetry per
  principle 09's boundary.

- **Not a substitute for documentation prose.** Schema
  descriptions carry voice (principle 08); they don't replace
  long-form lore or the README. The contract is the *shape*; the
  *voice* is what makes it agent-readable.

## Tracked follow-ups

When this principle was named, the codebase had:

- ~10 read verbs with bare output schemas (`{ type: 'array' }`,
  `{ type: 'object' }`). This PR fleshes 2 (`tail`, `voices`)
  using a shared `utteranceArraySchema`. The remaining 8
  (`status`, `whoami`, `show`, `chain`, `list`, `pending`,
  `repair`, `issues *`) are mechanical and queued as follow-up
  PRs.
- No mechanical drift detector for the input side. PRs #103
  (`--dry-run`), #105 (`--with-calibration`), #111 (`tail
  --format`) all hit the same drift after-the-fact. Adding a
  CI-level test that compares each handler's `KNOWN_FLAGS`
  against its schema entry is the natural enforcement vehicle;
  queued as the next follow-up.

The deferred list is the work-queue, not a rot risk: once the
principle is named, every bare schema is a known violation, and
the CHANGELOG entry on each follow-up cites this principle by
number.
