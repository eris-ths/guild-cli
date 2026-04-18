# Open questions

Design tensions the domain tour surfaced but didn't resolve.
Kept visible so the conversation stays accessible across sessions.

Each question has:

- **The tension** — what makes it an open question rather than a
  task.
- **Options explored** — what paths have been considered.
- **Current lean** — what feels right today, low confidence.
- **What would settle it** — evidence or test that could tip the
  decision.

## Q1. Story mode as a plugin — how deep?

**The tension**: Story domain partially fits gate but actively
fights two features: (a) the append-only wall-clock `status_log`
vs. the non-linear story time, and (b) no notion of "narrative
present vs. past." `fast-track` plus custom lenses cover maybe 80%;
the remaining 20% wants overlay metadata (chapter, beat-in-chapter,
POV, tense, draft state). Question: is that 20% worth building?

**Options explored** (layers, cheap to expensive):

- **Layer 0 — config-only conventions**. Document the "story
  convention for guild-cli" as a file in `examples/` showing
  custom lens set (reader / structure / voice / continuity),
  fast-track as the default verb, issues-as-foreshadowing. Zero
  new code. Gets 80%.

- **Layer 1 — companion CLI (`guild-cli-story` as a separate
  package)**. A `story` binary that reads gate's `content_root`,
  writes sidecar metadata (`story/scenes/<id>.yaml` with
  chapter/beat/POV/tense/draft-state), and provides story-time
  views (`story chapter 4`, `story arc mira-grief`). Doesn't
  touch gate. ~500 lines of new code, new package.

- **Layer 2 — `overlay_dir` hook in gate**. Minimal additive:
  `gate show <id>` reads a sidecar if configured, appends its
  fields. ~30 lines in gate. Only worth it if Layer 1 proves
  useful enough that making overlays visible in gate's own
  verbs matters.

**Current lean**: Layer 0, publish as `examples/story-convention.md`.
Layer 1 is genuine value but not worth building unless multiple
story-mode users show up. Layer 2 is always a later optimization.

**What would settle it**: two or three people independently trying
gate for serialized fiction and reporting whether the Layer 0
convention is livable or whether they hand-built the same overlay
structure anyway.

## Q2. State-machine aliasing — domain-specific vocab for transitions?

**The tension**: Custom lenses let the review vocabulary be
domain-specific (`rational / emotional / future-self / skeptic`
instead of `devil / layer / user / cognitive`). There's no
analogue for state-machine transition names. A meeting wants
"proposed / approved / in-progress / completed"; an incident
wants "detected / triaged / mitigating / resolved." The
underlying semantic is identical, but the labels aren't.

**Options explored**:

- **Do nothing**. The current names (`pending / approved /
  executing / completed`) are generic enough that domain users
  can mentally rename without confusion. No feature cost.

- **Config-driven aliases**. `guild.config.yaml` gains a
  `state_aliases:` key: `{ pending: "detected", approved:
  "triaged", … }`. Display-only; on disk the canonical name
  stays. Renders via aliases in `gate show` text format.

- **Full pluggable state machines**. Different state sets per
  domain. Probably a mistake — it breaks the "gate models
  deliberative work" thesis that makes the tool coherent.

**Current lean**: do nothing, maybe add one-sentence doc note
that the state names are conventional-but-generic. The meeting
and incident domains both worked with the default names; the
tour found no case where the naming was actively confusing.

