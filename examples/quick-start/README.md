# quick-start — a graduated reading path

The minimum is a config + two member files; you can `cp -r` and be
running in 30 seconds. The shape below is for the AI agent (or
human) opening this directory cold and wanting to know not just
"how do I run it" but "what's actually here."

The path is graduated: a 30-second slice, a 5-minute slice, a
20-minute slice. Stop at the depth your task needs. Skip ahead
when the next slice is obvious.

> **A warning before the recommendations**: this is one reading
> path, not the only one. Treat it as "the writing instance's
> guess about what helps a new reader," not as instructions. If
> a different order fits you, follow that. The shape is borrowed
> from `snapshot/alexandria`'s START-HERE.md.

## 30 seconds — see something

```bash
cp -r examples/quick-start/* /path/to/your/content_root/
cd /path/to/your/content_root/
GUILD_ACTOR=alice node /path/to/guild-cli/bin/gate.mjs boot
```

What you should see: an orientation payload with empty queues,
a `lore: N principles, M traps` line (the package-shipped
doctrine reader is wired up), and a `→ next:` suggestion. Empty
is the correct starting state — the guild has no record of any
wave yet.

If `boot` errors with "no guild.config.yaml found, falling back to
cwd" you're not in the directory you copied the files into. `cd`
there.

## 5 minutes — file your first request

Run the four-step wave loop end-to-end:

```bash
# file
gate request \
  --action "ship hello-world" \
  --reason "smoke-testing the wave loop" \
  --executors alice \
  --from alice \
  --target hello.txt

# approve (alice is a host_name in this config, so self-approve
# works with a notice — see lore/principles/02-advisory-not-directive.md)
gate approve <id> --by alice

# execute (state flips to executing)
gate execute <id> --by alice

# complete (terminal)
gate complete <id> --by alice
```

`<id>` is the dated id `request` printed (e.g. `2026-05-13-0001`).
Each transition emits a JSON envelope with `suggested_next` —
that's the substrate telling you what's actionable now. Run
`gate boot --format text` again after each step to see how the
orientation changes.

If anything surprises you here, that surprise is data: file it
as an issue. `gate issues add --title "<...>" --body "<...>"`.

## 20 minutes — read the doctrine, explore sibling passages

The package ships lore (principles + traps) accessible without
leaving the substrate:

```bash
gate lore list                          # full catalog
gate lore show 11-ai-first-human-as-projection  # one principle
gate lore list --type trap --relevant-until current
```

There are three sibling passages beyond gate:

| passage | one-liner | first verb |
|---------|-----------|------------|
| `gate`  | wave coordination — request/approve/execute/complete | `gate boot` |
| `agora` | exploration — open-ended dialogue, not state machines | `agora new` |
| `devil` | adversarial review — entry/list/dismiss/resolve | `devil entry` |
| `ctx`   | session-spanning context — record-once primitive | `ctx record` |

Every read verb accepts `--explain` to print a one-line
orientation to stderr without disturbing stdout. Try
`gate boot --explain` or `gate lore list --explain`.

## Where to go next

This directory is the smallest possible content_root. Three other
example directories show richer shapes:

- [`../agent-first-session/`](../agent-first-session/) — three
  members, three completed requests with reviews. Use to verify
  `gate voices` / `gate show` against a small clean dataset.
- [`../dogfood-session/`](../dogfood-session/) — a real
  multi-day session record: three actors building gate ON
  gate, 16 requests with zero post-hoc edits. Read the
  `requests/` arc top-to-bottom.
- [`../three-passages-framing/`](../three-passages-framing/) —
  an agora play preserving the conversation that established
  the gate / agora / devil framing.

For doctrine, `lore/principles/` (in the package root, not this
directory) holds the 14 principles every passage is built
against. `gate lore list` reads them without leaving the CLI.

## What is NOT in this reading path

Deliberately omitted:

- Profile selection (`profile: swarm` vs `standard`). Default is
  fine for a smoke test. See `docs/` for swarm-specific shapes.
- Multi-executor waves (`--executors alice,bob`). Adds
  worktree isolation requirements; the loop above is single-
  executor on purpose.
- `gate claim` / `gate witness` — cross-session coordination
  primitives. Not needed until you have two sessions running
  against the same content_root.

The append-only discipline applies to this guide too: if you
find a better path, prefer adding a sibling note (e.g.
`README-multi-actor.md`) over overwriting this one.
