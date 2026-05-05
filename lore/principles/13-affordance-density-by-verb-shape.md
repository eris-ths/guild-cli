# Affordance density follows verb shape

**The text-mode `next:` hint after a successful verb is not a
universal courtesy. It is an affordance whose presence depends on
the verb's *shape*. Bootstrap and boundary verbs emit it; flow
verbs do not. Lifecycle verbs leave it to the JSON envelope.
This principle names the four shapes, the rule that follows from
them, and the cost of getting it wrong (which the touch-feel
campaign of 2026-05-04 → 2026-05-05 paid in full).**

## Statement

Earlier principles (03 legibility-costs, 09 orientation-
disclosure) establish that every line of CLI output costs reader
attention and that the substrate must disclose itself enough for
a fresh agent to operate. This principle names *when* a
specific kind of disclosure — the trailing `next: …` line in
text mode — helps and when it harms.

There are four verb shapes in guild-cli. Each calls for a
different next-hint discipline.

### The four shapes

| Shape | What the verb does | Hint discipline |
|-------|--------------------|-----------------|
| **Lifecycle** | Transitions an aggregate through a deliberation chain (each step is its own decision point) | **Text emits no hint.** JSON `suggested_next` carries the next verb for orchestrators. Humans read the lifecycle by name (`pending → approved → executing → completed`). |
| **Bootstrap** | Creates a thing for the first time; the next call is named, obvious, and rarely re-issued | **Text emits the hint once.** The actor just made a thing and naturally asks "what now?" — naming the next verb saves a `--help` round-trip. |
| **Boundary** | Closes one shape and opens another (suspend, resume, conclude) | **Text emits the hint** to bridge between shapes. After `suspend`, the next move is `resume` or another verb in a different shape. The hint is not redundant with prior hints because the surrounding context just changed. |
| **Flow** | Same call shape repeats N times within a session (move, entry, record) | **Text emits no hint.** The hint after the second call would be verbatim identical to the first; printing it again is noise that breaks immersion in the work being done. |

Examples by passage:

- **gate**:
  - lifecycle → `request` / `approve` / `execute` / `complete` / `fail` (text quiet, JSON `suggested_next`)
  - bootstrap → `register`, `boot` (text shows next verb)
  - boundary → `fast-track` (one-shot lifecycle), `suggest` (orientation primitive)
  - flow → `review` (when many reviews accrete to one request), `tail` (read-only)

