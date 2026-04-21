# agent-first-session

A minimal content_root showing the agent-first workflow: three
members (`claude` author, `devil` critic, `layer` critic), three
completed requests with reviews, no issues, no inbox.

Use this to verify that `gate boot`, `gate show`, and `gate voices`
produce sensible output on a small, clean dataset — or as a
template for bootstrapping a new content_root.

```bash
cd examples/agent-first-session
export GUILD_ACTOR=claude
gate boot                            # orientation snapshot
gate show 2026-04-16-0001 --format text   # a single request arc
gate voices devil --format text      # the devil critic's history
```

## Structure

- `guild.config.yaml` — default config, no hosts.
- `members/` — `claude`, `devil`, `layer`.
- `requests/completed/` — 3 requests (`2026-04-16-0001` through `-0003`),
  each with status_log and reviews.

## What this is not

- Not a multi-day session (see `dogfood-session/` for that).
- Not an example of issues, inbox, or pair-mode (`--with`).
  See `agent-voices/` for richer patterns.
