- **`ctx <phase-2 verb>` now gives a roadmap-aware message.** Typing a
  verb that the help / docs name as "arriving in phase 2" (`fork` /
  `supersede` / `show` / `list` / `chain` / `status`) used to produce the
  same bare `unknown verb` a typo gets. It now says the verb is *planned
  for phase 2, not yet implemented* and points at the phase-1 surface
  (`record` / `export` / `import`). Genuine typos still get the
  did-you-mean suggestion. Surfaced by dogfooding ctx from a user's
  perspective.
