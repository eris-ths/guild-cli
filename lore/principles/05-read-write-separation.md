# Read/write separation

**Read verbs never mutate. Write verbs always do. The surface
reflects this.**

## Statement

Every gate verb sits cleanly on one side of a read/write divide:

- **Read verbs** (`boot`, `suggest`, `show`, `voices`, `tail`,
  `chain`, `transcript`, `status`, `doctor`, `schema`, `whoami`,
  `resume`, `list`, `pending`, `board`): no side effects. They
  can be called any number of times, in any order, without
  changing the content_root.

- **Write verbs** (`request`, `approve`, `deny`, `execute`,
  `complete`, `fail`, `review`, `thank`, `fast-track`,
  `register`, `message`, `broadcast`, issues.*, `repair`): each
  one appends to the record. Calling them changes state.

This split is load-bearing for agent safety: an agent exploring
a content_root should be able to read freely without fear of
mutation. A write verb's call *must* feel different from a read
verb's call.

## Why structured surface

`boot.verbs_available_now` (added on `claude/ax-explore` at
`7f74520`) makes this divide explicit in the payload:

```json
"verbs_available_now": {
  "actionable": [  // write verbs valid NOW with target ids
    { "verb": "approve", "id": "...", "reason": "..." },
    { "verb": "execute", "id": "...", "reason": "..." }
  ],
  "always_readable": [  // read verbs, always safe
    "boot", "suggest", "show", "voices", "tail", ...
  ]
}
```

An agent looking at this output can see at a glance: "these
verbs change state, those just observe." The separation is a
fact of the response, not something to remember.

## In practice

- **Dry-run is the bridge.** `--dry-run` on write verbs emits
  the mutation preview without persisting — a read-style call
  with write semantics available for inspection. Documented for
  agents that want "what would this do?" without commitment.
- **Errors obey the same discipline.** A read verb's error
  means the read failed, never that state was partially
  mutated. A write verb's error means the write did not persist
  (optimistic-lock conflicts, validation failures, etc.).

## Implications

- **Never fold a side effect into a read verb.** It feels
  tempting to have `gate show` mark something as "seen" or log
  a read-event. Don't. The read's purity is the contract.
- **Every new verb declares its side.** When adding a new verb,
  its category in `src/interface/gate/handlers/schema.ts` must be
  explicit (`read` / `write` / `admin` / `meta`). The schema
  test enforces this.

## Related

- `principles/02-advisory-not-directive.md` — agents dispatching
  write verbs blindly is the exact risk that makes this
  separation important.
- `principles/04-records-outlive-writers.md` — the append-only
  discipline that makes writes honest is what makes reads safe.
