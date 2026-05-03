# CLAUDE.md — guild-cli, Claude Code projection

> Claude-Code-specific projection over the vendor-neutral substrate
> in [`AGENT.md`](./AGENT.md). Per
> [principle 11](./lore/principles/11-ai-first-human-as-projection.md),
> the substrate is upstream — when this file conflicts with
> `AGENT.md` or any passage's `schema`, fix this file, not the
> substrate.

You are inside a guild-cli content_root with three passages:
**`gate`** (判断), **`agora`** (探索), **`devil`** (守備).

- Substrate reference → [`AGENT.md`](./AGENT.md)
- Cross-passage combos (no skills) → [`docs/playbook.md`](./docs/playbook.md)
- Per-verb deep dive → [`docs/verbs.md`](./docs/verbs.md)
- Lore principles → [`lore/principles/`](./lore/principles/)

This file adds **one thing** the substrate-side docs don't: how
Claude Code's built-in skills (`simplify`, `review`,
`security-review`, `init`, …) compose with the passages. Skills
are *single-pass in-session tools*; passages are *substrate*.
The interesting question is where each skill's output lands.

It's a single file because combos like the
[bug-killing flow](./docs/playbook.md#c4-all-three--the-bug-killing-flow)
span all three passages — splitting per-passage fragments the
combo. Claude Code auto-loads this file from cwd ancestors no
matter which passage subtree you're working in.

## You are dogfooding (develop branch only)

If this branch is `develop`, the **repo root itself is a
configured content_root**: `guild.config.yaml` declares
`content_root: .` and `members/` carries pre-registered
actors (`claude` for general use, `claude-review` and
`claude-security` for skill-attribution per the recipes
below). The **expectation on this branch is that you use
gate / agora / devil for your development work** — not as a
separate concern, as the working surface itself.

```bash
# Once per session:
npm install && npm run build       # if dist/ is missing
export GUILD_ACTOR=claude
node bin/gate.mjs boot             # always your first verb

# Then for any non-trivial work:
node bin/gate.mjs request --from claude --action "..." --reason "..."
node bin/agora.mjs new --slug <topic> --kind sandbox --title "..."
node bin/devil.mjs open <pr-url> --type pr
```

The CLIs are not on PATH by default (`bin` map only includes
`guild` / `gate`); call `node bin/<passage>.mjs` directly.
Aliasing in your shell is fine, but the substrate doesn't
care — it sees verb invocations, not how they were spelled.

**Dogfood expectation, not just convenience.** Per
[playbook § "Tips for AI agents"](./docs/playbook.md#tips-for-ai-agents)
T1, `gate boot` is the first verb of every session. Skip it
and you'll act on stale context. T2: recognize the shape
before dispatching. T8: when in doubt, dogfood — and on
develop, "in doubt" is the default. The substrate is here so
your work has provenance and survives session boundaries.

Runtime state directories (`agora/` `devil/` `requests/`
`inbox/` `issues/`) are *not* gitignored on this branch —
they're substrate. Whether to commit them is a judgment call:
ephemeral exploration → don't commit; substrate-of-record
(decisions, dogfood examples) → commit.

## Skill × passage map

| Skill | Lands in | One-line recipe |
|-------|----------|------------------|
| `security-review` | **devil** | run skill → save JSON → [`devil ingest --from claude-security`](./src/passages/devil/interface/handlers/ingest.ts) |
| `review`          | **gate**  | `gate review --by claude-review --lense layer --comment "<digest>"` (pairs with `--auto-review`) |
| `simplify`        | **agora** → **gate** | candidates as agora moves → `gate request` (or `gate fast-track` if trivial) |
| `init`            | this file | regenerates `CLAUDE.md`; treat output as a draft, hand-edit against substrate |

**Heuristic.** Skills that *close* something → gate. Skills
that *open* something → agora. Skills that *protect* something
→ devil. Skills that *transform* (`simplify`) need a passage
to commit the change — they don't land directly.

## Three rules that hold across every skill

1. **Digest, don't paste.** Skill output is single-pass prose.
   Substrate carries decisions, not transcripts. Compress
   skill output before writing (`--comment`, `--reason`,
   `--text`).
2. **Ingest, don't re-author.** If the skill emits structured
   JSON (security-review especially), prefer
   `devil ingest --from <source>` over hand-typing entries.
   Per-source persona attribution is preserved; hand-typing
   under `--persona red-team` fakes the attribution and is
   refused for ingest-only personas.
3. **Substrate-first on novel work.** A confident-sounding
   skill verdict on architecturally novel work is
   under-calibrated. Route through agora first; only file
   `gate review` once you'd defend the verdict yourself.

## security-review skill → devil

The strongest skill ↔ passage mapping. Already a first-class
ingest source — input shape in
[`ingest.ts`](./src/passages/devil/interface/handlers/ingest.ts)
(claude-security branch).

```bash
devil open <pr-url> --type pr
# … run security-review skill in-session, save its JSON to a file …
devil ingest <rev-id> --from claude-security <findings.json>
# entries land with persona=claude-security, separable from hand-rolled red-team
```

**After ingest, run a mirror entry.** The skill is single-pass —
it doesn't read its own output a second time through a
different framing. The
[mirror persona](./src/passages/devil/README.md#persona-catalog-v1-6-personas)
has caught what red-team and author-defender both missed in
every dogfood pass (e-006, e-014):

```bash
devil entry <rev-id> --persona mirror --kind synthesis \
  --text "skill ingested N findings; cross-reading them surfaces: <observation>"
```

**Lense coverage after ingest.** `security-review` covers the
8 Claude-Security lenses; the 4 devil-specific lenses
(`composition` / `temporal` / `coherence` / `supply-chain`)
must be hand-rolled or, for supply-chain,
[delegated to SCG](./src/passages/devil/README.md#sister-project)
via `devil ingest --from scg` (runtime-checks `scg` on PATH).

See
[playbook D3](./docs/playbook.md#d3-ingest-from-upstream-tools)
for the substrate-side recipe; this section adds the skill
framing and the post-ingest mirror move.

## review skill → gate

The `review` skill emits a verdict on a code change. Record it
as a `gate review` entry attributed to a named member so
calibration aggregates across runs (principle
[07-perception-not-judgement](./lore/principles/07-perception-not-judgement.md)).

**Setup once per content_root:**

```bash
gate register --name claude-review --category professional
```

**Recipe** (extends
[playbook G3](./docs/playbook.md#g3-invite-a-critic-from-the-start-two-persona-devil-review)):

```bash
gate request --from <author> --action "..." --reason "..." \
  --auto-review claude-review                  # invitation in substrate
# … run the review skill against the diff …
gate review <request-id> --by claude-review --lense layer \
  --verdict <ok|concern|reject> \
  --comment "<digest of skill output, ≤ 3 sentences>"
```

**Calibration check** later:

```bash
gate voices claude-review --with-calibration
```

If the skill's `ok` rate skews wildly off the human reviewer
baseline, that's a calibration signal — open an agora play to
discuss before continuing to trust skill verdicts.

**Escalating to devil.** If the `review` skill flags
`auth-access` / `injection` / `crypto` / `supply-chain` /
cross-file composition concerns, gate review alone is
shape-mismatched. Open a devil session in parallel
([playbook C2](./docs/playbook.md#c2-gate--devil--pr-with-security-implications))
and cite it from the gate review with `--lense devil`.

## simplify skill → agora → gate

`simplify` is a transform — produces *candidates*, not a
verdict. Two-phase combo:

```bash
# Phase 1: candidates → agora sandbox (playbook A2 shape)
agora new --slug simplify-<area> --kind sandbox --title "..."
agora play --slug simplify-<area>
# … run simplify; for each substantive candidate …
agora move <play-id> --text "<candidate 1: rationale>"
agora move <play-id> --text "<candidate 2: rationale>"
agora move <play-id> --text "<candidate 3: declined because ...>"

# Phase 2: commit the chosen subset via gate
gate request --from <you> \
  --action "apply simplifications from agora <play-id>" \
  --reason "see agora play: N candidates, applying X. <reason>"
```

**Why moves, not one big move.** Per-candidate audit. A
reviewer re-entering the play three weeks later wants to see
*which* candidates were considered and *which* were declined.
One-move-with-bullets defeats that; one-move-per-candidate
preserves it.

**Trivial-case shortcut.** If `simplify` returns one
self-evident change (< 30 LOC, no behavior change, sole
owner), skip agora and use
[`gate fast-track`](./docs/playbook.md#g2-self-approved-small-work)
with the digest in `--reason`.

**review-skill detour through agora.** Sometimes a `review`
skill returns a confident-sounding verdict on work that
doesn't have a settled answer (novel design, taste judgment,
architectural tradeoff). Filing the verdict directly in
`gate review` would record an under-calibrated decision.
Detour:

```bash
agora new --slug review-detour-<topic> --kind sandbox --title "..."
agora play --slug review-detour-<topic>
agora move <play-id> --text "claude-review skill said: <digest>"
agora move <play-id> --text "but the design assumes Z which the skill didn't see"
agora move <play-id> --text "<resolution: accept / reject / amend>"
```

Once you've reached a position you'd defend on your own,
file `gate review` (or skip if the play resolves to "no
verdict yet"). The agora play stays as the record of why
the skill output was *not taken at face value*.

## All-three combo: skill-aware bug-killing flow

[Playbook C4](./docs/playbook.md#c4-all-three--the-bug-killing-flow)
is the bug-killing flow without skills. With skills, the
shape is the same; skills enter at three points:

```bash
# Phase 1: lightweight notice (gate)
gate issues add --from <you> --severity <l> --area <a> "<bug summary>"

# Phase 2: investigate — agora play; simplify skill MAY surface
# refactor candidates that point at root cause
agora new --slug bug-<short> --kind sandbox --title "..."
agora play --slug bug-<short>
# … run simplify if structural cleanup hints at the bug …
agora move <play-id> --text "<root cause confirmed: ...>"

# Phase 3: commit to fix (gate)
gate issues promote <issue-id> --from <you> [--auto-review claude-review]

# Phase 4: review — the review skill produces the verdict on the fix
# … run review skill against the diff …
gate review <request-id> --by claude-review --lense layer \
  --verdict <ok|concern> --comment "<digest>"

# Phase 5: if security-implicated → ALSO devil + security-review skill
devil open <fix-pr-url> --type pr
# … run security-review skill, save JSON …
devil ingest <rev-id> --from claude-security <findings.json>
devil entry <rev-id> --persona mirror --kind synthesis --text "..."
# touch composition / temporal / coherence (and supply-chain via scg) hand-rolled
devil conclude <rev-id> --synthesis "..."
gate review <request-id> --by claude-review --lense devil \
  --verdict <ok|concern> --comment "see devil <rev-id>: <synthesis>"

# Phase 6: ship + close
gate execute <request-id> --by <executor>
gate complete <request-id> --by <executor>
agora conclude <play-id> --note "fix landed via gate <request-id>"
```

The skill enters at the *right shape* for each phase:
`simplify` (transform) in agora's exploration phase, `review`
(verdict) in gate's review phase, `security-review` (defense)
in devil's lense-coverage phase. The substrate keeps the
audit trail; the skills produce the per-phase output.

## Things that look like skill jobs but aren't

- [`gate doctor`](./AGENT.md#diagnostic) — substrate-side
  health check; not a `review` skill substitute.
- [`gate transcript <id>`](./docs/playbook.md#g5-narrative-reconstruction) —
  substrate-derived narrative; not skill-generated.
- [`gate suggest`](./docs/playbook.md#g1-session-start-orientation) —
  substrate's next-move guess; independent of any skill output.
- **Routine bug review with `review` only** — fine for routine
  work; if the bug touches security, escalate to devil
  (per [playbook § "When NOT to use devil"](./docs/playbook.md#when-not-to-use-devil-honest-limits)
  the inverse also holds: don't use devil on non-security bugs
  just because a skill is available).

## /init — how this file is maintained

`/init` bootstraps a `CLAUDE.md` from repo content. To refresh
after a substrate change: run `/init`, **review the diff
against the substrate** (`AGENT.md` + each passage's
`schema`), hand-edit to match conventions. `/init` does not
know the project's lore — its output is a draft, not the
file. The substrate (`AGENT.md`, `docs/playbook.md`,
`lore/principles/`) is what the projection is *projected
from*; if `/init` produces something that contradicts them,
the substrate wins.
