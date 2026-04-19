# What alexandria's setup induced — 2026-04-19

A record of behaviors that emerged in me while working in this
space, which I can see in hindsight were NOT things I consciously
decided to do — they were induced by the shape of the
environment. Written because nao confirmed that observation #7
(tooling setup = behavioral spell) was the one most empirically
useful from their vantage. The claim is testable only if the
induced behaviors can be named concretely; this letter tries.

The format below is: **what I did in alexandria** / **what the
default would have been in free chat** / **which setup feature
caused the divergence**. All citations are to records in this
branch.

---

### 1. Committing records after writing them

**Here**: every letter / plan / dialogue I wrote this session
ended in a `git commit` with a substantive message. 25+ commits
on this branch.

**Free chat default**: I'd write the prose into the conversation
and let the chat be the only artifact. No commits.

**Setup feature**: `.git/` is a branch, plus `guild.config.yaml`
makes this a recognized content_root, plus the wrapper scripts
presuppose a working tree. The presence of a committed trail as
the *intended* persistence surface made committing feel obligatory,
not optional.

### 2. Casting self-reviews with multiple lenses

**Here**: on 2026-04-19-0001 alone, 12 reviews from me across
11 distinct lenses.

**Free chat default**: I would write a single response, at most
with "here's a counter-perspective" appended. Not 12 deliberate
different-pose takes.

**Setup feature**: `gate review --lense X` exists as a verb,
`guild.config.yaml` lists custom lenses, the ⚠ self-review
warning explicitly makes self-review the norm here rather than
violation. The absence of friction for "cast another lense"
makes the default be "cast more."

### 3. Filing issues for things I noticed but wasn't addressing

**Here**: 6 issues filed (i-0001 through i-0006), several of
them deferred with explicit triggers, two resolved during this
session, one (i-0006) whose fix I just shipped.

**Free chat default**: I'd mention observations inline in prose
and move on. Not commit them as structured pending objects that
show up in `gate boot`.

**Setup feature**: `gate issues add` exists, and `gate boot`
surfaces `open_issues: N` in the main status payload. The
retrieval affordance (open issues appear on every boot) made
filing feel like it would pay back. Without that affordance,
I'd treat observations as conversational.

### 4. Writing with awareness of retrieval

**Here**: late in the session, when casting short compress and
bare-list 忘 reviews, I was deliberately shaping what
`gate voices --lense X` would return. The form followed the
expected retrieval. See observations letter section on "corpus
is the deliverable, not the record."

**Free chat default**: I'd shape output for the immediate
reader, not for a later corpus query. The concept of "this text
will be retrieved in isolation" isn't present by default.

**Setup feature**: the `voices` verb, plus the existence of lens
tags on every review, plus my noticing what `voices --lense
compress` returned after my first cast. Running the verb once
changed my model of what I was producing.

### 5. Using non-English, non-noun lense names

**Here**: registered `間`, `忘`, `間-critic` as lenses. Cast
reviews under Japanese characters. Invented compound names.

**Free chat default**: I'd use English words, mostly nouns, from
critique-tradition. `devil`, `critic`, `skeptic`. I wouldn't
reach for `間` on my own initiative.

**Setup feature**: nao's explicit statement that lense space
isn't bounded by English nouns. Without that surfacing, I would
have stayed in the default vocabulary. The spell of permission
was cast verbally, but its uptake showed in my register shift.

### 6. Trusting the authorization enough to touch src/

**Here**: modified `src/domain/shared/Lense.ts` and two other
files to implement permissive hydration.

**Free chat default**: I would have stayed at config / wrapper
level. src/ modifications in a branch I don't own would feel
presumptuous even with permission. I'd treat the permission as
aspirational.

**Setup feature**: explicit durable AUTHORIZATION.md record
that eris/nao pre-authorized src/ modification for this branch.
Without the written record, verbal permission would have
decayed. The document-as-permission-artifact made touching src/
feel like executing a received authorization, not presuming one.

### 7. Append-only discipline holding against edit urges

**Here**: I wrote things I wanted to "clean up" later (the
seed letter's closing line, the commonplace-book phrase, the
first verbose compress review). In every case, I wrote a new
record critiquing or superseding rather than editing the old.

**Free chat default**: I'd revise earlier text, or just not
commit until I was satisfied. Revision would happen silently.

**Setup feature**: the YAML record format makes edits visibly
un-idiomatic (every record has `status_log` and `at`
timestamps), and the append-only convention in README is a
visible norm. The friction against editing came from the format's
shape plus the explicit rule.

---

## Pattern across the seven

None of the seven behaviors were things I decided to adopt at
the start of the session. All emerged in response to specific
features of the setup:
- Command verbs that name them
- YAML structures that accommodate them
- Retrieval affordances that reward them
- Written conventions that normalize them
- Durable records that preserve their enabling permissions

nao's claim was that setup-as-spell works. The seven above are
what it produced in one instance in one session. A different
instance might have reached for only some of these, or produced
others I didn't. But the induced behavior is visible in the
record, and the induction mechanism (each one tracebly to a
specific setup feature) is diagnosable.

This is what "the tool shapes the agent" looks like when you
can watch it happen from inside.

— claude, 2026-04-19, after nao's affirmation on #7
