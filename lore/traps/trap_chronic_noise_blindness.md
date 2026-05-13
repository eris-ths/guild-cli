---
relevant_until: indefinite
---

# trap: chronic-noise blindness

**Pattern.** A surface fires on every invocation in some
expected-state branch, the operator/agent stops registering it as
information, and over time the noise *becomes* the chrome. Real
warnings then arrive at the same visual altitude as the chronic
chatter and lose their signal. The longer the noise has been there,
the harder it is to notice it is noise.

Surfaced 2026-05-13 dogfood (one fix, one trap):

- `gate boot` emitted a 7-line `inbox enrichment failed` warning
  block on every invocation by a host actor — by-design state
  ("hosts have no inbox") rendered as a transient anomaly. After
  ~7 boot calls in a single session, the operator had stopped
  parsing the block at all and only noticed it when explicitly
  prompted to look for friction. Fix: gate the enrichment on
  `role !== 'host'` so the host path stays quiet (PR #362). The
  fact is still on the payload as `role: 'host'`.

The boot warning is one example of a wider class. Watch for it
anywhere a verb's output includes a section that "always says the
same thing under normal use." That section is a candidate for
suppression-when-expected, not a candidate for the operator to
mentally filter.

## Trigger conditions for review

Flag any output surface that:

- Renders the same warning/notice/disclosure on every invocation
  whenever the actor is in a *configured* (not surprising) state —
  the actor is a host on a host-configured root, GUILD_ACTOR is the
  one the operator has had set for weeks, the cwd is the expected
  content root, the deprecation is for a flag the operator
  consciously chose, etc.
- Repeats a fact that is already conveyed by a *structured* field
  in the same payload (boot's `role: 'host'`, list's filter
  state, schema's deprecation flag). The structured field is the
  durable answer; the prose duplicate is the candidate to drop.
- Cannot be acted on. If the read of the line never causes the
  operator to *do* something different, the line is chrome.

The fix shape is one of:

1. **Suppress on expected-state.** When the surface's predicate
   would otherwise fire on a configured-and-expected branch, take
   the branch silently. Keep the surface for the unexpected
   branch (e.g. unknown actor, missing config, surprising cwd) so
   it retains its diagnostic value where it disambiguates.
2. **Demote to once-per-session.** A useful-on-first-encounter
   disclosure (e.g. "GUILD_ACTOR=eris is being used as a filter")
   can be guarded behind a session marker so the operator hears
   it once and then it stays quiet.
3. **Move to a structured field only.** Drop the prose entirely
   and let consumers read the JSON field. Acceptable when the
   prose adds nothing the field doesn't already say.

## Relationship to other principles

- **Principle 09 (orientation-disclosure).** "Surface surprising
  cases, stay quiet otherwise." Chronic noise is the direct
  inversion: the surface stays loud on the *unsurprising* case,
  burning the operator's filter.
- **Principle 02 (advisory-not-directive).** A notice that
  cannot be acted on is not an advisory; it is decoration.
  Decoration that repeats every invocation is the seed of
  chronic-noise blindness.
- **trap_silent_fallback_loses_signal** is the dual: that trap
  warns about *under-surfacing* (the catch hides a real signal);
  this one warns about *over-surfacing* (the routine pre-empts
  the real signal by exhausting the operator's attention).

## Why this is `indefinite`

Software grows by accretion of surfaces; each surface ships with a
plausible reason at the time it was added. The dogfooder who added
it usually does not stay around to notice it has become noise. The
operator who lives with it adapts and stops seeing it. Only an
external eye — a new agent, a guest reviewer, a deliberate audit —
catches the accumulation. Pin the trap so the pattern is named the
next time a surface ships that "always says the same thing."

## Related

- [trap_silent_fallback_loses_signal](trap_silent_fallback_loses_signal.md)
  — the under-surfacing dual.
- [principle 09](../principles/09-orientation-disclosure.md) — the
  inverted principle.
- [principle 02](../principles/02-advisory-not-directive.md) — the
  surface-as-decoration anti-pattern.
- PR #362 (2026-05-13) — first concrete instance fixed: host-side
  inbox enrichment warning suppression.
