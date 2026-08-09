- New `delta` passage (alpha): `add` / `list` / `deliver` / `show`, for
  deposits — conclusions that are settled but not yet filed anywhere. It sits
  between agora (the thinking is unfinished) and ctx (it has landed as a
  fact); conflating those costs a reader the ability to tell "we don't know
  yet" from "we know and haven't written it down". `add` requires only
  `--text`, because every extra mandatory flag is paid on the interrupting
  path — the writer is mid-task, which is the cost this passage exists to
  avoid. `list` is **oldest-first**, the opposite of `ctx list`: a backlog is
  read to be drained, so the longest-waiting deposit must not be the one that
  scrolls away, and each deposit shows its age in days. `deliver` is
  once-only — a second delivery is refused and the error names the first
  destination, since re-routing is a new deposit citing this one rather than
  an edit that would erase where the work actually went. Destinations are
  free-form: a closed vocabulary would push real destinations into a note
  field where they stop being filterable. There is deliberately no
  "route everything" verb — deciding where a deposit belongs is a judgment,
  and judgments belong in `gate` with an author on them. State lives in a
  field, not a directory, so `deliver` stays a single atomic write instead of
  a cross-directory rename with a half-moved failure mode.
