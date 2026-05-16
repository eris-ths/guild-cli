- **`gate decisions` no longer mis-attributes slice-fail/complete
  reasons to the `executing` row.** Issue surfaced by asteria's
  dogfood run (2026-05-16, finding D1): running `gate fail <id>
  --by X --reason "msg"` produced a `decisions` payload where the
  fail row carried the cascade auto-note (`wave failed (any-fail-
  wave-fail)`) while the **execute** row carried the actor's
  `--reason` text. Root cause: per-#294 slice-closure writes a
  second `executing` status_log stamp (with the slice note) that
  the dedupe walk collapsed into the execute row via "later wins".
  Fix: detect slice-close stamps (executing entry whose `at`
  matches the executor record's `completed_at`) and re-kind them
  to fail/complete; skip wave-cascade entries whose auto-notes
  match the domain-emitted patterns from `Request.ts:1060`.

- **`gate transcript` prose reads naturally on slice-closure
  waves.** Same root cause as the decisions fix (eris touch-feel
  2026-05-16 finding 4.4). Before:
  `Asteria moved it to executing (90ms later). Asteria moved it
  to executing (87ms later) (note: "slice done"). Asteria moved
  it to completed (0ms later) (note: "wave completed (all slices
  closed)").`
  After:
  `Asteria moved it to executing (90ms later). Asteria closed
  their slice as completed (87ms later) (note: "slice done").
  The wave completed (all slices closed) (0ms later).`
  Cold readers see one judgement per executor, plus the wave-level
  consequence as subject-less prose (no actor credited with
  writing the auto-text).

- **`gate fail` on an approved wave now surfaces the `gate execute`
  bridge.** asteria finding B1: pending → fail returned a
  RecoverableError with a `gate deny` recovery hint and the JSON
  envelope's `error.recovery` field; approved → fail returned the
  domain layer's raw `Illegal state transition: approved → failed`
  with no recovery shape at all. Same prose + structured-recovery
  discipline now applies — JSON consumers can dispatch the
  `execute` move without pattern-matching on state-machine prose.

- **`gate help` is now a sugar alias for `gate --help`.** The bare
  `help` was previously rejected as `unknown command`, costing one
  tool-call round-trip for the universal "what does this CLI do?"
  reflex (asteria finding A1). Aligns with `gate --help` / `-h`.

- **`boot.session_id_source: "unset"` replaces `null`.** Enum is
  now `['flag', 'env', 'unset']`. asteria finding A2 — null
  required readers to know whether it meant "not present yet" or
  "error". The explicit `"unset"` token is principle 10 (schema-
  as-contract / output specificity) applied at the value layer.
  Schema enum updated; tests adjusted.

- **`gate lore show <number>` resolves to the slug.** Numeric input
  (`gate lore show 11`) now matches the unique principle/trap with
  that number prefix (`11-ai-first-human-as-projection`). Cold
  readers reach for the number first; the slug-only requirement
  cost a round-trip (eris touch-feel finding 4.6). Ambiguous or
  non-numeric input falls through to the previous "not found"
  hint unchanged.

- **`--note` / `--reason` / `--action` / stake-note fields now
  declare `maxLength` in `gate schema`.** Free-form text fields
  (`MAX_TEXT = 4096`) and stake fields (`MAX_STAKE_NOTE = 80`)
  ship their domain caps via the schema envelope so AI consumers
  pre-validate before composing long payloads. asteria finding F1
  ("`--note` cap not advertised → silent truncate risk on long
  handoff messages"). Applied to gate's primary write verbs
  (approve, deny, execute, complete, fail, claim, witness);
  others inherit the same caps but advertise them less
  prominently — sweep-out is a follow-up.

- **`gate review` help example uses `--note` (the canonical flag)
  instead of `--comment` (the deprecated alias).** Drift surfaced
  by eris touch-feel finding 4.5: the same verb runs a deprecation
  notice when `--comment` is used, but the canonical example still
  showed it as the first surface. Aligned.

- **Lore broken citations removed.** Principle 12 cited
  `substrate/agora/plays/whole-repo-review/2026-05-04-001.yaml`
  (dir doesn't exist in repo); principle 04 cited
  `alexandria/orientation/PHILOSOPHY.md` (dir doesn't exist).
  Both were dangling references — the irony of principle 04
  (records-outlive-writers) carrying a citation that didn't
  outlive its writer was not lost. Principle 12 kept the
  three-voice framing but removed the file pin; principle 04 lost
  the alexandria bullet entirely (asteria findings 1 & 2).
