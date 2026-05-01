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
node ./bin/guild.mjs --help    # member management
```

A worked example content_root with config, members, and a multi-actor
session lives in [`examples/quick-start/`](./examples/quick-start/);
a longer real session is in [`examples/dogfood-session/`](./examples/dogfood-session/).

### Architecture: container with one passage

`guild` is the **container** — content_root, members, config, the
YAML substrate records outlive sessions on. `gate` is **one
passage** through it: the request-lifecycle / review / dialogue
surface where most agent activity flows.

- **`guild`** (CLI) — operator-facing meta layer for the container:
  list members, validate the roster, create members from outside
  any session. Small, stable, script-friendly.
- **`gate`** (CLI) — agent-facing passage: requests, reviews,
  issues, messages, doctor / repair, and the schema agents read
  to dispatch. Larger, evolves faster, the surface most agents
  live in.

The two CLIs share the same content_root substrate. `gate
register` and `guild new` write the same `members/<name>.yaml`
files — two views of the same act (one from inside the passage,
one from outside the container).

The container has one passage today and is shaped to accept
others — different shapes of agent interaction on the same
substrate could land alongside `gate` without absorbing into
it. Until a second passage is needed, the inside of the container
looks like one CLI for agents (`gate`) plus a thin operator
helper (`guild`).

Full surface in [`AGENT.md`](./AGENT.md); per-verb examples in
[`docs/verbs.md`](./docs/verbs.md).

### Test

```bash
npm test
```

CI runs the same suite on Node 20 and 22 via
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

### License

MIT. See [`LICENSE`](./LICENSE).
