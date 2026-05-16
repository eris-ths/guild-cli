- **Success-path stderr notices now suppressed in JSON mode** for
  `gate approve`, `gate execute`, `gate review`, `gate thank`. The
  notices (self-approve / executor-assignment mismatch / self-review
  / `--comment` deprecation hint / self-thank) carry information that
  JSON consumers can already detect structurally from the envelope
  (`by` / `from` / `executors[].name` fields), so re-emitting prose
  on stderr was pure context pollution for AI consumers. Text-mode
  readers still get the disclosure unchanged.
  - `gate approve --by X` where `X == request.from`, profile-feature
    `selfApprove: warn` → notice (text only)
  - `gate execute --by X` where `X` is not in the assigned executors
    list → notice (text only); message updated from
    `--executor records intent` to `--executors records intent`
    (singular flag was removed in #398)
  - `gate review --by X` where `X == request.from` → ⚠ self-review
    (text only)
  - `gate review --comment <s>` → deprecation hint (text only)
  - `gate thank X --to X` → self-thank notice (text only)

  Audit follow-up to #397 (which handled `notice: wrote <path>` in
  agora new/play, devil open). Same eris-first principle: stderr on
  success paths should not carry prose that's already in the JSON
  envelope.

  Out of scope (kept as-is):
  - `gate message` self-message / inactive-recipient notices: this
    verb has no JSON output mode at all, so stderr is the only
    signal channel.
  - `gate next` setup-failure notices: those are error paths, not
    success-path notices; they need a separate parity refactor
    (route through `emitErrorEnvelope` for JSON consumers) covered
    by a future PR.
  - `errorEnvelope.ts` JSON-on-stderr write: that's the contract
    (JSON consumers parse stderr for the envelope), not pollution.
  - `(explain: ...)`: opt-in via `--explain`, caller asked for it.
  - `⟶ <voice>`: text-mode-only ornament by design (#382).
