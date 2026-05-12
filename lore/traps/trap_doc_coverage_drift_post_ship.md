---
relevant_until: indefinite
---

# trap: prose-doc coverage drift after a new verb ships

**Pattern.** A new verb passes CI and merges. The dispatcher
works, `gate schema --format json` exposes it, `gate --help` may
or may not list it (see `trap_help_text_drift_on_new_verb`),
CHANGELOG has an entry, and the verb is **fully shipped from a
runtime standpoint**.

But the prose layer — `docs/verbs.md`, `AGENT.md`, `README.md`,
`docs/playbook.md`, `docs/concepts-for-newcomers.md`,
`README.ja.md` — is hand-curated and does not auto-update. The
default trajectory is: new verb → its tests are present → CHANGELOG
entry is present → **no prose-doc entry anywhere**.

A reader looking up "what read-side verbs exist?" via `grep -r
'^### ' docs/verbs.md` will not find the verb. A reader of
`AGENT.md`'s Reading block will see an outdated list. A reader of
`README.ja.md` (which is structurally independent, not a
mechanical translation of `README.md`) will see a yet-older shape.

Surfaced (2026-05-12 doc audit): six new read verbs across the
2026-05 ship arc (`gate decisions`, `self-pattern`, `lense-stats`,
`flow-suggest`, `review-context`, `wave-status`, plus the
`resume --with-doctor` flag) had **zero** prose-doc coverage. The
gap was caught by the audit, not by CI.

## Trigger conditions for review

Flag any merged PR that:

- Adds an entry to `src/interface/gate/handlers/schema.ts` (the
  schema registry is updated) but does **not** touch any of:
  `docs/verbs.md`, `AGENT.md`, `README.md`, `README.ja.md`,
  `docs/concepts-for-newcomers.md`, `docs/playbook.md`,
  `docs/swarm.md`.
- Adds a new file under `src/interface/gate/handlers/` without a
  corresponding "Added" entry in a prose doc.
- Updates `CHANGELOG.md` with a new `### Added` bullet that
  references a verb whose first occurrence in `docs/verbs.md` is
  also in the same PR (good case) vs no occurrence at all (bad
  case, this trap).

## Honest mitigation

Two paths, both partial:

1. **PR checklist item**: "If this PR adds a verb, did you update
   `docs/verbs.md` and `AGENT.md`?" — relies on author discipline.
   Catches genuinely-forgotten cases; doesn't catch "I'll do the
   docs in a follow-up" intentions that never come.
2. **Soft CI lint**: warn (not block) if `src/interface/gate/handlers/*.ts`
   added without `docs/*.md` modified in the same PR. Same
   limitation — author can bypass with intent.

Neither is bulletproof. The real fix is **audience priority
clarity**: per [principle 11](../principles/11-ai-first-human-as-projection.md),
AI agents are the primary audience (`gate schema` is the source of
truth), with humans-as-projection the secondary surface. The drift
this trap names mainly hurts the human-readable layer; the AI-
agent contract stays consistent because `gate schema` is exhaustive
by construction.

**Decision rule**: a prose-doc update is required when the verb is
likely to be read by a human onboarding to the tool (README's
"30-second tour" verbs, playbook combos). For dogfood-only verbs
that AI agents will primarily reach through `gate schema`,
shipping without immediate prose-doc updates is acceptable.

## Why this is `indefinite`

The pattern is rooted in the medium (hand-curated prose docs vs
machine-generated schema) and recurs whenever a new audience-#3-
relevant verb ships. Mitigation is discipline, not a code fix.

## Related

- `lore/traps/trap_help_text_drift_on_new_verb.md` — sibling for
  the `--help` text gap (different surface, same shape of drift).
- principle 11 (ai-first-human-as-projection) — explicitly permits
  the audience-#3 surface to lag behind audience-#1 and audience-#2
  surfaces. This trap is the operational form of that principle:
  the lag is expected, but should be observed and closed in
  periodic doc sweeps rather than left forever.
