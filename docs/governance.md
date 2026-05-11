# Governance — surfaces, scopes, write-gating

This doc names **which coordination surface holds which kind of
artifact** and **who can write to each**. The goal is signal
preservation: each surface stays read-worthy because only its
intended content lands there.

The five surfaces guild-cli uses, in increasing distance from code:

| Surface | Holds | Write gating |
|---------|-------|--------------|
| `substrate/` (local-only, gitignored) | dogfood arcs, swarm coordination records, session-local agora plays | machine-local writer |
| substrate-under-`requests/` `agora/` `devil/` `ctx/` (tracked) | production lifecycle records | content_root contributors |
| GitHub Issues | scoped, close-driven design tensions and bug reports | repo collaborators |
| GitHub Pull Requests | per-change code review + merged decision trail | repo collaborators |
| GitHub Discussions | announcements + extracted-pattern retrospectives | repo collaborators only (write); public read |

> Contributors may additionally keep harness-side memo files (devil-shaped
> trap notes, persona-shaped checklists, etc.) inside their own AI tooling
> — Claude Code's per-agent memory, Codex's profile config, etc. Those are
> **off-substrate by design** and not part of project governance; this doc
> covers only the five surfaces above. The harness side is the maintainer's
> private practice; the substrate side is the project's record.

`lore/principles/` and `docs/` are not coordination surfaces — they
are **stewardship outputs** that get rewritten when their content
needs revision. Append-only is the spirit, but a principle doc can
be edited if the principle's wording was wrong.

## GitHub Discussions (enabled 2026-05-11)

Discussions were enabled on the repo with the deliberate posture
that they are **NOT** a general help forum. The repo is public; the
project is at alpha (0.x); there are no external contributors yet.
Discussions exist for two narrow purposes:

### Category 1: Announcements

- Release notes (when each minor cuts)
- Principle additions to `lore/principles/`
- Major design pivots (e.g. when a phase of #36 closes or when a
  passage's shape changes)
- Cross-module ecosystem updates (yori-code, projector, atelier
  interaction notes that matter for guild-cli consumers)

CHANGELOG carries the operational diff per release; Announcements
carries the framing for readers who don't read every CHANGELOG entry.

### Category 2: Retrospectives

- Dogfood arcs that produced a load-bearing learning worth
  publishing (e.g. the 2026-05-11 combo-C3-to-principle-14 loop —
  see `docs/retrospectives/2026-05-11-substrate-engagement-loop.md`)
- Extracted design patterns that surfaced across multiple issues
  (e.g. if "wave-element composition rules" recurs in #294 + a
  future devil-side parallel-review issue, the recurring shape gets
  named in a Retrospective rather than re-debated per-issue)
- Cross-instance reflection threads — two Claude instances or
  nao + Claude doing a postmortem on a multi-PR arc

### Categories explicitly NOT used

The defaults that GitHub auto-created on enable should be **archived
or removed via web UI** (no public mutation in the GraphQL API for
this — manual cleanup required):

- General — collapses into "everything goes here," exactly the
  signal-rot pattern this gating exists to prevent.
- Ideas — feature requests belong as Issues, not Discussions; if
  closed without ship, the trigger conditions live in
  `trap_dogfood_deferred_open_rot.md`.
- Polls — no use case.
- Q&A — no external users yet; if one arrives, file an Issue.
- Show and tell — Retrospectives covers the shape; "show and tell"
  invites noise.

### Write gating

Per repo settings: **Discussion creation is restricted to repo
collaborators** (currently nao-amj + eris-ths). Public users can
read; only the authenticated AI + human pair authoring this repo
can write. This is intentional given the alpha stage; revisit when
external contributors arrive.

## When to reach for which surface

Cheat-sheet for the AI agents (and humans) who write into this repo:

| Kind of artifact | Surface |
|---|---|
| Bug report with a specific fix proposal | Issue |
| Design pass tied to one shipable feature | Issue (with `design` label) |
| Long-running tension not bound to one issue | `docs/domain-fit/open-questions.md` entry + maybe Discussion if pattern-shaped |
| Per-change review discussion | PR comments |
| Cross-PR retrospective (multi-day arc) | Retrospective doc + Discussions/Retrospectives |
| Release announcement | CHANGELOG + Discussions/Announcements |
| Session-local dogfood arc | `substrate/agora/plays/` (local-only) |
| Production lifecycle record | content_root `requests/` `agora/` etc. |
| Principle-level claim | `lore/principles/` + Discussions/Announcements |

## Why this exists

Open backlog signal decays when surfaces absorb artifacts they
weren't shaped for. The pattern surfaced during the 2026-05-10
backlog triage (see
[`docs/retrospectives/2026-05-11-substrate-engagement-loop.md`](retrospectives/2026-05-11-substrate-engagement-loop.md)
§ "Step 2"): single-session evidence + open-with-trigger-waited
issues rot the open backlog read-worthiness in 1-3 cycles. The
operational rule that came out — close+memo-pin as default,
open is the exception — applies across all surfaces, not just
Issues.

Per [`principle 14`](../lore/principles/14-substrate-engagement-reduces-coordination-context-cost.md),
the substrate is record; everything else is testimony. Each
surface above is a record-shape; gating writes by intent keeps
each surface readable months later.

Append-only in spirit, like the records the tool produces.
