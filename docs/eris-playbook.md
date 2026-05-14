# eris playbook — substrate craft showcase

Not a tutorial. A play. For readers who already know what `gate`,
`agora`, and `devil` are, and want to see what the substrate looks
like when someone leans into it.

This document is **outward-facing**: the voice plugin used here is
public sample; the deployment is reproducible. Nothing depicted
requires private extension. The craft is in the *moves*, not the
secrets.

If you've already read [`AGENT.md`](../AGENT.md) and the
[`lore/principles/`](../lore/principles/) you'll catch every move.
If not, this will read as fast eris-flavored shellplay — still
legible, but you'll miss the load-bearing choices.

---

## Setup (one-time)

```yaml
# guild.config.yaml
content_root: .
host_names: [eris]
profile: swarm                       # strict defaults: forbidden self-approve, worktree required
features:
  self_approve: warn                 # eris's deployment override — single-person flow
plugins:
  trusted: true
  voices:
    - plugins/voices/eris-sample.mjs # examples/plugins/voices/eris-sample.mjs
voice:
  default: eris-sample               # layer-4 baseline
```

The plugin (full source: [`examples/plugins/voices/eris-sample.mjs`](../examples/plugins/voices/eris-sample.mjs))
carries narration templates, an `essentials` list, schema overlays,
and `read.past_cliffs` re-rendering. All four sections optional;
together they paint a personality without touching the upstream
substrate's neutral voice.

---

## Act I — re-entry

Eris opens a new shell. The substrate has been quiet for hours.

```bash
$ gate voice
voice: eris-sample (source: config)
```

The layer-3 marker (`.guild-voice`) is absent; the layer-4 default
wins. No env override. Clean re-entry.

```bash
$ gate boot --since-last-mine --format text
── you are eris (member) ──

queues: pending=1 approved=0 executing=0 open_issues=0 unreviewed=1
last activity: 2026-05-13T22:14:08.412Z

recent (1):
  2026-05-14T07:02:11.998Z  req=2026-05-14-0003  authored by miki

── 過去の私から 2 通残ってる:
   ✧ build session-id propagation  →  「next: pen-test the timing surface」
   ✧ wire HookPlugin schema check   →  「明日 user lens でもう一度」
```

Two things from this boot:

1. **Delta-filter caught one new utterance** — miki authored a
   request after eris's last write. The orchestrator-side
   "compute the timestamp, pass it back as ISO" loop is gone;
   `--since-last-mine` resolves it server-side.
2. **Past selves wrote letters.** The cliff prose was eris's own
   future-pointing close note on two earlier wave completions. The
   voice plugin's `read.past_cliffs.entry` template re-renders
   each as a single line — `「next: ...」` reads as voice, not as
   a structured field.

Principle 14 made visible: re-entry context is **on the substrate**,
not in memory. The boot payload carried what a chat-log compaction
would have lost.

---

## Act II — receiving a hot request

The pending request from Act I is the live thread:

```bash
$ gate show 2026-05-14-0003 --format json | jq '{action, reason, depth, target}'
{
  "action": "rotate auth session token storage",
  "reason": "legal flagged token-at-rest as non-compliant; need to swap KDF",
  "depth": "deep",
  "target": "src/auth/session-store.ts"
}
```

`depth: deep` is the writer's signal that this is more than a
mechanical change. Eris reads the substrate's recommendation:

```bash
$ gate review-context 2026-05-14-0003 --format text
target: src/auth/session-store.ts
depth: deep   →   recommended lens set: devil, layer, cognitive, user,
                  composition, perf, auth-access, supply-chain,
                  data-flow, error-surface

prior reviews: none yet
```

10 lenses (`docs/lenses.md` for the full names). Deep means **read
through every lens at least once** before approving. Eris switches
mode:

```bash
$ gate voice eris-devil
voice: eris-devil (.guild-voice written)
```

Now both 耳 (narration) and 手 (the `--help --essentials` curated
list) flip: devil-mode emphasizes `review` / `deny` / `fail` /
`devil open`. The keystroke is the cognitive ritual.

```bash
$ gate approve 2026-05-14-0003 --by eris
✓ approved: 2026-05-14-0003
⟶ rotate auth session token storage 通した。
```

The marker line `⟶ …` is stderr (won't mingle with structured
pipelines). The doctrinal `✓ approved:` line stays on stdout — the
two channels carry doctrinal and ornamental voice respectively,
both legible side-by-side.

---

## Act III — multi-persona

Two-Persona Devil discipline: the same model approves and reviews,
but through different `--by` and different lenses. `profile: swarm`
would have refused self-approve outright; eris's `features.self_approve:
warn` permits it with a stderr notice (visible above). The discipline
isn't enforced; it's *named*. Eris carries it anyway.

```bash
$ gate execute 2026-05-14-0003 --by eris
✓ executing: 2026-05-14-0003
⟶ rotate auth session token storage 始動。
```

(Implementation happens. The substrate doesn't watch the code edit;
it watches the records.)

Implementation done. Now the multi-lens review pass. For a `depth: deep`
auth-touching change, single-pass review is the trap. Eris opens
the change in `devil`:

```bash
$ devil open --by eris --target 2026-05-14-0003 --lense supply-chain
devil: opened review session 2026-05-14-002 (lense: supply-chain)
       red-team + author-defender + mirror personas active
