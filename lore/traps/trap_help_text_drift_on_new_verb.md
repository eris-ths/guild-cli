---
relevant_until: indefinite
---

# trap: `gate --help` drift on new verb

**Pattern.** Adding a verb to `gate` requires wiring it through
several registries:

- `src/interface/gate/index.ts` — `KNOWN_COMMANDS` array + the
  dispatcher switch.
- `src/interface/gate/verbs.ts` — `READ_VERBS` / `WRITE_VERBS` /
  `LOCK_EXEMPT_VERBS` (lock middleware classification).
- `src/interface/gate/handlers/schema.ts` — verb entry consumed by
  `gate schema --format json`.
- `tests/interface/verbs-consistency.test.ts` — `GATE_ALL` array
  pinning the union against dispatcher names.
- `src/interface/gate/help.ts` — **the only registry not pinned by
  any test**.

The `verbs-consistency` test enforces three of the five sites. It
does NOT check `help.ts`. So a new verb can be:

- Fully wired in the dispatcher (runs correctly)
- Present in `gate schema` (LLM tool layers see it)
- Listed in `verbs.ts` (lock middleware classifies it)
- Tested by `verbs-consistency` (CI passes)
- **Invisible to `gate --help` and `gate --help --all`**

The CI passes, the verb works, but the human-facing CLI text
silently drops it.

Surfaced (2026-05-12 doc audit) when four entries shipped without
`help.ts` updates: `gate decisions` (#336), `gate self-pattern`
(#336), `gate review-context` (PR #320 → #321 bundle),
`gate resume --with-doctor [--auto-repair]` (PR #316 → #321 bundle).
All four passed CI on their original PRs; the gap took 5 days to
surface, by which time the verbs were live and the gap was a
release-blocker for documentation pass alignment.

## Trigger conditions for review

Flag any PR / commit that:

- Adds an entry to `KNOWN_COMMANDS` (in `src/interface/gate/index.ts`)
  but does **not** add an entry under `SECTIONS` in
  `src/interface/gate/help.ts`.
- Adds a flag to an existing handler (e.g. `--with-doctor` on
  `gate resume`) but does **not** update the corresponding entry's
  signature line in `help.ts`.
- Adds a new write verb (`READ_VERBS` / `WRITE_VERBS` extension)
  whose Tier is non-obvious from the registry alone — `help.ts`
  needs a explicit `tier:` field per entry, which the registry
  doesn't carry.

## Honest mitigation

Two paths, neither shipped yet:

1. **Make `verbs-consistency` extend to `help.ts`** — parse
   `SECTIONS` and assert every `KNOWN_COMMANDS` entry has a
   `help.ts` entry. Fails CI on the gap. Best fix, single test
   file change.
2. **Auto-generate the relevant parts of `help.ts` from the
   `schema.ts` registry** — single source of truth. Larger change,
   loses the hand-tuned line-by-line text that `help.ts` currently
   carries (which is a feature, not a bug — tiered prose is
   editorial).

Until either lands, the operational rule is: **after wiring a new
verb, run `node bin/gate.mjs --help --all | grep <verb>` and verify
the entry exists.** The check is 1 grep; the cost of forgetting is
5 days of drift.

## Why this is `indefinite`

Until path 1 or path 2 ships, the trap recurs every new-verb PR.
After the fix, this trap retires (graduates to docs/verbs.md or
gets quarantined via `gate doctor sweep-traps --apply`).

## Related

- `lore/traps/trap_silent_fallback_loses_signal.md` — sibling
  pattern (look-authoritative-but-incomplete output).
- principle 09 (orientation-disclosure) — surfaces must disclose
  what they know; `--help` failing to list a verb is the opposite
  of orientation disclosure.
- principle 10 (schema-as-contract) — `gate schema` is the
  authoritative agent-facing contract, so the gap mainly hurts
  audience #3 (humans reading `--help`) and audience #2 (AI agents
  that read text help instead of the schema dump).
