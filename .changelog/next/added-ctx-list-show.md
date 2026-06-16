- **`ctx list` / `ctx show` — phase-1 read-side.** Facts can now be read
  back without grep. `ctx list` prints recorded facts newest-first (id,
  author, timestamp, tags, snippet); `--tag prefix:value` filters by an
  exact tag and `--by <m>` by author. `ctx list` with no records and
  `ctx list` with a filter that matches nothing give distinct messages.
  `ctx show <id>` prints one fact in full; a well-formed but absent id
  raises a not-found that names `ctx list` as the recovery (text hint +
  structured `error.recovery` in JSON), and a malformed id fails at the
  domain boundary. `list` / `show` leave the phase-2 verb set. Surfaced as
  the strongest pull toward phase 2 while dogfooding ctx.
