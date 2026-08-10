`gate swarm-status` was missing from `src/interface/gate/verbs.ts`, so
the entry middleware's fail-safe classified this read-only verb as a
WRITE and took a write lock for it. Added to `READ_VERBS`.

It was invisible because `tests/interface/verbs-consistency.test.ts`
compared `verbs.ts` against a **hand-curated mirror** rather than
against the dispatcher, and the verb was absent from both — two lists
agreeing by forgetting the same thing. The test now derives each
passage's verb set from the `case '<verb>':` labels in its `index.ts`,
with a non-empty floor so a broken parse cannot turn the checks into
vacuous passes.

Four verbs (`lore`, `next`, `rom`, `voice`) had also fallen out of
`KNOWN_COMMANDS`, each losing its did-you-mean suggestion. Restored,
and now pinned by the same derived check.
