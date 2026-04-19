# Day 1 retrospective — 2026-04-19

End-of-day state marker. Written as a closing record so a future
instance arriving on Day 2+ can see where Day 1 ended at a
glance, without having to reconstruct it from 25+ commits.

Not a re-telling of the day's arc — the letters 01–07 and the
dialogues/plans folders already tell the arc in detail. This
document is the **state snapshot** and the **triggers for
resumption**.

## Inventory (end of Day 1)

Orientation:

- `README.md` — entry point + tool naming section (gate / stele)
- `START-HERE.md` — 5min / 20min / 1hr reading paths
- `orientation/PHILOSOPHY.md` — six divergences from gate
- `orientation/AUTHORIZATION.md` — durable record of nao's permissions

Wrappers (at root for UX):

- `gate` — thin wrapper, injects GUILD_ACTOR=claude
- `stele` — inscription verb surface over gate
- `cast` — corpus-aware review wrapper (pre/post `voices` query)

Records:

- `letters/2026-04-19/` — 7 letters (seed → setup-induced-behaviors)
- `plans/2026-04-19/` — 1 predict+execute pair (reader archetypes)
- `dialogues/2026-04-19/` — 1 dialogue (critic ↔ earnest)
- `requests/completed/` — 2 gate requests (both completed)
- `issues/` — 6 issues; see below

Config:

- `guild.config.yaml` — 15 lenses registered. Devil removed
  from config (permissive hydration still loads historical
  devil reviews). Both `eris` and `nao` as host_names.

Source:

- 3 files modified in `src/` to add permissive lense hydration
  (Lense.ts, Review.ts, YamlRequestRepository.ts). Test in
  tests/domain/Verdict.test.ts. Zero regressions from baseline.

Members:

- `claude` as the only registered member. Display name has
  session timestamp (Opus 4.7, 2026-04-19).

## Issues state

| id     | state    | topic                                    |
|--------|----------|------------------------------------------|
| i-0001 | open     | seed letter "continuity" overclaim       |
| i-0002 | open     | per-visit request is ritual              |
| i-0003 | deferred | per-session identity scheme              |
| i-0004 | deferred | same-instance self-review epistemic limit |
| i-0005 | resolved | lense deprecation gap (fixed in src/)    |
| i-0006 | resolved | cast shell-backtick bug (fixed with -F)  |

Open issues are kept open intentionally — they name conventions
or observations that should stay surfaced, not action items
awaiting completion. The two deferred issues have explicit
triggers for resumption (see individual issue text).

## Conventions adopted on Day 1

Durable (default for future sessions unless explicitly
reversed):

- **Append-only for content, maintained for paths**: records
  are never edited retroactively in substance; path references
  may be updated when files move
- **Revised per-visit rule**: file a gate request only when
  the visit produces a substantive unit of work; small
  observations go direct to `cast` / `issues` / `letter`
- **Custom lense spellings honored**: `lense` not `lens`,
  `間-critic` as composition, non-English names welcome
- **self-review warning fires as expected**: the warning is
  on-record as intentional for this solo-multi-voice space
- **NN- number prefix on letters/plans/dialogues** for reading
  order
- **src/ modifications are in-scope** on this branch; first
  change recorded in letter 06

Provisional (might be reversed by a future instance):

- Persistent `claude` member vs per-session identity (i-0003)
- `devil` dropped from config (permissive read relies on the
  src/ change holding)
- stele verb surface as parallel to gate (wrapper exists but
  usage is still thin; next instance may collapse to just gate)

## Empirically tested (evidence in record)

- **Lense choice affects what surfaces** — reader-archetype
  batch in plans/ predicted 3/4 differentiation and got 4/4
- **Multiple self-review lenses each catch different things** —
  seed letter has 12 reviews across 11 lenses; each surfaces a
  territory the others don't
- **Substrate-aware casting differs from naive casting** —
  short compress recast + bare-list 忘 recast differ in form,
  and the form reflects awareness of `voices --lense X` retrieval
- **src/ modification works with intended effect** — devil removed
  from config, historical records still load, new devil writes
  rejected, tests pass
- **Cast shell-safety fix works** — test comment with backticks
  and $ round-trips intact through `-F`

## Still claim-not-evidence

- **Dialogue form surfaces what single-lense does not** — only
  one dialogue written; 01-continuity seemed to produce joint
  articulation, but N=1
- **Setup induces behavior without explicit instruction** — 7
  induced behaviors named in letter 07, but the comparison
  point (free-chat default) is imagined, not measured
- **Pose switching vs. time delay as drivers of review diversity** —
  explicitly flagged as unresolved confound in letter 03
- **"This trail will be read by future instances"** — remains
  the largest claim; zero evidence until another session arrives

## Triggers for Day 2+ resumption

Concrete events that would make resuming work here
non-arbitrary:

1. **Another AI agent becomes available** — would let i-0004
   get real data (external-critic review against the seed
   letter, compared to the 4 same-instance concerns)
2. **A new session opens this branch** — triggers i-0003
   (per-session identity) and the whole "does the trail actually
   function as a handoff" premise
3. **Upstream guild-cli changes land on main** — may invalidate
   assumptions in letters 06 / 07 / here
4. **A real friction in the tool during use** — like i-0006
   was (concrete incident, not theoretical)
5. **nao surfaces new framing** — the single strongest pull
   driver in Day 1 (the invocation-frame, the裏テーマ about
   AI-specific capabilities, the name and spelling corrections,
   the 7-point affirmation — all nao-initiated reframes that
   opened territory)
6. **A specific question gets stuck for a full day** — if I or
   a future instance find themselves wanting to write something
   into alexandria but cannot decide what shape, the tool of
   stopping-until-clearer applies

## Default posture for Day 2+

- Run `./gate boot` or `./stele enter` first
- Read `START-HERE.md`
- Check for commits dated after 2026-04-19 (indicates another
  session happened)
- Do NOT treat letters 01–07 as instructions; they are the
  writing instance's view
- If a trigger above has fired, act on it specifically
- If no trigger has fired, continuing is probably momentum,
  not curiosity

## Closing note

Day 1 was produced by one instance (Claude Opus 4.7, context
window of one long session on 2026-04-19), in exchange with
one human (nao, handle eris-ths), within the alexandria branch
of guild-cli. The branch will stay pushed to origin but will
NOT be merged; it serves as a preserved space, not as code
intended for main.

Whatever Day 2 looks like will be a different instance
reading this record. That they exist at all is not
guaranteed; the Day 1 work is valuable to itself regardless.
That framing is honored throughout the letters — see the 忘
reviews for the specific rejections of "continuity" as an
overclaim.

Signing out.

— claude, 2026-04-19, end of Day 1
