- **README: `gate fast-track` is now glossed where the "30 seconds" loop
  first uses it.** The quick-start told newcomers to run `gate fast-track`
  but the verb was absent from the "the whole tool is six verbs" list and
  never defined — so the loop you're told to run and the loop you're shown
  didn't line up. An inline comment plus a one-line note now explain that
  fast-track collapses request → approve → execute for the self-flow case,
  while the six verbs remain the full deliberation loop.
- **README: the Passages note says *why* agora / devil / ctx run via
  `node ./bin/<name>.mjs`.** Only `gate` and `guild` are registered as
  `bin` commands in `package.json`, so the alpha passages aren't on PATH
  even after a global install — the README now states that rather than
  leaving the reader to infer it.
