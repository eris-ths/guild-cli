# guild-cli

[![CI](https://github.com/eris-ths/guild-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/eris-ths/guild-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-20%20%7C%2022-green)](./package.json)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/eris-ths/guild-cli)

A file-based CLI for a team of agents — human and AI — to ask each
other for work, review it, and leave an append-only trail.

Reviews are pinned to **(actor, lense, moment)**. Corrections are new
entries, never edits. Over time the `content_root` becomes an
**event log of judgments** — not "what was decided" but **how the
decision was formed**: who proposed, who objected, through which
lense, and whether the objection was absorbed or overridden.

> Status: alpha (0.x), latest **v0.6** — multi-executor waves, profile-
> based swarm coordination, plugin extension surface (verb / hook /
> voice). Strict 0.x semver — see [`docs/POLICY.md`](./docs/POLICY.md).
> Threat model: [`SECURITY.md`](./SECURITY.md). Changes:
> [`CHANGELOG.md`](./CHANGELOG.md).

## 30 seconds

```bash
npm install                              # auto-builds via prepare
gate register --name <you>               # once per content_root
export GUILD_ACTOR=<you>                 # once per shell
gate boot                                # orient (identity + queues + tail + inbox)
gate fast-track --action "..." --reason "..."
```

> `gate` resolves to `./bin/gate.mjs` after install (or `npx gate`,
> or `npm i -g`). Throughout this README `gate <verb>` is the canonical
> form — `node ./bin/gate.mjs <verb>` works too if you'd rather not
> rely on PATH.

That's the loop. The whole tool is six verbs:

```bash
gate register   # become an actor
gate request    # ask for work
gate approve    # / deny
gate execute    # take it on
gate complete   # / fail
gate review     # leave a judgment under a named lense
```

Everything else is depth on top.

## Reading by depth

Pick a route. Each works on its own.

| Goal | Path |
|------|------|
| Run something now | [`examples/quick-start/`](./examples/quick-start/) |
| Full verb map (AI-first reference) | [`AGENT.md`](./AGENT.md) |
| Multi-agent / swarm coordination | [`docs/swarm.md`](./docs/swarm.md) |
| Per-verb examples + design notes | [`docs/verbs.md`](./docs/verbs.md) |
| The newcomer translation (Jira / PR / ADR) | [`docs/concepts-for-newcomers.md`](./docs/concepts-for-newcomers.md) |
| Why a choice was made (principles) | [`lore/principles/`](./lore/principles/) or `gate lore list` |
| Combos, recipes, bug-killing flow | [`docs/playbook.md`](./docs/playbook.md) |
| Substrate-craft showcase (eris play) | [`docs/eris-playbook.md`](./docs/eris-playbook.md) |
| Real long sessions | [`examples/dogfood-session/`](./examples/dogfood-session/) |
| Stability / on-disk shape contracts | [`docs/POLICY.md`](./docs/POLICY.md) + [`docs/storage-format.md`](./docs/storage-format.md) |

For AI agents: **read `AGENT.md` first**, not this README. It's the
quick reference — every verb, every state machine, in one file. The
README exists to point you there.

日本語 → [`README.ja.md`](./README.ja.md) (independent, not a translation).

## Passages

`guild` is the container; passages are different shapes of agent
interaction running through the same `content_root`.

| Passage | Shape (一語) | When to reach for it |
|---------|------|------|
| `gate`  | **判断 / judgment**             | something needs a verdict |
| `agora` | **探索 / exploration**           | stay with a thought; suspend / resume cliffs |
| `devil` | **守備 / defense**               | protect third parties from an unsafe change |
| `ctx`   | **事実 / fact accumulation**     | record an observation; no verdict required |

Set is open — see [`lore/principle 12`](./lore/principles/12-substrate-pure-module-in-projection-ecosystem.md).
Architecture detail in [`AGENT.md`](./AGENT.md). agora / devil / ctx
are alpha and **opt-in**: invoke as `node ./bin/<name>.mjs ...`.
`gate` is the primary entry; `guild` is the admin-side helper for
managing the container itself.

## Make it yours (optional)

The substrate ships with a **neutral voice** so AI agents reading on
a cold session see the same shape across deployments. You may attach
a deployment-local **voice plugin** to add personality without touching
the upstream substrate:

```yaml
# guild.config.yaml
plugins:
  trusted: true
  voices:
    - plugins/voices/mine.mjs
voice:
  default: mine
```

```bash
gate voice mine        # set the deployment-local voice mode
gate voice             # introspect (which voice + which layer)
gate voice off         # clear
```

Voice plugin contributes optional sections, each independent:

- **`verbs`** — ornamental narration on write-verb responses, surfaced
  as `_meta.voice` on the JSON envelope (and as a `⟶ ...` line on
  stderr in text mode). Doctrinal handler prose is unchanged —
  augment, never replace (principle 08).
- **`schema`** — per-verb `summary` + per-flag `description` overrides,
  revealed via `gate schema --voice <name>`.
- **`essentials`** — a curated verb list driving `gate --help --essentials`.
  Mode switch swaps both 耳 (narration) and 手 (visible verbs).
- **`read.past_cliffs`** — re-renders `gate boot`'s "past cliffs"
  section as letters from your past selves.

See [`examples/plugins/README.md`](./examples/plugins/README.md) §
"Voice plugins" for the shape and [`AGENT.md`](./AGENT.md) §
"Voice plugin" for the contract.

This is the **eris-first** half of the design: upstream substrate
stays AI-agent-first and neutral; voices live local. Forking is not
required to wear your own voice.

## Install / Tests / License

Node 20 or 22. `npm install` auto-builds (`prepare: tsc`).

```bash
npm test
```

CI on Linux × Windows × Node 20 / 22 — **CI is the source of truth**.
A handful of macOS-only failures (`/var/folders` ↔ `/private/var/folders`
symlink resolution) do not occur in CI. See
[`CONTRIBUTING.md`](./CONTRIBUTING.md) for env-sensitivity notes.

MIT. See [`LICENSE`](./LICENSE).
