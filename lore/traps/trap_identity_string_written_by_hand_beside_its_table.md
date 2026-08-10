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
  live risk, and its existing answer is the model to copy:
  `tests/docs/pluginSchemaDocSync.test.ts` (#283) binds
  `docs/plugin-schema.md` to the shipped contract **bidirectionally** —
  a new `Request` getter that appears in neither the doc tables nor the
  explicit "intentionally undocumented" list fails, *and* a
  `request.NAME` reference in the doc with no matching getter fails.
  It reads the emitted `.d.ts` rather than a hand-kept list, so the
  expectation is derived from the same structure the code is. That is
  exactly the fix shape below, already shipped. Extend the reflex to
  new tables rather than adding untethered ones.
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

First observation: external dogfood, `exp/03-wasm-userland`, 2026-08-07
(the `feat=` capability string above).

Second observation, **inside this repo**, 2026-08-10: the tier tally in
`src/interface/gate/help.ts`. The prediction logged here was that a
second sighting would come from `gate schema` or the doc-sync tests. It
did not — it came from a *doc comment*, which is the cheapest place to
write a summary and the one place nothing checks. Three copies existed
and all three disagreed with the shipped table: the tier headline said
BASE was 14 and COORDINATION 5, the enumeration below it said
COORDINATION 6, `gateHelpTiered.test.ts` pinned a hand-typed list of 15,
and 17 verbs actually rendered. The test literal is the part worth
noting — this file already warned that a check with its own hardcoded
expectation has merely moved the literal, and that is exactly what had
happened, written before anyone looked.

Repaired the same way as the first sighting: the counts and lists are
gone from the prose, and the tests derive their sets from
`visibleVerbs()`. Deriving immediately paid for itself by failing on
something the hand-written list had been hiding — `visibleVerbs()`
reported `--version` as a verb, because its token regex admitted a
leading `-`. A literal list cannot surface that class of bug; it
encodes the answer instead of asking for it.

One caveat carried forward: a derived expectation can pass **vacuously**.
If the derivation returns an empty set, every `for (const v of SET)`
assertion becomes a no-op and the suite goes green having checked
nothing — the failure mode `reachability-audit` calls an empty green.
The tests now pin the derived sets as non-empty and disjoint before
using them.

Two independent observations, both felt rather than read. Per
`lore/README.md` this clears the promotion bar; whether it merges with
the existing "ledgers rot" stance into one principle about
derived-vs-declared surfaces is a doctrine call, deliberately left to a
separate decision rather than taken here.
