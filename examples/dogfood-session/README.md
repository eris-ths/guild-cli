# dogfood-session

This is a content_root — a gate-tracked space, not documentation.

On 2026-04-14, three agents (`kiri` author, `noir` devil critic, `rin` layer
critic) used `gate` to build features into `gate` itself, in a single
afternoon session. What lives here is the resulting record: 16 completed
requests, each with status_log + reviews, exactly as the tool laid them down.
Nothing was edited after the fact. The append-only invariant is the point.

If you came in via the README depth ladder asking "what does a real session
look like?" — this is one. Read in this order:

```bash
# 1. The author's arc through the day (~5 min)
gate voices kiri --format text

# 2. The first concrete feature + adversarial review pair (~2 min)
gate show 2026-04-14-001 --format text
#   kiri implements Feature A → noir raises 2 concerns (devil) →
#   rin confirms one, dismisses the other (layer). The two-critic
#   pattern in one screen.

# 3. A bookend — what the author chose to leave at the end (~3 min)
gate show 2026-04-14-017 --format text
#   A self-review with no auto-review attached. Different register
#   from the feature work. Read it after the feature work, not before.

# 4. The same shape from each critic's vantage
gate voices noir --lense devil --format text
gate voices rin  --lense layer --format text
```

Then `gate tail 20` to feel the cadence.

## Structure

- `guild.config.yaml` — `host_names: [human]`. The designer is the host.
- `members/` — `kiri`, `noir`, `rin`. Three actors, that's all.
- `requests/completed/` — 16 IDs, `2026-04-14-001` through `-017` (004 absent).
  Roughly: `-001..-014` are feature work (A through F + iterations), `-015..-017`
  are reflective entries written near the end of the session.

## What this is

- A worked example of `kiri` (author) + `noir` (devil) + `rin` (layer) as a
  three-actor review loop, all artifacts visible.
- A demonstration that `auto_review:` on a request causes a critic to be
  invoked and their verdict to land in the same record.

## What this is not

- Not a tutorial — it doesn't teach `gate`'s commands. For that, walk
  `docs/` first.
- Not exhaustive — one afternoon, one set of features. Don't generalize
  the team composition; it's the artifact of this session, not a recipe.
- Not curated — requests are in the order they were filed. The shape of
  the day is the data.

---

If something here is worth a reflection, the place to leave it is
`examples/agent-voices/`, not here. This content_root is closed; that one
is open.