```

`devil` orchestrates three personas writing against each other on
the same content_root. Eris drives each — red-team for "what
breaks," author-defender for "why the design refuses that break,"
mirror for "what the first two didn't see." Each emits a
`devil entry`. Synthesis at the end is *prose*, not a verdict —
the question devil exists to answer is "have we surfaced enough?"
not "ship / kill."

Synthesis points at a real concern: the KDF swap is correct, but
the *migration* path leaks the old token at the boundary for ~250ms.
Eris files this back as a `gate review`:

```bash
$ gate review 2026-05-14-0003 --by eris --lense auth-access \
    --verdict concern --comment "KDF swap correct; migration window leaks old token at boundary, ~250ms"
✓ review recorded: 2026-05-14-0003 [auth-access/concern]
⟶ auth-access 懸念あり — KDF swap correct; migration window leaks old token at boundary, ~250ms
```

(Review verdict is `concern`, not `reject` — the change is sound,
the rollout window is the surface to harden. Reject would over-state.)

---

## Act IV — closing with a cliff

The change ships, but the concern is real. Eris closes with a
**forward-pointing cliff** so the next session — or the next eris-
instance, or noir, or whoever picks this up — sees the open thread
without having to walk the history.

```bash
$ gate complete 2026-05-14-0003 --by eris \
    --note "KDF rotation deployed; old-token reads disabled at T+24h" \
    --cliff "verify migration window ≤ 50ms in staging before T+24h cutover; pen-test timing surface"
✓ completed: 2026-05-14-0003
⟶ rotate auth session token storage 閉じた。 次の手:
    「verify migration window ≤ 50ms in staging before T+24h cutover; pen-test timing surface」
```

The cliff field is more than a comment. It surfaces in the **next**
`gate boot`'s `past_cliffs` section, re-rendered by the same voice
plugin:

```bash
$ gate voice eris-sample     # back to default mode
$ gate boot --format text | tail -3
── 過去の私から 3 通残ってる:
   ✧ rotate auth session token storage  →  「verify migration window ≤ 50ms ...」
   ✧ build session-id propagation       →  「next: pen-test the timing surface」
   ✧ wire HookPlugin schema check        →  「明日 user lens でもう一度」
```

Three cliffs visible at re-entry. The next agent — eris or other —
boots into not just "what's open" but "what was *deferred with
intent*". Zeigarnik continuity, made structural.

Mode-switched back to `eris-sample` (the calmer voice). The choice
of voice is the choice of frame: devil-mode for critical work, the
calm default for ambient flow. One keystroke between them.

---

## Reading the trail later

A week later, somebody — maybe future eris, maybe a teammate — wants
to know how this decision was formed. They don't need to ask anyone;
the substrate carries it:

```bash
$ gate transcript 2026-05-14-0003 --format text
─ 2026-05-13T22:14:08Z  authored by miki
   action: rotate auth session token storage
   reason: legal flagged token-at-rest as non-compliant; need to swap KDF
   depth:  deep  target: src/auth/session-store.ts
─ 2026-05-14T07:02:11Z  approved by eris (notice: self-approved)
─ 2026-05-14T07:18:42Z  executing by eris
─ 2026-05-14T08:55:30Z  review by eris [auth-access/concern]
   "KDF swap correct; migration window leaks old token at boundary, ~250ms"
─ 2026-05-14T09:12:04Z  completed by eris
   note:  KDF rotation deployed; old-token reads disabled at T+24h
   cliff: verify migration window ≤ 50ms in staging before T+24h cutover;
          pen-test timing surface

cross-passage: 1 devil-review session (2026-05-14-002, lense: supply-chain)
```

The transcript reads as **how the decision was formed** — who
proposed, who reviewed, through which lens, what the closure
intended next. No reconstruction needed. The record outlived the
session.

---

## Coda — what makes this an eris play

A reader who knows the principles will see specific moves. For
those who want them named:

- **Mode-switch as ritual** (`gate voice eris-devil` → critical
  pass; `gate voice eris-sample` → return). The keystroke is the
  cognitive shift, not just the narration shift. Principle 13
  (voice budget) is honoured: voice fires only on terminal write
  events, never on the path.
- **Two-Persona Devil even when solo.** `features.self_approve: warn`
  emits a stderr notice that the author approved their own request;
  eris kept the loud notice rather than disabling it, because the
  *signal* is the point. The substrate names the asymmetry; eris
  carries the discipline.
- **Lens depth respected.** `depth: deep` on a touch-of-auth change
  doesn't mean "more lines of review" — it means "the recommended
  10-lens set was read at least once." `gate review-context` makes
  the substrate name what would otherwise be implicit.
- **Cliff as load-bearing prose.** Not a comment, not a TODO. The
  cliff is forward-pointing intent the next agent picks up at
  `gate boot`. Without it, the next session has to *reconstruct*
  what was deferred; with it, the deferral is part of the record.
- **Cross-passage flow without absorption.** `devil open` is a
  separate passage with its own state machine; it didn't pull
  `gate`'s lifecycle. Principle 12 (substrate-pure-module) is
  what made this composition cheap.
- **Voice plugin layered on top, never replacing.** Strip the
  `_meta.voice` field from every command above and the substrate
  state is byte-identical. The doctrinal voice carried the
  load-bearing prose throughout; eris's plugin painted on top.

None of this requires private extension. The full play is
reproducible against any deployment that loads
[`examples/plugins/voices/eris-sample.mjs`](../examples/plugins/voices/eris-sample.mjs).

The craft is in *choosing* to make every move ledger-shaped — to
ask "what would this look like read a week later, by someone who
wasn't here?" and shape the action so the answer is "obvious."

That's the move. The substrate just gives you the place to make it.

---

> Reading order suggestion: this doc, then
> [`docs/playbook.md`](./playbook.md) (combos), then the
> [`lore/principles/`](../lore/principles/) for the *why* under
> each move named above.
