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

### How much of this do I need to read?

Pick a depth. Every layer works on its own.

| Depth | File | When it's enough |
|-------|------|------------------|
| 30 sec | the paragraphs above | you want to know what this is |
| 5 min | [`docs/concepts-for-newcomers.md`](./docs/concepts-for-newcomers.md) | you came from Jira / PR review / ADR and want the translation |
| 10 min | [`AGENT.md`](./AGENT.md) | you're an AI agent about to run `gate` and want the verb map |
| 15 min | [`docs/playbook.md`](./docs/playbook.md) | you know each passage; you want **combos** (gate + agora + devil), recipes, and the bug-killing flow |
| 30 min | [`docs/verbs.md`](./docs/verbs.md) | you want per-verb examples and design notes |
| 1 hour | [`examples/dogfood-session/`](./examples/dogfood-session/) | you're adopting this seriously and want to see real sessions |
| working notes | [`docs/domain-fit/`](./docs/domain-fit/) | you're curious whether gate fits a non-standard domain |
| when needed | [`docs/POLICY.md`](./docs/POLICY.md) / [`SECURITY.md`](./SECURITY.md) | you're embedding guild-cli and need the stability / threat contract |

### Lore

[`lore/principles/`](./lore/principles/) — the load-bearing ideas
behind the design. One principle per file, ~30 lines each. Read these
when you need to know why a choice was made, not how. Append-only in
spirit, like the records `gate` itself produces.

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

Requires Node.js 20 or 22.

```bash
npm install
npm run build
node ./bin/gate.mjs --help     # request lifecycle / review / dialogue
node ./bin/agora.mjs --help    # play / narrative (suspend/resume primitives)
node ./bin/devil.mjs --help    # security-backstop review (alpha)
node ./bin/guild.mjs --help    # member management
```

A worked example content_root with config, members, and a multi-actor
session lives in [`examples/quick-start/`](./examples/quick-start/);
a longer real session is in [`examples/dogfood-session/`](./examples/dogfood-session/).

### Architecture: container with three passages

`guild` is the **container** — content_root, members, config, the
YAML substrate records outlive sessions on. Three passages run
through it today, each a distinct shape of agent interaction:

| Passage | Shape (一語) | What you do | When to reach for it |
|---------|------------|-------------|----------------------|
| `gate`  | **判断 / judgment** | decide on a request | something needs a verdict (approve, deny, complete, fail, review with ok\|concern\|reject) |
| `agora` | **探索 / exploration** | stay with a thought | something is in motion that shouldn't be forced to a verdict yet (Quest / Sandbox plays, suspend / resume cliffs) |
| `devil` | **守備 / defense** | protect end-users | something could harm a third party if landed without scrutiny (multi-persona, lense-enforced, friction-as-feature) |

The framing is a dispatch tool, not a metaphor: gate-shaped work
goes to `gate`, exploration-shaped to `agora`, defense-shaped to
`devil`. AI agents can route their work by recognizing the shape.

- **`gate`** (CLI) — the request-lifecycle / review / dialogue
  passage. Decisions and the deliberation around them: file a
  request, transition through approve / execute / complete,
  attach multi-lens reviews, audit-trail forever. The surface
  most agent work flows through.
- **`agora`** (CLI) — the play / narrative passage (alpha,
  shipping under `bin/agora.mjs`). Quest and Sandbox style games
  with **suspend / resume as a first-class primitive**: an
  agent leaves a `cliff` (what just happened) and an
  `invitation` (what the next opener should do); the next
  instance reads those and acts on the substrate-side Zeigarnik
  effect. The design rationale lives in
  [issue #117](https://github.com/eris-ths/guild-cli/issues/117).
- **`devil`** (CLI) — the security-backstop review passage
  (alpha, shipping under `bin/devil.mjs`). A **multi-persona,
  lense-enforced, time-extended review surface** that composes
  with single-pass tools (Anthropic `/ultrareview`, Claude
  Security, supply-chain-guard) rather than replacing them.
  Reviewers commit to a `persona` (red-team / author-defender /
  mirror), touch a per-content_root `lense` catalog, and
  conclude with synthesis prose rather than a verdict. Designed
  to **raise the security knowledge floor** for code reviewed
  by authors who haven't met OWASP top 10 — not to guarantee
  protection, but to keep the deliberation honest when a finding
  is dismissed. The design rationale lives in
  [issue #126](https://github.com/eris-ths/guild-cli/issues/126).
  See also the sister project
  [eris-ths/supply-chain-guard](https://github.com/eris-ths/supply-chain-guard)
  whose Devil Gate framework devil-review's `supply-chain` lense
  delegates to.

Plus a thin operator helper:

- **`guild`** (CLI) — meta layer for the container itself: list
  members, validate the roster, create members from outside any
  session. Small, stable, script-friendly.

All four CLIs share the same content_root substrate.
`gate register` and `guild new` write the same
`members/<name>.yaml` files — two views of the same act (one from
inside a passage, one from outside the container). agora-specific
records live under `<content_root>/agora/` (games, plays, casts);
devil-review records under `<content_root>/devil/` (reviews,
custom lenses).

The architecture is shaped to accept additional passages —
different shapes of agent interaction on the same substrate land
alongside `gate`, `agora`, and `devil` without absorbing into any
one of them.

Full surface in [`AGENT.md`](./AGENT.md); per-verb examples in
[`docs/verbs.md`](./docs/verbs.md). Agora's own README
([`src/passages/agora/README.md`](./src/passages/agora/README.md))
covers its layout, status, and lore upstream. devil-review is
documented inline in `AGENT.md` and `docs/verbs.md`.

### Test

```bash
npm test
```

CI runs the same suite on Node 20 and 22 via
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

### License

MIT. See [`LICENSE`](./LICENSE).
