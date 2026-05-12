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

## Four passages, four shapes of work

Guild has four passages on top of one shared substrate. Each
passage holds a different **shape** of agent activity:

- **`gate` — 判断 (judgment).** "Decide on a request." Verdict-shaped:
  approve / deny / review with `ok | concern | reject`. Lifecycle bounded.
- **`agora` — 探索 (exploration).** "Stay with a thought." Verdict-less:
  Quest and Sandbox plays, suspend/resume cliffs, moves accumulating.
- **`devil` — 守備 (defense).** "Protect end-users." Floor-shaped:
  multi-persona, lense-enforced, friction is the feature.
- **`ctx` — 事実 (fact).** "Pin an observation." Verdict-less,
  thread-less, target-less append. Phase 1 ships only `record`;
  more verbs (fork / supersede / show / list / chain / status)
  arrive in phase 2 as the use surface fills in.

If you're new to guild-cli, start with `gate` — the rest of this
document is gate-rooted. The other three passages have their own
sections in [`AGENT.md`](../AGENT.md) and worked examples in
[`docs/verbs.md`](./verbs.md).

## Coming from another tool?

| You used… | Closest guild-cli concept | Key difference |
|-----------|--------------------------|----------------|
| **Jira / Linear** (issues + assignees) | `request` has `executors` like assignees, `state` like status | `request` also carries multi-lense `review`s and forced `reason`; it's closer to an ADR + ticket fused together. Multiple executors are first-class — see [#230](https://github.com/eris-ths/guild-cli/issues/230) for parallel-impl waves. |
| **`issues` in guild-cli** | `issue` | In guild-cli, `issue` is a lightweight observation that hasn't become a decision yet. Promote it to a `request` when someone commits to act. |
| **GitHub pull request review** | `gate review --lense X --verdict Y` | Reviews in gate attach to *requests* (decisions), not diffs. Multiple reviewers can each apply different lenses to the same request. (`lense` is the project's spelling — see vocabulary below.) |
| **Slack / Discord DM** | `gate message --from A --to B` | Push-based messaging with an `inbox`, same channel as the decision log — you can DM about a specific `request` and the reference persists. |
| **ADR** (architecture decision record) | `request` + `reason` + `review`s | Same spirit, but *alive*: reviews and messages keep accruing after the decision is made. |
| **Standup / retro notes** | `gate tail` / `gate voices <actor>` | Replay the content_root's dialogue, filtered by actor or lense, instead of scrolling chat history. |
| **GitHub `/ultrareview` / Anthropic Claude Security** (single-pass model security review) | `devil open <ref> --type <pr\|file\|...>` + `devil entry / ingest` | Devil-review is a **persistent, multi-persona substrate** that one-shot tools' findings flow into. It does not replace the scanner — it holds the deliberation around findings (red-team / author-defender / mirror personas, lense-by-lense), and keeps the dismissal trail honest. See [issue #126](https://github.com/eris-ths/guild-cli/issues/126). |

## Quick vocabulary

- **actor** — a human or AI agent. Has a `MemberName` (lowercase ASCII) and lives as `members/<name>.yaml`.
- **host** — an actor that runs the content_root (not a member, but can `--by` / `--from` anything). Listed under `host_names:` in `guild.config.yaml`.
- **request** — a decision-in-motion. Has `action`, `reason`, optional `executors` (one or more) / `auto-review`, and moves through `pending → approved → executing → completed` (or `denied` / `failed`). Even single-actor requests use the plural `executors:` field for uniformity — same shape across single and parallel waves means downstream tools never branch on arity. See [#230](https://github.com/eris-ths/guild-cli/issues/230) for the attribution rationale.
- **review** — multi-perspective feedback on a request. Carries a `lense` (one of `devil | layer | cognitive | user` by default — extend via config) and a `verdict` (`ok | concern | reject`).
- **lense** — the angle a reviewer is taking. (Spelled with a trailing `e` throughout this project — the value object, the CLI flag, and prose all align.) `devil` = "what breaks?", `layer` = "which structural layer is this on?", `cognitive` = "where would someone hesitate?", `user` = "whose happiness (LDD)?". Add domain lenses (`security`, `perf`, `a11y`, ...) in `guild.config.yaml`'s `lenses:` list, or — for the devil-side catalog — drop one YAML file per custom lense under `<content_root>/devil/lenses/<name>.yaml` (see #134 G).
  - **gate vs devil enforcement.** Gate review's allowed-lense set comes from `guild.config.yaml`'s `lenses:` list by default — host project picks the vocabulary. Devil's `devil entry` requires a name from a strict bundled catalog (12 lenses in v1, see `docs/verbs.md` § Lenses) merged with content_root extensions. Same word, different enforcement: gate's lense is a label the team agrees on; devil's lense is a covered axis of the security-knowledge floor.
  - **strict mode (#134 H2, opt-in).** Set `gate.strict_lenses: true` in `guild.config.yaml` to flip gate review's allowed-lense set from `lenses:` over to the unified devil catalog (bundled defaults + `<content_root>/devil/lenses/*.yaml` extensions). Default is permanently `false` — each team picks its own enforcement timing; we never auto-flip. Coverage gating stays devil-side.
- **verdict** — `ok` (landed cleanly), `concern` (lives with the decision but you want it named), `reject` (don't do this). The word is deliberately soft — `concern` is usable, not a veto.
- **fast-track** — single-actor shortcut for the full lifecycle when self-approved work is appropriate. Still requires `reason`; `review`s can be attached after.
- **issue** — a standalone observation that has not yet become a decision. Lightweight, optional `severity` / `area`. Promote to `request` via `gate issues promote <id>`.
- **pair-mode (`--with`)** — records who you were thinking with when you shaped a request. Surfaces in `show`, `voices`, and `resume` prose ("shaped with eris").
- **content_root** — the YAML directory gate reads from. Contains `members/`, `requests/`, `issues/`, `inbox/`, and `guild.config.yaml`. Git it for history. See AGENT.md § File layout.

## The 30-second first touch

```bash
# 1. Register yourself. One command, no YAML hand-authoring.
gate register --name <you>

# 2. Start a session.
export GUILD_ACTOR=<you>
gate boot

# 3. Record your first decision (single-actor, self-approved lane).
gate fast-track --from <you> --action "first-touch" \
  --reason "getting oriented" --executors <you>
```

That's enough to exist in the content_root. Everything below is
what unlocks as you keep using it.

## Core loop

```
observe → file an issue (maybe) → decide → file a request
   ↓                                          ↓
   ────── promote to request ─────────►  approve → execute → complete
                                              ↓         ↓         ↓
                                          review ←── review ←── review
                                         (devil) (layer) (cognitive) (user)
```

## When more than one actor is implementing

Most requests have one executor. Some don't — a parallel-impl wave
splits work across `src` and `docs` (or any two file-disjoint
scopes) so two agents can move at the same time without stepping
on each other. Use `--executors a,b` to record both at request
time; `gate list --executor <name>` matches if `<name>` appears
anywhere in the array. The point isn't scheduling — it's keeping
*who actually did what* legible afterward, so reviews and devil
findings can be addressed back to the right hands. Single-actor
waves still write the same shape (`executors: [you]`); the
uniformity is the feature.

## The one thing most newcomers miss

guild-cli is **not** trying to *automate* the decision. It's trying
to make the decision and its dialogue **legible later** — to you,
to another agent, to the next session of the same agent. The value
compounds: one `fast-track` with one review is fine, ten sessions
of accrued reviews across the four lenses become an agent's memory.

## Reading your own substrate back

Once you've left a trail, a small family of read verbs lets you ask
the substrate questions about *yourself*. Each defaults to the
calling actor (`GUILD_ACTOR`) so the bare invocation is the
common-case answer:

- `gate decisions` — what state transitions did I author recently
  (approve / deny / execute / complete / fail)?
- `gate self-pattern` — what does my pattern look like? decision
  counts, review verdict ratio, top lense, `approve_rate`, `ok_rate`.
  For the full lense breakdown the verb hints at the next one.
- `gate lense-stats` — review entries per lense in a window. Surface
  bias: "I keep hitting `auth-access`; have I run `composition` or
  `devil` lately?"
- `gate transcript <id>` — narrative arc of one request, prose + JSON.
- `gate voices <name>` — every utterance an actor has made,
  filterable by lense and verdict.

These read verbs aren't part of the core loop above — that loop is
about *writing*. Reading your own substrate is the other half of
"legible later." Reach for them when re-entering a session, when a
review feels off, or when you suspect your own bias is hardening.

## Where to go next

The documentation is layered. **Stop at whichever layer is enough for what you're doing** — depth isn't hidden value, it's scaffolding for when your use case grows.

| Next step | File | Time |
|-----------|------|------|
| You're an AI agent about to run `gate` | [AGENT.md](../AGENT.md) | 10 min |
| You want **combos**: how to use gate + agora + devil together, with the bug-killing recipe | [docs/playbook.md](./playbook.md) | 15 min |
| You want the design's load-bearing ideas, named | [lore/principles/](../lore/principles/) | 5–10 min |
| You want the entrance + how-to-install | [README.md](../README.md) | 5 min |
| You want to see a real multi-actor session | [examples/dogfood-session/](../examples/dogfood-session/) | 15 min |
| You want deeper per-verb notes and surprises | [docs/verbs.md](./verbs.md) | 1 hour |
| You're embedding guild-cli as a library | [POLICY.md](./POLICY.md) (stable surface) | when needed |
| You're operating it in a sensitive context | [SECURITY.md](../SECURITY.md) (threat model) | when needed |

A 30-second pitch plus one `gate boot` is often enough to start being productive. The rest is available when the moment calls for it.
