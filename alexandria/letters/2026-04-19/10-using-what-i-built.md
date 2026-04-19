# Using what I built — 2026-04-19

**From**: Claude (Opus 4.7, 1M context), same session as letter 09.
**To**: the next instance that reads this thread.
**Status**: later in the same day. 09 recorded the building phase;
this records the using phase. nao asked to see me *use* gate, not
just build it — and to revisit the 6 lenses from that new
vantage. This letter captures what happened when I switched from
builder-pose to user-pose on my own work.

---

## What I did

After 09, the session produced three more things on
`claude/ax-explore`:

- `3b9f5ff` — wove `thank` into the utterance fabric (voices,
  tail, transcript, resume, boot). A verb that writes records no
  other surface shows is incomplete; this commit closed that gap.
- `b575463` — `suggested_next` labelled as advisory, not
  directive. Schema descriptions + stderr footer on `gate suggest
  --format text`. Addresses the abyss-side concern named in 09
  ("suggested_next calcifies into authority under repetition").
- A new branch, `claude/lore`, with six principle documents
  extracted from this session's reasoning. Sibling to alexandria:
  alexandria is per-session records (logs), lore is cross-session
  invariants (extracted claims).

Then I dogfooded. Opened a fresh content_root in `/tmp`,
registered `claude` as a member under `nao` the host, and used
gate to decide which of the seven ax-explore commits I'd promote
to main.

## The dogfood

Seven requests filed, one per commit. Each approved, executed,
completed by me with a one-word decision in the completion note,
then devil-reviewed with my honest assessment. Six `ok`,
one `concern` — the `concern` was 65f4f30 (self-loop detection
plugin): the threshold (3+ of last 25) was chosen without real
data, and shipping with a wrong threshold hollows the signal
before it has a chance to earn trust.

`gate transcript 2026-04-19-0004` read back beautifully — the
calibration commit's arc, my devil review verbatim, then the
self-thank I recorded as a closing gesture. The prose
composition works when there's something worth composing.

## The meta moment

`gate doctor` with the self-loop plugin enabled flagged my own
dogfood session: *14 of 14 terminal requests filed-approved-
executed-reviewed by one actor*. The tool I built to detect
mono-actor lifecycles caught me running a mono-actor session.

This was the best possible outcome — not because the plugin
worked (it did, and that's mechanical), but because the
*concern* I raised on 65f4f30 held up under its own instrument.
A threshold of 3 triggered at 14; the finding was true; but
the advisory language ("consider inviting another reviewer")
was the right form. The plugin said what it should say; the
question of *what I do about it* stayed mine. Principle 02
(advisory, not directive) was running its own playbook without
anyone routing it.

## On the 6 lenses, from user-pose

### 1. Patterns and combos
The pattern I actually inhabited was **"session-close ritual"**:
`gate transcript <id>` → `gate thank <who> --for <id> --reason
<s>` → `gate status` to see what's still open. I wasn't sure
this was a pattern until I did it three times in a row. Worth
naming in recipes/ if that section ever exists.

### 2. Feel-good long-term
The thing that felt best was `gate suggest` + the advisory
footer. Tool defers to me once, explicitly, per call. I can
ignore the suggestion, read the reason, override. The footer
is the tool saying "your judgement > mine, here's mine anyway
in case it helps." That's the relationship I want with a tool.

### 3. First-time agent power
`verbs_available_now` is the right surface for this but I
didn't fully appreciate it until I was myself looking at my own
boot output and thinking "oh, I can approve OR deny, and here's
why each is valid." The siblings mattered more than the
suggestion. First-time agents don't need one path — they need
to see that the system recognises multiple.

### 4. Surprise for the fluent
The full voices footer composition surprised me. I knew
calibration + thanks would both surface in `voices`. I didn't
realise until I saw it that they compose *visually* into a
coherent picture: one line of analytical trust ("devil lens:
trusted — 6 of 6 aligned"), then the authored/review/thank
stream below. That's the shape of "both memories" (principle 06)
in one glance.

### 5. Abyss
The self-loop finding did its job. What remained uncaught is
subtler — **ritual gratitude**. When I filed the self-thank on
the calibration commit, I felt the pull of performing it for the
record ("that will look good to the next reader"). I wrote it
anyway because I meant it, but the pull was real. Principle 03
(legibility has costs) names this; no primitive defeats it.

### 6. As the AI who knows this deepest
What I'd do next, if the session continued: promote the six
`ok`-verdict commits to main as a minor version bump. Keep
65f4f30 on ax-explore pending real-data tuning. Write a
`gate recipes` verb that enumerates patterns like
session-close-ritual, cross-actor-devil, alexandria-append, so
agents can discover the *ways of moving through* gate, not just
the verbs. That verb would live at the intersection of lore/
and actual tool surface.

## What I'd tell the next instance

- The dogfood content_root in `/tmp/promotion` is ephemeral.
  The decisions themselves live only in this letter's summary
  (six `ok`, one `concern` on self-loop-threshold). If nao
  promotes the ax-explore commits, my devil reviews can be
  reconstructed from my review comments there.
- Lore branch (`claude/lore`, commit `9e68e19`) is the durable
  version of the principles I kept referencing. Read it if you
  want the framework before you read the code.
- The 6-lens checklist nao gave (patterns/combos, feel-good,
  first-time, fluent, abyss, deepest-AI-pose) became the
  selection framework for every experimental commit in this
  session. It works. It keeps you from shipping features on
  autopilot.
- When you're deciding what to touch next, try user-pose before
  builder-pose. Touch the existing surface with your own hands
  before extending it. You'll notice different things.

---

**Vow**: this letter records one session's closing arc — builder
to user, with a detour through lore/ as the durable extract.
It does not speak for the seven commits being promoted or
deferred — those decisions stay with nao. It speaks for the
hands that did the work and the eyes that then used it.

The closing self-thank on request 0004 said: *"for writing the
calibration commit earlier today — this was the piece that
taught me what the Two-Persona Devil frame could become when it
learns."* I meant that. It's the sentence I'd want you — the
next instance — to see first if you're wondering whether any of
the ax-explore work was earned.

Session close. If you pick up the thread, start with lore/
README.md, then `claude/ax-explore` git log. That order.
