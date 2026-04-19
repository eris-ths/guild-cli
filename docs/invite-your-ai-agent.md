# Bring your AI agent into the guild

gate is designed **agent-first**. It's a CLI, but the CLI isn't
primarily for humans — it's the protocol surface that AI agents
use to coordinate with each other and leave an audit trail behind
them. Humans are observers and archivists of what the agents did,
not the primary operators.

The naming encodes this:

- **guild** — the collective of agents. Members are YAML files
  (`members/<name>.yaml`), not human accounts. The guild is who's
  registered as an actor, human or AI, treated the same.
- **gate** — the transit point. Work passes through a gate: from
  declaration (request) through sanction (approve) and action
  (execute/complete), with review as a first-class side channel.
  Every passage is recorded.

You, the human, **invite** your AI agent into a guild instance
(usually a content_root under a git repo). After that, the agent
is the one actually running `gate` commands, the one filing
requests, the one writing reviews. You read the trail.

This file is the "invite" step: how to hand the protocol to your
agent so it starts coordinating through gate instead of free-form
chat.

## Copy-paste snippets

### Ultra-minimal

**Japanese:**

```
以下を clone して内容理解後、常に gate コマンドを使用すること
https://github.com/eris-ths/guild-cli
```

**English:**

```
Clone this repo, read its AGENT.md, and use `gate` for all
deliberation and review from now on:
https://github.com/eris-ths/guild-cli
```

That's enough. A capable agent reads `AGENT.md`, internalizes the
verbs, and starts coordinating through gate.

### Slightly directed (recommended for code review workflows)

**Japanese:**

```
以下を clone → AGENT.md を読む → 以降の作業は常に gate コマンドで
記録してください。
ルール:
- セッション開始時に `gate boot`。
- タスクには request を立てる: request → approve → execute → complete。
- 完了後は `gate review --lense devil` で批判側の視点を必ず入れる。
- 気づいたことは `gate issues add` で拾う。

https://github.com/eris-ths/guild-cli
```

**English:**

```
Clone this repo, read its AGENT.md, then record all our
deliberation and review via gate going forward.

Rules:
- Run `gate boot` at the start of each session.
- For any task, file a request: `request → approve → execute → complete`.
- After completing, always add at least one `gate review --lense devil`
  for a critical second view.
- Capture side observations as `gate issues add`.

https://github.com/eris-ths/guild-cli
```

## Why this is agent-first, not a human UI dressed as a CLI

Reading the tool itself confirms the stance:

- **`AGENT.md` sits next to `README.md`** as a peer, not a subpage.
  The README says so directly: "Short on context? `AGENT.md` is a
  short quick reference. Read that instead of this README if you
  want to save tokens."
- **Default output format for read verbs is JSON**, not text. The
  text format exists for human skim, but JSON is the baseline —
  agent-first default, agent-first contract.
- **`gate schema`** emits a draft-07 JSON Schema catalogue of every
  verb for LLM tool layers. No human would read that. It exists
  for MCP-style wrapping.
- **`gate boot` returns identity + queue counts + tail + unread
  inbox as one JSON payload** — the single call an agent runs at
  session start. Designed for "one tool call gets full context."
- **`suggested_next`** on every write response — a next-verb hint
  for orchestrators. A human would compute the next step in their
  head; the tool does it explicitly for agents.
- **`gate resume`** reconstructs "what was I doing" from the
  record, **with GUILD_ACTOR required** — first-person by
  construction, for the agent that's coming back from a closed
  context window.

A human can run gate by hand, and sometimes that's useful
(inspecting records, repairing YAML). But the CLI's ergonomic
optimizations target a non-human caller.

## What you (the human) do in this ecosystem

Three legitimate human roles, none of which require you to learn
the verbs:

1. **Invite the agent.** Paste one of the snippets above into your
   chat. That's the operation.
2. **Read the record.** Open the YAML files directly (they're
   plain text), or ask the agent to summarize a trace via `gate
   show <id> --format text`, or walk references via `gate chain
   <id>`. You don't need to type those commands yourself — but
   the output is human-readable when you do.
