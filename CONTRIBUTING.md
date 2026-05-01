# Contributing to guild-cli

Most of the contributing surface is already covered:

- [`README.md`](./README.md) — install, build, test
- [`AGENT.md`](./AGENT.md) — verb reference for AI agents
- [`docs/POLICY.md`](./docs/POLICY.md) — stability contract (which
  layers may change without notice; which require a minor bump)
- [`docs/verbs.md`](./docs/verbs.md) — per-verb examples and design
  notes
- [`SECURITY.md`](./SECURITY.md) — threat model, trust assumptions

This file covers the disciplines that don't fit cleanly into any of
those: workflow expectations that affect *how* changes land,
not what they do.

## Voice budget

The project holds an explicit budget on the named pedagogical
phrases that appear in the running source — phrases like `"all
first-class"`, `"DETECTOR, not an enforcer"`, `"advisory — override
freely"`. The budget is enforced by
[`tests/interface/voiceBudget.test.ts`](./tests/interface/voiceBudget.test.ts);
the principle behind it is named in
[`lore/principles/08-voice-as-doctrine.md`](./lore/principles/08-voice-as-doctrine.md).

### Why this exists

Voice — the prose in `suggested_next.reason`, schema descriptions,
footers, doctor finding messages — is how principle reaches readers
who don't read `lore/`. It is the substrate by which advisory framing
(02), legibility costs (03), and perception-not-judgement (07) reach
the loop that won't stop to read a markdown file. The budget protects
that substrate from drift.

### When you'll trip the budget

You'll trip the budget when you:

- Add a new advisory string in a handler that includes a phrase
  already used elsewhere in the source (e.g. you want to write
  `"all first-class"` in a third file).
- Add a new pedagogical phrase that should be tracked (e.g. you
  introduce a new doctrine surface that ships with a distinctive
  utterance).

The test will fail with the phrase, the file:line locations, and
this pointer.

### What to do

In the same PR that adds the surface:

1. Open
   [`tests/interface/voiceBudget.test.ts`](./tests/interface/voiceBudget.test.ts).
2. Either:
   - **Increase the budget** of an existing entry, adding the new
     file to `allowed_files`, and update its `rationale` field with
     one sentence explaining why this surface genuinely requires
     the phrase rather than paraphrasing it.
   - **Add a new entry** with phrase / budget / allowed_files /
     rationale, and a one-paragraph `rationale` that reads as if it
     were addressing a future contributor asking "why this phrase?"

The PR description should reference the budget update with one line
naming the new phrase or the surface added. Reviewers will ask
"could this surface have reused an existing phrase, or paraphrased
itself out of needing this one?" — both are legitimate. The test
exists to make those questions visible at the point of decision.

### What this discipline does NOT catch

- **Paraphrase.** Replacing a named pedagogical phrase with a
  synonymous one passes the test while violating principle 08's
  intent. This is LLM-difficult to detect verbatim. The discipline
  relies on code review for paraphrase escapes; the standing
  observation place for drift is principle 08 itself — when the
  trade-off shifts, the next revision lands there.
- **Untracked prose.** Most prose in the codebase is not in
  `VOICE_BUDGET`. The budget covers only phrases that have crossed
  the "this is doctrine" threshold. Adding new prose that isn't
  pedagogical doesn't trip the test, by design.

## Other expectations

- **No domain-layer changes without a minor-version note** — see
  POLICY.md.
- **Tests run on Node 20 and 22** — the CI matrix exercises both;
  changes that depend on Node 22-only features will fail Node 20
  jobs.
- **Lore changes follow the same write-once-then-revise discipline
  as records** — principles in `lore/principles/` are appended,
  not edited in place. Significant revisions to an existing
  principle should land as a new principle that supersedes (with a
  cross-link), not as a rewrite.
