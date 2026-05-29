- **`gate execute` on a pending request now redirects to `gate approve`
  by name.** The domain rejects `pending → executing` with a state-name
  hint ("valid next states from pending: approved, denied"), leaving a
  caller who skipped approve to translate "approved" back into a verb.
  `reqExecute` now pre-checks the pending state and throws a
  `RecoverableError` naming the bridge directly — prose `error:` line
  plus a structured `error.recovery: {verb:"approve", args:{id}, …}` for
  JSON consumers. This mirrors the existing `gate fail`-from-pending
  (→ `deny`) and `gate fail`-from-approved (→ `execute`) redirects; the
  dry-run path redirects identically rather than throwing the bare
  domain hint. State vocabulary stays in the domain (RequestState.ts);
  the verb hint stays an interface concern.