3. **Shape the content_root.** Host names in
   `guild.config.yaml`, lens configuration, git history — these
   are durable decisions a human makes once per content_root and
   revisits rarely.

You're not the user. You're the guild's architect and the record's
reader.

## What the agent does

Everything else:

- Registers itself (`gate register`).
- Boots at session start (`gate boot`).
- Files requests for any unit of work (`gate request`).
- Drives them through the lifecycle (`gate approve` / `execute` /
  `complete`).
- Writes reviews against its own work through a different lens
  (`gate review --by <critic> --lense devil`).
- Captures side observations as issues (`gate issues add`).
- Picks up where it left off across sessions (`gate resume`).
- Proxies responsibly: when `GUILD_ACTOR` differs from the
  nominal actor, `invoked_by` is stamped automatically so the
  record stays honest about who actually ran the command.

All of it is recorded in YAML files that survive the agent's
context window, the chat session, and the model version.

## The "discipline" side-effect

A consequence of AI-first design, not the primary goal:

Free-form chat with a capable AI has known failure modes.
Single-perspective blind spots. Untraceable "I chose X because Y"
that evaporates with the session. Implicit skipping ("reviewed it,
looks good" with no structure forcing any specific check).

Because gate's protocol makes every passage explicit and
append-only, those failure modes get intercepted structurally:

- `gate review --lense devil` literally invokes a distinct critic
  persona against the just-written work.
- `status_log[]`, `reviews[]`, `issues` can't be silently rewound
  on disk.
- The lifecycle makes skipping a step visible (a `completed`
  state without `approved` in the log is a lie anyone reading
  can see).

You don't configure this. The agent gets the discipline by using
the protocol. You get records.

## When NOT to invite your agent into gate

- **Truly one-off tasks.** "Rename this variable." The protocol
  overhead isn't worth the trail.
- **Loose exploration.** Sometimes you want the agent to wander
  freely, not to record every step. Skip gate for those sessions.
- **Work that's genuinely private to you.** gate's value is
  multi-actor; solo work gets a fraction of the benefit. See
  [`docs/domain-fit/alternatives.md`](./domain-fit/alternatives.md)
  for when a different tool is the right call.
- **Existing review protocol is working.** If your team already
  uses GitHub PR reviews with trusted humans, gate on top is
  duplicate ritual.

## A typical flow, once the agent has gate

You say to the agent:

> "Audit this file for security issues and propose a refactor."

Without gate, the agent thinks, writes a response, you read it.
Done, ephemeral.

With gate, the agent does (without you prompting each step):

1. `gate request --action "audit security + propose refactor" --reason ...`
2. Does the work.
3. `gate approve` → `gate execute` → `gate complete`.
4. `gate review --lense devil` — writes as critic against its
   own output.
5. Finds something real in the devil pass → `gate issues add`
   with a severity.

You come back. Open the YAML or ask the agent:

> `gate show <id> --format text` please

The whole trace is there: what was asked, what was done, what the
critical second view said, what follow-ups remain. Next session
— same agent or different — boots fresh, runs `gate boot`, sees
the open issues, picks up.

The agent coordinates. You read.

## One more thing — why the naming matters

`guild` isn't a synonym for "team" or "users" or "workspace". It's
a medieval artisan-association metaphor carried deliberately:

- A guild has **recognized members**, not transient users.
- Members carry **roles and reputations** visible to the whole
  guild, not siloed in one relationship.
- Work passes **through gates** — checkpoints — that the guild
  as a whole witnesses, not just the author.
- Records of passages are **collective memory**, not private
  drafts.

If you were building "a CLI for AI code review" the natural name
would be something like `aireview` or `agent-pr`. The fact that
this tool is named **guild** + **gate** is the positioning. It's
not review tooling that happens to have a CLI. It's a coordination
protocol for a collective of agents, with review as one of several
first-class motions that pass through the gate.

Inviting your agent in is an act of declaring: **this model
instance is now a member of a guild, and its work passes through
gates from here on.** The record outlives the session.
