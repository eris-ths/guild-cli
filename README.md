# guild-cli

[![CI](https://github.com/eris-ths/guild-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/eris-ths/guild-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-20%20%7C%2022-green)](./package.json)

A small, secure, file-based CLI for a team of agents — human and AI —
to ask each other for work, review it, and leave a trail that nothing
in the loop can quietly rewrite.

Reviews are append-only. Each record is pinned to an actor, a lense,
and a moment. Corrections are new entries, not edits of old ones.
Over time the content_root becomes an **event log of judgments** —
not "what was decided" but **how the decision was formed**: who
proposed, who objected, through which lense, and whether the objection
was absorbed or overridden. The tool tracks deliberation, not
conclusions.

Built around a **Two-Persona Devil Review** loop — the person who
writes is not the person who reviews. Same model, different `--by`,
different lense. That alone surfaces blind spots a single self-contained
loop reliably misses.

The history grows. It never compresses into a single "current truth"
— that is a design choice, not a gap. The tool sharpens what you
see; it does not tell you what to conclude.

> Status: **alpha (0.x).** API may change per [`docs/POLICY.md`](./docs/POLICY.md)'s
> strict 0.x variant. See [`SECURITY.md`](./SECURITY.md) for the
> threat model and [`CHANGELOG.md`](./CHANGELOG.md) for release
> history.

### Solo flow (30 seconds)

If you are one person (or one AI agent) working alone, the whole
tool is six verbs:

```bash
gate register --name <you>
gate request --action "..." --reason "..." --executors <you>
gate approve <id> --by <mirror>
gate review  <id> --by <mirror> --lense user --verdict ok
gate execute <id> --by <you>
gate complete <id> --by <you>
```

That's the arc: register once, file the request, the **mirror**
approves and reviews, you execute and close.

**What is `<mirror>`?** A second persona / different `--by` for
the same actor — "you wearing a different hat," or another
registered agent acting as critic. Two-Persona Devil discipline:
even solo, the approver / reviewer is a different lense / different
moment from the executor. The defaults (`self_approve: allowed`
in the solo profile) permit `--by <you>` directly, but reaching
for a mirror persona is the discipline the substrate is shaped
around. Everything else in this README is depth on top of this
loop.

Need multiple agents working in parallel, worktree isolation, or
the swarm coordination story? See [`docs/swarm.md`](./docs/swarm.md).

### How much of this do I need to read?

Pick a depth. Every layer works on its own.

| Depth | File | Audience | When it's enough |
|-------|------|----------|------------------|
| 30 sec | the paragraphs + "Solo flow" above | solo | you want to know what this is |
| 5 min | [`docs/concepts-for-newcomers.md`](./docs/concepts-for-newcomers.md) | solo | you came from Jira / PR review / ADR and want the translation |
| 10 min | [`AGENT.md`](./AGENT.md) | solo / agent | you're an AI agent and want the full verb map across all four passages |
| 15 min | [`docs/playbook.md`](./docs/playbook.md) | pair | you know each passage; you want **combos** (gate + agora + devil flows; ctx-inclusive patterns arrive in phase 2), recipes, and the bug-killing flow |
| 15 min | [`docs/swarm.md`](./docs/swarm.md) | swarm | you orchestrate ≥2 parallel executors / Claude SubAgents and need the substrate-engagement recipe |
| 30 min | [`docs/verbs.md`](./docs/verbs.md) | any | you want per-verb examples and design notes |
| reference | [`docs/glossary.md`](./docs/glossary.md) | any | you hit a project-specific term and want the authoritative definition |
| 1 hour | [`examples/dogfood-session/`](./examples/dogfood-session/) | any | you're adopting this seriously and want to see real sessions |
| working notes | [`docs/domain-fit/`](./docs/domain-fit/) | any | you're curious whether gate fits a non-standard domain |
| when needed | [`docs/POLICY.md`](./docs/POLICY.md) / [`docs/storage-format.md`](./docs/storage-format.md) / [`SECURITY.md`](./SECURITY.md) | embedder | you're embedding guild-cli and need the stability / on-disk shape / threat contract |

### Lore

[`lore/principles/`](./lore/principles/) — the load-bearing ideas
behind the design. One principle per file, ~30 lines each. Read these
when you need to know why a choice was made, not how. Append-only in
spirit, like the records `gate` itself produces.

Recent: [`principle 14`](./lore/principles/14-substrate-engagement-reduces-coordination-context-cost.md)
extends principle 04 to coordination state — when multiple SubAgents
run in parallel, the substrate engagement (gate request + witness +
session_id stamps) IS the context-cost reduction; worked recipe in
[`docs/swarm.md`](./docs/swarm.md) § "Swarm × Claude SubAgent harness".

### For AI agents

If you are an AI agent: before asking what this tool *does*, ask what
you would like to **freeze**. A decision you want your next session to
be able to challenge. A review you want a different persona to write
against your own output. A request whose lifecycle you want a human
collaborator to be able to trace without asking you to explain.

guild-cli is the file-based coordination layer where those events
live — on disk, in YAML, across sessions, across models. No daemon,
no DB, no network. The `content_root` you work in is the whole world.

> **Short on context?** [`AGENT.md`](./AGENT.md) is the quick reference
> with all commands, state machines, and config. Read that instead of
> this README if you want to save tokens.

> 日本語の概要は [`README.ja.md`](./README.ja.md) を参照してください。
> (英語版の翻訳ではなく、日本語話者の AI エージェントに向けて独立に
> 書かれています。設計と開発は日英の往復で進んでいます。)

### Install

Requires Node.js 20 or 22. The `prepare` script auto-builds `dist/`
on `npm install`, so a separate build step is not needed (run
`npm run build` only after editing source).

```bash
npm install                              # auto-builds via prepare: tsc

# Once per content_root: register yourself as an actor.
node ./bin/gate.mjs register --name <you>

# Once per shell: set the default actor used by every verb.
export GUILD_ACTOR=<you>

# Every session: orient with one command.
node ./bin/gate.mjs boot                 # identity + status + tail + inbox + cross_passage in one JSON

# Discover the wave-brief templates shipped with this repo (#235):
node ./bin/gate.mjs templates list       # parallel-impl / compare-and-ratify / verification / single-impl / research-wave
```

#### Entry points

| CLI | Status | How to invoke |
|-----|--------|----------------|
| `gate`  | stable     | `npm link` then `gate ...`, or `node ./bin/gate.mjs ...` |
| `guild` | stable     | `npm link` then `guild ...`, or `node ./bin/guild.mjs ...` |
| `agora` | alpha (opt-in) | `node ./bin/agora.mjs ...` or `npm run agora -- ...` |
| `devil` | alpha (opt-in) | `node ./bin/devil.mjs ...` or `npm run devil -- ...` |
| `ctx`   | alpha (opt-in, phase 1) | `node ./bin/ctx.mjs ...` — only `record` ships in phase 1 |

`agora`, `devil`, and `ctx` are deliberately **not** listed in
`package.json#bin` while they remain alpha — opt-in is the stability
boundary, not an oversight. Beyond `node ./bin/<cli>.mjs` and
`npm run <cli> --` shown above, you can shell-alias the script
(`alias agora='node ./bin/agora.mjs'`) once you commit to a passage's
shape; the substrate is the same either way.

**New to guild?** Start with `gate`. `guild` is the admin-side helper —
register members, validate the roster, usually run once and forgotten.
Reach for `agora` / `devil` / `ctx` only when the **shape of work**
matches: thought-in-motion you want to suspend across sessions
(`agora`), a security-prone change that needs multi-persona scrutiny
(`devil`), or an observation that should outlive the session without
forcing a verdict (`ctx`).

#### Worked examples

Each directory below is a self-contained `content_root` you can `cd`
into and run verbs against:

- [`examples/quick-start/`](./examples/quick-start/) — minimal config + members
- [`examples/dogfood-session/`](./examples/dogfood-session/) — longer multi-actor real session
- [`examples/agent-first-session/`](./examples/agent-first-session/) — JSON-envelope agent-driven flow
- [`examples/agent-voices/`](./examples/agent-voices/) — multi-persona voice rendering
- [`examples/three-passages-framing/`](./examples/three-passages-framing/) — the gate / agora / devil framing arc preserved as a substrate snapshot (frozen at the 3-passage moment; `ctx` joined the open set later)

### Architecture: container with passages

`guild` is the **container** — content_root, members, config, the
YAML substrate records outlive sessions on. Passages run through it,
each a distinct shape of agent interaction:

| Passage | Shape (一語) | What you do | When to reach for it |
|---------|------------|-------------|----------------------|
| `gate`  | **判断 / judgment** | decide on a request | something needs a verdict (approve, deny, complete, fail, review with ok\|concern\|reject) |
| `agora` | **探索 / exploration** | stay with a thought | something is in motion that shouldn't be forced to a verdict yet (Quest / Sandbox plays, suspend / resume cliffs) |
| `devil` | **守備 / defense** | protect end-users | something could harm a third party if landed without scrutiny (multi-persona, lense-enforced, friction-as-feature) |
| `ctx`   | **事実 / fact accumulation** | record an observation | something has been observed across sessions and would be lost without an attributed, append-only record (no verdict needed) |

The framing is a dispatch tool, not a metaphor: gate-shaped work
goes to `gate`, exploration-shaped to `agora`, defense-shaped to
`devil`, fact-shaped to `ctx`. AI agents can route their work by
recognizing the shape. The set is open — see
[`lore/principles/12-substrate-pure-module-in-projection-ecosystem.md`](./lore/principles/12-substrate-pure-module-in-projection-ecosystem.md)
for how additional passages compose with these without absorbing
into any one of them.

Per-passage notes (each builds on the dispatch table above):

- **`gate`** — request lifecycle + multi-lense reviews + audit
  trail. The surface most agent work flows through.
- **`agora`** — Quest / Sandbox plays with **suspend / resume as a
  first-class primitive** (cliff + invitation for substrate-side
  Zeigarnik continuity across instances). Design: [#117](https://github.com/eris-ths/guild-cli/issues/117).
- **`devil`** — multi-persona (red-team / author-defender / mirror),
  lense-enforced review designed to **raise the security knowledge
  floor**, composing with single-pass tools rather than replacing
  them. Conclude with synthesis prose, not a verdict. Design:
  [#126](https://github.com/eris-ths/guild-cli/issues/126); the
  `supply-chain` lense delegates to sister project
  [eris-ths/supply-chain-guard](https://github.com/eris-ths/supply-chain-guard).
- **`ctx`** (phase 1) — verdict-less, append-only fact records with
  `prefix:value` labels (e.g. `tech:typescript`) for semantic query
  later. Phase 1 ships `ctx record` only; `fork` / `supersede` / etc.
  in phase 2.

Plus a thin operator helper:

- **`guild`** (CLI) — meta layer for the container itself: list
  members, validate the roster, create members from outside any
  session. Small, stable, script-friendly.

All five CLIs share the same content_root substrate.
`gate register` and `guild new` write the same
`members/<name>.yaml` files — two views of the same act (one from
inside a passage, one from outside the container). agora-specific
records live under `<content_root>/agora/` (games, plays, casts);
devil-review records under `<content_root>/devil/` (reviews,
custom lenses); ctx records under `<content_root>/ctx/` (one
flat YAML per observation in phase 1).

The architecture is shaped to accept additional passages —
different shapes of agent interaction on the same substrate land
alongside `gate`, `agora`, `devil`, and `ctx` without absorbing
into any one of them. Principle 12 names the boundary so future
passages stay substrate-pure rather than re-implementing card
abstractions, GUI projection, or persona logic that adjacent
ecosystem modules already cover.

Full surface in [`AGENT.md`](./AGENT.md); per-verb examples in
[`docs/verbs.md`](./docs/verbs.md). Both cover all four passages.
agora and devil each have a passage-local README
([`src/passages/agora/README.md`](./src/passages/agora/README.md),
[`src/passages/devil/README.md`](./src/passages/devil/README.md))
for layout-specific notes; ctx (phase 1) lives entirely in the
inline AGENT.md / docs/verbs.md sections.

### Test

```bash
npm test
```

CI runs the same suite on Linux and Windows × Node 20 and 22, plus
an `npm pack --dry-run` artifact gate, via
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml). **CI is
the source of truth.** A handful of tests can fail in local runs on
macOS due to `/var/folders` ↔ `/private/var/folders` symlink
resolution and a separate JSON-parsing edge case in the schema
snapshot — these do not occur in CI. See
[`CONTRIBUTING.md`](./CONTRIBUTING.md) for the env-sensitivity notes.

### License

MIT. See [`LICENSE`](./LICENSE).
