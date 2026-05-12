---
relevant_until: indefinite
---

# trap: stale `dist/` after branch switch

**Pattern.** `git checkout` swaps `src/` and `tests/` source files
but leaves `dist/` alone. `dist/` is `.gitignore`-d and lives outside
the version-controlled tree, so a branch that adds new files,
deletes others, or changes which verbs exist on disk leaves `dist/`
holding a **superposition** — compiled artifacts from both branches.
`tsc` re-emits the files it sees in `src/`, but it never removes
`.js` files that have no `src/` counterpart anymore.

The downstream symptom: `node tests/run.mjs` enumerates everything
under `dist/tests/` and runs every `.test.js` it finds. If a test
file existed on the previous branch and references a verb that
doesn't exist on the current branch (because the handler was added
in a feature branch and the test file got compiled there), the test
runs, fails with "unknown verb", and inflates the failure count by
a multiple no one expects.

Surfaced (2026-05-12 doc audit) when a serial benchmark of
`tests/run.mjs` reported `1622` tests where main only had `1610`:
the extra 12 were the compiled `decisionsAndSelfPattern.test.js` from
a pre-merge feat branch still living in `dist/tests/interface/`.

## Trigger conditions for review

Flag any of:

- Test count drifts up or down between consecutive `npm test` runs
  on the *same* branch without source changes (`dist/` carry-over).
- Test failures naming a verb the dispatcher doesn't recognise
  on the current branch (`unknown verb: <name>`).
- Build-then-test pipelines that don't clean `dist/` between
  branch operations (`tsc` is incremental — it adds, doesn't prune).
- CI configurations that cache `dist/` across branches without
  invalidation (no current example in this repo, but worth pinning
  before someone adds one).

## Honest mitigation

`tsc` itself does not support "remove orphans" — `--clean` removes
the output dir, then `tsc` rebuilds everything. That is the
correct hammer. Cheap fixes that don't actually fix:

- Adding `rm -rf dist` to a script: works locally, no recourse on
  CI where the cache is opaque.
- "Rebuild before test" pre-step: doesn't help when the orphan
  `.test.js` *is* the thing being run.

The right policy is to **never trust a stale `dist/` after a branch
switch**. `npm run build -- --clean` (or equivalent) is the only
safe path. The `verbs-consistency` test does catch the symmetric
case (verb in dispatcher but not in `verbs.ts`), but it cannot see
test files that reference verbs no longer wired up.

## Recovery in the moment

```
$ find dist -type f -delete
$ npm run build
$ npm test
```

Three lines. The first is the load-bearing one — `tsc` alone won't
do it.

## Why this is `indefinite`

The pattern is rooted in the medium (`tsc`'s incremental contract,
not in this repo's choice of layout) and will recur every time
someone switches branches without rebuilding from scratch. No
calendar-date event will "resolve" it. The mitigation is awareness,
not a fix.

## Related

- `lore/traps/trap_silent_fallback_loses_signal.md` — sibling: a
  build runs, tests run, output looks authoritative, but the
  artifact under measurement is wrong.
- principle 04 (records-outlive-writers) — `dist/` is the inverse:
  artifacts that **outlive their branch context** and silently mislead.
