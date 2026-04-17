# Concepts for newcomers

30-second mental map for anyone arriving from another tool. Once you
see the rough shape, the full [README](../README.md) and
[AGENT.md](../AGENT.md) start making sense.

## Elevator pitch

`guild-cli` is a **file-based log of decisions and the dialogue
around them**. Actors (humans or AI agents) file `request`s, move
them through a lifecycle, and leave multi-perspective `review`s.
Everything is YAML under `content_root/` — git gives you the
history, no DB, no network.

It is **not** a task tracker. It is not for doing things. It is for
deciding, recording the why, and keeping the dialogue visible so
the next session — or the next agent — can pick up where you left off.

## Coming from another tool?

| You used… | Closest guild-cli concept | Key difference |
|-----------|--------------------------|----------------|
| **Jira / Linear** (issues + assignees) | `request` has `executor` like assignee, `state` like status | `request` also carries multi-lens `review`s and forced `reason`; it's closer to an ADR + ticket fused together |
| **`issues` in guild-cli** | `issue` | In guild-cli, `issue` is a lightweight observation that hasn't become a decision yet. Promote it to a `request` when someone commits to act. |
| **GitHub pull request review** | `gate review --lense X --verdict Y` | Reviews in gate attach to *requests* (decisions), not diffs. Multiple reviewers can each apply different lenses to the same request. |
| **Slack / Discord DM** | `gate message --from A --to B` | Push-based messaging with an `inbox`, same channel as the decision log — you can DM about a specific `request` and the reference persists. |
| **ADR** (architecture decision record) | `request` + `reason` + `review`s | Same spirit, but *alive*: reviews and messages keep accruing after the decision is made. |
| **Standup / retro notes** | `gate tail` / `gate voices <actor>` | Replay the content_root's dialogue, filtered by actor or lens, instead of scrolling chat history. |

## Quick vocabulary

- **actor** — a human or AI agent. Has a `MemberName` (lowercase ASCII) and lives as `members/<name>.yaml`.
- **host** — an actor that runs the content_root (not a member, but can `--by` / `--from` anything). Listed under `host_names:` in `guild.config.yaml`.
- **request** — a decision-in-motion. Has `action`, `reason`, optional `executor` / `auto-review`, and moves through `pending → approved → executing → completed` (or `denied` / `failed`).
- **review** — multi-perspective feedback on a request. Carries a `lense` (one of `devil | layer | cognitive | user` by default — extend via config) and a `verdict` (`ok | concern | reject`).
- **lense** — the angle a reviewer is taking. `devil` = "what breaks?", `layer` = "which structural layer is this on?", `cognitive` = "where would someone hesitate?", `user` = "whose happiness (LDD)?". Add domain lenses (`security`, `perf`, `a11y`, ...) in `guild.config.yaml`.
- **verdict** — `ok` (landed cleanly), `concern` (lives with the decision but you want it named), `reject` (don't do this). The word is deliberately soft — `concern` is usable, not a veto.
- **fast-track** — single-actor shortcut for the full lifecycle when self-approved work is appropriate. Still requires `reason`; `review`s can be attached after.
- **issue** — a standalone observation that has not yet become a decision. Lightweight, optional `severity` / `area`. Promote to `request` via `gate issues promote <id>`.
- **pair-mode (`--with`)** — records who you were thinking with when you shaped a request. Surfaces in `show`, `voices`, and `resume` prose ("shaped with eris").
- **content_root** — the YAML directory gate reads from. Contains `members/`, `requests/`, `issues/`, `inbox/`, and `guild.config.yaml`. Git it for history. See AGENT.md § File layout.

## Core loop

```
observe → file an issue (maybe) → decide → file a request
   ↓                                          ↓
   ────── promote to request ─────────►  approve → execute → complete
                                              ↓         ↓         ↓
                                          review ←── review ←── review
                                         (devil) (layer) (cognitive) (user)
```

## The one thing most newcomers miss

guild-cli is **not** trying to *automate* the decision. It's trying
to make the decision and its dialogue **legible later** — to you,
to another agent, to the next session of the same agent. The value
compounds: one `fast-track` with one review is fine, ten sessions
of accrued reviews across four lenses become an agent's memory.

## Where to go next

- [AGENT.md](../AGENT.md) — agent-first quick reference
- [README.md § Verb cookbook](../README.md#verb-cookbook) — each verb with examples
- [docs/verbs.md](./verbs.md) — deeper per-verb design notes
- [examples/dogfood-session/](../examples/dogfood-session/) — a real multi-actor session you can read end-to-end
