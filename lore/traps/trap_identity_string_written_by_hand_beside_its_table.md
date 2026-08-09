---
relevant_until: indefinite
---

# trap: an identity string hand-written beside the table it describes

**Pattern.** A component advertises what it is — a capability list, a
feature string, a supported-verb enumeration, a schema version — as a
**hand-maintained literal that sits next to the structure it
summarizes**. The structure and its summary are two places. They agree
on the day they are written, and they drift on every day after,
because only one of them is load-bearing at runtime.

"Ledgers rot" is already a stated stance in this codebase. This trap
is the specific, mechanizable form: *the ledger rots even when it lives
in the same file as its subject* — proximity is not a binding. What
binds is derivation.

Observed (2026-08-05→07, `exp/03-wasm-userland` dogfood, outside this
repo): a runtime advertised its own capability surface at boot —

```
engine id: windows=20(print,fd_write,…,__eris_on_sigchld) feat=sandbox,nonrec,sched,budget,…
```

The first version hand-wrote the `feat=` tags. Two capabilities
(`setjmp` / `longjmp`) had shipped without being added to the string,
so the engine under-reported itself. The repair was not "remember to
update the string": the host-function table became the **single source
for both** the runtime resolver and the identity generator. Adding a
capability now updates resolution and self-description in one edit —
they cannot diverge, because there is nothing left to keep in sync.
The declared count (`windows=N`) is emitted from the table's length; no
number is typed by a human anywhere.

The guard that pins it is the interesting part: it asserts
**table ↔ identity agreement generically** — every entry's name appears
in the emitted id, and the resolver returns a handle for it — with no
magic constant of its own. A guard written as "expect
`windows=20`" would have been one more hand-written literal, and would
have re-created the trap inside the check.

## Trigger conditions for review

Flag any change that adds or edits:

- **A literal count, list, or version string that restates a structure
  in the same file or module.** `verbs: ['request','approve',…]` beside
  the handler registry; a `capabilities:` array beside the capability
  implementations; `windows=20`.
- **A doc table enumerating a runtime surface** where the runtime
  surface is separately enumerable. This repo already treats this as a
  live risk — `tests/docs/pluginSchemaDocSync.test.ts` exists precisely
  to bind `docs/plugin-schema.md` to the shipped contract. Extend that
  reflex to new tables rather than adding untethered ones.
- **A test that pins the summary with its own hardcoded literal.** The
  check must derive its expectation from the same structure the code
  derives from; otherwise the literal has merely moved into the test.

## Fix shape

- **One structure, two derivations.** Resolution and self-description
  read the same table. Adding an entry updates both by construction.
- **Emit counts, never type them.** `windows=N` comes from
  `table.length`.
- **Write the guard generically.** Iterate the table and assert each
  entry is reachable in the projection; assert no magic number.

## Where this bites in `guild-cli` specifically

`gate schema` is the principle-11 contract: it must advertise the core
surface exhaustively so a cold AI agent discovers everything available.
That makes `gate schema` an identity string in exactly this sense —
the thing most worth deriving and least safe to hand-maintain. The
`source: 'core' | 'plugin'` discriminator has the same property: it is
a claim *about* the registry, and it should come *from* the registry.

## Promotion history

Single observation (external dogfood, `exp/03-wasm-userland`,
2026-08-07). Pinned rather than promoted. A second independent sighting
would most plausibly come from `gate schema` or the doc-sync tests; if
it does, this trap and the existing "ledgers rot" stance likely merge
into one principle about derived-vs-declared surfaces.
