- **Shared `--format` validator (`src/interface/shared/parseFormat.ts`)
  replaces 55 inline `if format !== json && format !== text` blocks
  across gate / agora / devil / ctx handlers.** Drift surface
  collapses to a single source of truth; the validation message
  ("`--format must be 'json' or 'text', got: <raw>`") is now uniform
  across passages (previously several handlers had the reversed-order
  "text or json" variant). Helper throws `DomainError(field='format')`
  so JSON-mode callers now receive the structured envelope
  (`{"ok":false,"error":{"field":"format","code":"validation_error",…}}`)
  instead of plain text — consistent with how every OTHER error in
  the same handler renders. Single-format verbs (`gate boot`,
  `gate schema`, `gate status`, etc.) pass `'json'` as the default
  via `parseFormat(args, 'json')`. Net: −134 LOC across 55 files.

- **`notice: wrote <path>` stderr line is suppressed in JSON mode
  for `agora new`, `agora play`, `devil open`.** The path and
  config-file are already in the stdout JSON envelope
  (`where_written` + `config_file`); re-emitting them on stderr was
  pure context pollution for AI consumers — every successful create
  burned two extra lines of tool-result context for information the
  caller already had structured. Text-mode readers still get the
  disclosure (the stdout `✓ created` line does not carry the path).
  `ctx record` already had the notice correctly gated inside its
  text-mode `else` branch.

- **Error prefix unified to `error: <msg>` across `gate next`,
  `gate self-pattern`, `gate decisions`.** Three handlers used a
  passage-verb-named prefix (`gate next: GUILD_ACTOR is not set…`),
  which on the `throw new Error` path produced the doubled prologue
  `error: gate self-pattern: …` once the outer-catch added its own
  `error:` envelope. Machine consumers that grep for `^error:` now
  match every error from every verb; prose hints retain the
  `next: <command>` recovery line below for the human reader.
