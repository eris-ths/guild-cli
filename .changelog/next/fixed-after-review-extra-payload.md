- **`after:review` hooks now receive the appended review on
  `ctx.extra.review`.** The review handler fired `fireAfterHook`
  without the `extra` argument, so `ctx.extra` was `undefined` for
  `after:review` subscribers — contradicting the contract documented
  in `docs/plugin-schema.md` ("`before:review` / `after:review` set
  `extra.review`"). A hook reading `ctx.extra.review.verdict` to
  route reject/concern verdicts silently saw `undefined`. The
  handler now passes the terminal (just-appended) review as
  `{ review }`, and a regression test in
  `tests/interface/hookPluginLoader.test.ts` asserts the hook
  receives `lense` / `verdict` / `comment` / `by`. (`before:review`
  carrying its own payload is tracked separately — it fires before
  the append, so the documented "appended review" shape needs a
  distinct decision.)
