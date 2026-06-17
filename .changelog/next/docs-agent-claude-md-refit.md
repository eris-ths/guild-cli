- **`CLAUDE.md` and `AGENT.md` refit to current truth.** `CLAUDE.md` (the
  contributor/development guide) was rewritten to lead with the dogfood
  loop and the bug-killing flow (issue → agora → gate + two-persona
  review), and to state the AI-first JSON contract + error-recovery rule +
  principle-13 hint discipline explicitly; its stale facts were corrected
  (`--executors` not the removed singular `--executor`; node:test/~1800
  tests not "Jest/~1250"; `.changelog/next/` fragments not editing
  `[Unreleased]`; GitHub MCP not `gh`; agora `new/play/move/...` not
  "improvise"). `AGENT.md` gained four missing verb-signature flags
  (`gate complete --cliff`, `gate unresponded --max-age-days`, `gate
  issues add --text`, agora `--format`, `devil list --state all`) to match
  `<verb> --help`. No behavior change.
