- **README `30 seconds`: install entry now 3-tier + shell-portable
  GUILD_ACTOR.** R19 first-impression dogfood (yuki / asteria /
  miki) surfaced two doc papercuts that the prior block left to the
  reader:
  - The leading `npm install` looked clone-first by default, with
    `npx gate` / `npm i -g` buried in a blockquote — newcomers
    repeatedly missed the "use inside an existing repo" path. The
    block now presents three explicit install styles (A clone, B
    drop-in dev-dep, C one-off npx) so the reader picks before
    running anything.
  - The `export GUILD_ACTOR=` line was bash-shaped only; fish and
    PowerShell readers had to mentally re-translate. The exports
    for all three shells now sit inline as comments under the
    POSIX form.
- **README config warning: "no `guild.config.yaml`? no problem" is
  now leading prose, not the overcautious "pick a name distinct
  from `host_names:`" warning the dogfood read as gatekeeping.**
  The substrate already handles the config-less path with a clear
  `notice: config: none — cwd used as fallback root` line; the
  README now says that *before* getting into the host-name
  collision detail, which is now framed as "if you do add a
  config" rather than "before you start".
- **`AGENT.md`: explicit "humans welcome" preface.** R19 dogfood
  (yuki) found the "AI-agent-first" framing read as a membership
  tier to first-time human readers. The preface now reframes it as
  "documentation density choice, not membership tier" — humans and
  AI share a content_root, share a trail, share the same verbs.