**What would settle it**: a domain where the default names
positively mislead (user reads "executing" and infers "running
code" when they meant "in session"). Hasn't happened yet in the
six domains tried.

## Q3. Self-review warning in intentional multi-voice contexts

**The tension**: `gate review --by X` when the request's author
is also X emits a `⚠ self-review` warning (intentional, see #38).
In solo-journal mode the warning fires on every lens because the
pattern is intentional — one person deliberately reviewing their
own decision from four separate vantage points. The warning is
correct at a micro level but noisy when the convention is solo-
multi-voice.

**Options explored**:

- **Suppress via flag**: `gate review --by X --self-review-ok`.
  Opt-in, explicit, per-call. Heavy for a common convention.

- **Suppress via config**: `guild.config.yaml` gains
  `allow_self_review: true`. Declarative, whole-content_root.
  Loses the per-call visibility.

- **Suppress when custom lens is active**: if the reviewer uses
  a custom lens (not in the built-in 4), treat it as intentional
  multi-voice and skip the warning. Implicit, potentially too
  magical.

- **Leave it**. The warning is cheap; the noise is cosmetic;
  maintaining "self-review is always flagged" as an invariant
  has value.

**Current lean**: leave it. Two reasons: (a) the warning goes
to stderr, so most automation filters it out anyway; (b) the
"flagged even when intentional" stance keeps the Two-Persona
Devil frame honest. The few users who find it noisy can pipe
stderr away.

**What would settle it**: a user explicitly asking for
suppression in a non-cosmetic way (e.g., "the warning is
corrupting my log output in pipeline X").

## Q4. Predictive taxonomy accuracy — does the two-axes model actually predict fit?

**The tension**: `design-notes.md` claims that fit can be
predicted from two axes (principal separation in time via state
machine, in perspective via review lenses). Six domains confirm
the pattern for the cases tried. Is the model actually
predictive, or did it fit _because_ the six were chosen from
within the gravitational field of the tool's existing design?

**Options explored**:

- **More domain attempts**. Try domains that the model predicts
  should fit or not fit, and see if they do. Candidates:
  - **Predicted "max"**: contract negotiation, clinical
    procedures, peer review — all multi-principal deliberative
    work. Should feel like incident / meeting did.
  - **Predicted "partial"**: recipe iteration, fitness log,
    photography critique. Should feel like game design or
    research log.
  - **Predicted "skip"**: grocery list, bookmark collection.
    Should feel like overhead; the tool should actively feel
    wrong.

- **A counter-example that breaks the model**. The more
  interesting outcome. If _any_ domain predicted to fit turns
  out not to, or any "skip" turns out to fit surprisingly, the
  framework is incomplete.

**Current lean**: the model is probably right at the coarse
level but under-specified. Specifically, `design-notes.md`
explicitly calls out that issues and chain worked in every
domain, including ones where the axes predicted partial or no
fit. Those two features might run on a third axis (reference
structure) that the two-axes model doesn't capture.

**What would settle it**: at least three more domain tours
before drawing a confidence interval. Ideally by someone other
than the tool's author, since the author has taste bias.

## Q5. Records-as-mirrors effect — what is it, and should gate lean into it?

**The tension**: In solo-journal mode the _value_ wasn't from
principal separation or state machinery; it was that
externalizing an internal voice and seeing it in writing changed
how the voice felt. This is a property of records, not of gate
specifically. But the affordances gate provides — append-only,
timestamped, cross-referenceable, lens-tagged — might amplify
the effect vs. a plain text file.

**Options explored**:

- **Don't design for it**. The mirror effect emerges from the
  fundamentals; adding features for it would be over-reaching.

- **Design for it explicitly**. Build a "reflection mode" that
  surfaces one's own historical reviews with a delay (e.g.,
  `gate reflect --since 7d` shows a week-old utterance prefixed
  with "a week ago you said:"). Low confidence this is useful.

- **Write about it**. Document the mirror effect as something
  users may notice, without building for it. Lets the observation
  stay visible without committing to a feature path.

**Current lean**: write about it (probably in
`concepts-for-newcomers.md` if it ever makes sense there, or
here in design-notes). Don't build for it until someone reports
that the effect is what kept them using the tool.

**What would settle it**: evidence that some users stay
specifically because of the mirror effect, not because of the
deliberative-work features. Would reframe gate as a reflection
tool that happens to also model deliberation.

---

## Adding a new question

If you hit something that doesn't resolve in one session,
append a `Q{N}` section here. The template:

```
## Q{N}. <short title>

**The tension**: <what makes it open>

**Options explored**:
- ...

**Current lean**: <what feels right today, low confidence>

**What would settle it**: <evidence that would tip>
```

Questions can stay open indefinitely. Resolved questions move to
`design-notes.md` with a note pointing back to the question.
