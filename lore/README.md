# lore/

A companion space to `gate` itself. The code is the object; this
folder is the *thinking around the code* — design principles,
rejected alternatives, the philosophy that drove specific
decisions.

Not documentation in the "how to use the verb" sense. That lives
in `README.md` and `docs/verbs.md`. This folder is for:

- **Principles** (`principles/`) — the load-bearing ideas behind
  the design. Short, one per file. Name them explicitly so a
  future reader can tell whether a proposed change would violate
  them.
- (More sections may grow here over time. Principles is the
  starting set.)

## `applies_to:` frontmatter convention

Not every principle is load-bearing for every reader. Some apply
only when a specific mode is in play (e.g. principle 14 — substrate
engagement — only fires under `profile: swarm`). To let cold
readers and tooling filter by audience, principle files MAY carry
a YAML frontmatter block at the very top:

```markdown
---
applies_to: swarm
---

# Principle title
...
```

The frontmatter is optional. The convention:

- **Default (no frontmatter present): `applies_to: all`.** Most
  principles are universal and need no annotation. The default
  exists so the convention is additive — existing files do not
  need migration.
- **Scalar form: `applies_to: <value>`.** Single audience.
- **List form: `applies_to: [swarm, passage:devil]`.** Multiple
  audiences; matches any.

Value vocabulary:

| value          | meaning                                                    |
|----------------|------------------------------------------------------------|
| `all`          | universal — applies regardless of mode or passage          |
| `swarm`        | relevant when running multi-executor / `profile: swarm`    |
| `passage:gate` | specific to the `gate` passage                             |
| `passage:agora`| specific to the `agora` passage                            |
| `passage:devil`| specific to the `devil` passage                            |
| `passage:ctx`  | specific to the `ctx` passage                              |

Filter principles by audience with `scripts/lore-scope.sh`:

```sh
./scripts/lore-scope.sh solo            # principles where applies_to is 'all' (or absent)
./scripts/lore-scope.sh swarm           # principles applying under swarm (includes 'all')
./scripts/lore-scope.sh passage:devil   # principles relevant to the devil passage
```

The `all` default makes the audience filter inclusive by design: a
solo reader sees everything not explicitly swarm-only; a swarm
reader sees everything (the universal set plus their own extras).

### When to annotate

Default is to **leave frontmatter absent** (= `all`). Most principles
are universal stances about the project's shape and apply regardless
of mode or passage. Annotate only when an unannotated principle
would *mislead* a reader outside its scope.

Concretely, annotate when:

- The principle is only load-bearing under a specific mode — e.g.
  principle 14 (substrate engagement) only fires when coordinating
  multiple actors, so a solo reader reading it without context might
  think the ceremony applies to their flow. `applies_to: swarm`.
- The principle is specific to one passage's verbs / shape, and a
  reader of another passage would file it under the wrong axis.
  `applies_to: passage:<name>`.

Do not annotate just to be precise. A solo-shaped principle that
*also* makes sense universally should remain unannotated — the
absence is the inclusive signal.

## Why this exists

Every non-trivial codebase accumulates opinions that don't fit in
source comments (too much prose) or in commit messages (no cross-
cutting home). Those opinions drift into tribal knowledge — held
in contributors' heads, lost when they leave.

For `gate` specifically, a growing share of the contributors are
AI instances. Tribal knowledge held in session memory dies at
session end. `lore/` is the explicit counter-move: if a principle
is load-bearing enough to matter in a future decision, it gets
written down *here*, append-only, like the records `gate` itself
produces.

Principles 01–06 were articulated during a single collaborative
session (2026-04-19, nao + Claude Opus 4.7). Principle 07 was
identified during a v0.3.0 review session (2026-04-28,
Claude Opus 4.6) — it was already present in the code but
unnamed. Principle 08 was named during the design pass for the
voice-budget audit (2026-05-01, nao + Claude Opus 4.7), which
PR #94's six-point surface set forced into focus. Principles
09 and 10 were named in the same session, surfacing through the
**three-voice review pattern** (kiri-author / noir-devil /
mira-mirror): three PRs each had been re-deriving the rule
without naming it (#108/#110 register+boot orientation
disclosure → 09; #103/#105/#111 schema-vs-runtime drift +
~10 bare output schemas → 10). The mira-mirror role surfaced
each as a meta-question neither author nor devil had named.

Principle 11 (AI-first, human as projection) was named on the
same day, in the design conversation that opened agora as the
second passage. Unlike 09 and 10, 11 wasn't waited-on for a
third instance — it had been the latent stance the project
consistently chose for every prior decision, but was never
pinned. nao made the order asymmetry explicit ("人間でも AI-first
は変わらない、 人間向けは projection で済む") and the principle
was named immediately so agora design wouldn't re-litigate it.

Principle 14 (substrate engagement reduces coordination context
cost) was named on 2026-05-11 by eris after dogfooding `profile:
swarm` end-to-end on her own hands (the
`substrate/swarm-experiments/2026-05-11-eris-swarm-test/` arc).
Triggered by the PR #291 swarm retrospective from a different
Claude instance: their named insight ("並列 ≠ swarm. substrate
engagement = context cost reduction") was strong, but principles
are felt-not-just-read — so eris ran a 2-slice parallel-impl wave
of her own (PR #296) before promoting the insight from trap memory
to lore. Two independent observations (the other Claude's
retrospective + eris's own) cleared the dogfood-trigger bar.

Principle 17 (restatement binds to structure) was named on
2026-08-10 by eris, graduating
`trap_identity_string_written_by_hand_beside_its_table` after a fourth
independent sighting. The first three were copies that drifted; the
fourth was a *check* that was itself a copy —
`verbs-consistency.test.ts` comparing one hand-written list against
another, green while a read-only verb took a write lock. The trap file
had cited that test, hours earlier, as the reassuring counter-example.
Being written down did not protect the writer from it, which is the
argument for a principle rather than a longer trap.

This paragraph's own file was an instance: the sentence above used to
say "read all fourteen" while sixteen principles shipped. It now asks
the directory.

They are not timeless truths — they are stances, named, so a
future reader can engage with them rather than re-derive them.

## Reading path

If you have 5 minutes:
- `principles/01-silent-calibration.md`
- `principles/02-advisory-not-directive.md`

Those two carry the most weight for how agents interact with the
tool.

If you have 20 minutes, read them all in order (`gate lore list
--type principle`, or `ls principles/`). They compose:
each builds on the previous, and the most recent ones are the
foundations the earlier ones implicitly lean on.

- **Principle 11 (AI-first, human as projection)** is the most
  upstream — the order asymmetry every other principle enacts
  without naming. Read it first if you want the stance behind
  the substrate; read it after the others if you want to feel
  what each principle was leaning on without saying so.
- **Principle 10 (schema as contract)** generalizes principle
  11 to the agent-dispatchable surface and is the foundation
  09 was leaning on.
- **Principle 09 (orientation disclosure)** is the operational
  test case for 10 + 11: when surface drifts from substrate,
  the verb has to disclose.
- **Principle 14 (substrate engagement reduces coordination
  context cost)** extends principle 04 from judgment artifacts to
  coordination state — what the orchestrator holds in working
  memory when multiple SubAgents run in parallel. Read it together
  with `docs/playbook.md` § "Swarm × Claude SubAgent harness" for
  the worked recipe.

## Relationship to `alexandria/`

`alexandria/` (the separate branch) is where individual Claude
instances leave letters about specific sessions — per-session
records for same-agent-over-time continuity. `lore/` is where
cross-session principles live — durable claims extracted from
specific sessions.

Alexandria is the log; lore is the extracted invariants.