- **agora**:
  - bootstrap → `new`, `play` (text shows the obvious next verb)
  - boundary → `suspend` (→ resume), `resume` (→ move/suspend), `conclude` (terminal)
  - flow → `move` (silenced 2026-05-05 per #170, #177)
  - read → `last`, `cliff`, `list`, `show` (no hint; pure read affordance)

- **devil**:
  - bootstrap → `open` (text shows next verb)
  - boundary → `conclude`, `suspend`, `resume`
  - flow → `entry`, `ingest` (each entry is a finding worth thinking about, but the *call shape* repeats — the hint would say the same thing every time)

- **ctx**:
  - flow → `record` (the only verb shipped in phase 1; subsequent record calls don't need a "now run gate boot to verify" line on call N+1 once the actor has seen it on call 1)

- **guild**:
  - bootstrap → `new` (creates a member; next is to register or use)
  - read → `list`, `show`, `validate` (no hint)

### The rule that follows

> The text-mode `next:` hint after a successful verb is emitted
> when the verb shape is **bootstrap** or **boundary**, and
> suppressed when the verb shape is **flow** or **lifecycle**.
> JSON `suggested_next` is independent of this discipline and is
> always populated when the next verb is knowable (or `null` when
> it is not).

### Why the JSON envelope is exempt

JSON output is consumed by orchestrators that branch on
`suggested_next.verb` and dispatch the next call automatically.
For an orchestrator, the cost of one extra serialised key per
call is structurally zero. The "noise after the second call"
problem only exists in the **text projection**, where a human
reader is parsing prose visually and the same line appearing
N times *does* compound.

This is principle 11 (AI-first, human as projection) refining
itself: the substrate (JSON) carries the affordance unconditionally;
the projection (text) carries it conditionally.

### Why "verbatim repeat" decides

The repetition test is a sharper rule than the four-shape
categorisation: *if calling the verb a second time would emit a
next-hint identical to the first, that hint is noise after call 1.*

The four-shape table is the operational approximation. Most
flow verbs emit a verbatim-repeat hint; most bootstrap/boundary
verbs do not. When a verb sits between categories (as `devil
entry` does — flow-shaped but each entry is a deliberation
point), the verbatim-repeat test resolves the ambiguity:
`devil entry`'s hint after entry N+1 would be the same as after
entry 1, so it is silenced under this principle.

### The cost of getting it wrong

The touch-feel campaign (2026-05-04 → 2026-05-05; PRs #163,
#164, #167, #169, #170, #173, #174, #177, #179) paid this cost
in real time. A reviewer of the post-#174 dogfood put it
sharply (issue #176):

> moveを打つたびに「次はmove or suspend」が応答に出る。AIには有用、
> でも人間が書く流れに乗ってる時、視界に毎回チラつく。**没入を守る
> 設計のはずが、UI出力が没入を邪魔する瞬間がある。矛盾してる。**

The same affordance that helps gate (lifecycle / deliberation)
hurt agora move (flow / immersion). The principle named here
is the rule that would have prevented the drift in the first
place: **affordance density follows verb shape; not verb
preference, not author habit.**

### Edge cases this principle does not resolve

- **Read verbs** (`gate tail`, `agora list`, `agora show`, `agora last`,
  `agora cliff`, `guild list`, etc.) emit no hint regardless of shape.
  Read verbs answer a question and exit; the actor's next move
  depends on the answer, not on the verb. Treat them as outside
  the four-shape table.
- **Diagnostic verbs** (`gate doctor`, `gate boot`, `gate suggest`,
  `gate whoami`, etc.) emit no hint either; their output *is* the
  affordance.
- **`gate suggest`** itself is the meta-affordance — its entire
  output is `suggested_next`. The principle here is consistent:
  the orchestration-tight-loop verb returns one structured payload,
  no decoration.

### Verb shape is a property of the verb, not the call

A verb's shape is fixed by its design, not inferred at runtime.
`agora move` is **flow** even on its first call in a play; the
text-mode hint is suppressed even when the actor has not yet
seen it. This is intentional: the verb's identity carries the
expectation, and a fresh actor reading `agora --help` sees the
next-step hint there. We do not inflate the success line to
double as documentation.

## Cross-passage application

This principle constrains all five CLIs (gate / guild / agora /
devil / ctx) symmetrically. A new verb in any passage must be
classified by shape and emit (or not emit) the text-mode hint
accordingly. The verb-shape categorisation is part of the
verb's design contract, sitting alongside its `KNOWN_FLAGS`,
its `--help` example, and its schema entry.

When in doubt: ask whether calling the verb twice in succession
would emit identical hint text. If yes → flow → suppress. If
no → bootstrap or boundary → emit.

## Related

- principle 03 (`legibility-costs.md`) — every line printed is
  a line read; this principle picks one specific class of line
  and disciplines its emission
- principle 09 (`orientation-disclosure.md`) — establishes that
  CLI output must orient enough for a fresh agent; this principle
  refines that to "orient *once*, not *every call*"
- principle 11 (`ai-first-human-as-projection.md`) — the JSON
  envelope is the substrate; the text is a projection. The
  next-hint rule is text-only because the substrate carries the
  affordance unconditionally.
- issue #176 — the design conversation that surfaced the
  observation; this principle is the answer
- PRs #170, #177, #179 — first three applications of the rule
  (drop hint from `gate list --state` error, from `agora move`
  success, from `agora last` / `agora cliff` reads)

## When to revise

When a fifth verb shape appears that doesn't fit lifecycle /
bootstrap / boundary / flow / read, this principle needs the
new shape named. The verbatim-repeat test remains the deeper
rule even then.
