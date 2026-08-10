# Restatement binds to structure, or it rots

**Anything that restates a structure — a count, a list, a summary, a
schema, a doc table, a test's expected value — must be *derived from*
that structure or *checked against* it. Checking a restatement against
another restatement is not checking.**

## Statement

Code accumulates second copies of things it already knows. A tally in
a header comment. A `KNOWN_COMMANDS` array beside the switch it
mirrors. A doc table enumerating a runtime surface. A test pinning the
answer as a literal. Each copy is written true and stays true only
until the next edit that touches one side.

That much is folk wisdom — "ledgers rot." The part that is not folk
wisdom, and the reason this is a principle rather than a caution, is
the failure mode that survives an apparently diligent team:

> **Two restatements that agree prove nothing.** They can agree by both
> omitting the same thing — and that is the *likely* failure, not the
> unlucky one, because whoever forgets the first copy is the same
> person updating the second.

A check written against another hand-maintained list inherits exactly
the blind spot it was built to catch. It runs, it passes, and it
reports on nothing. The green is indistinguishable from a green that
means something, which is what makes this worse than having no check
at all: the absent check leaves you uncertain, the vacuous one leaves
you confident.

## The obligation

For each restatement, one of these must hold:

1. **Derived.** It is computed from the structure at build or run
   time, so the two cannot disagree. *Emit counts, never type them.*
2. **Bound.** A check compares it to the structure itself — the
   registry, the switch, the emitted `.d.ts`, the running CLI — and
   fails loudly on divergence.
3. **Named as unbound.** If neither is practical (a design document in
   another repository; a narrative summary), say so in the file, and
   state which side was actually consulted the last time anyone
   checked.

The third option is not a loophole. It is the honest disclosure that
principle 03 (legibility costs) asks for: an unbound restatement is a
silence, and silences get labelled.

## The test that decides it

When you see a check pass, ask one question:

> **Checked against what?**

If the answer is another list a human maintains, the check is
decorative. If the answer is the structure, it is a guard.

Two corollaries worth stating because both were violated in practice:

- **A guard must be able to fail.** Derive the expected set, then pin
  it non-empty before using it — a derivation that returns nothing
  turns every assertion into a no-op and the suite goes green having
  checked nothing (`reachability-audit`'s *empty green*).
- **Read the structure, not the prose about the structure.** A header
  comment claiming "this list is checked against the dispatcher" is
  itself a restatement. It was wrong.

## Relationship to other principles

**Principle 10 (schema as contract) is one instance of this
principle.** `gate schema` restates the runtime's dispatch surface;
10 says bind them, and `schemaInputDriftDetector` is the binding.
This principle names the general shape 10 is a special case of —
which is why 10 held while every unbound restatement around it
drifted. On 2026-08-10, measured against the dispatcher's 51 `case`
labels: `gate schema` matched exactly; the three hand-maintained
lists (`verbs.ts`, a test's mirror, `KNOWN_COMMANDS`) did not.

**Principle 04 (records outlive writers)** is why the stakes are
asymmetric. A restatement outlives the moment it was true, and the
reader who inherits it has no way to tell a fresh copy from a stale
one. Binding is what lets a record be trusted by someone who wasn't
there.

**Principle 03 (legibility costs)** supplies the third option above:
where binding is impossible, the absence gets a label.

**Principle 11 (AI-first)** sharpens why this matters more here than
in most codebases. An agent reading a stale surface has no instinct
that something looks off; it wires against the copy and trusts it at
runtime. Human readers occasionally sense staleness. Agents do not.

## What this principle is NOT

- **Not a ban on hand-written lists.** A hand-enumerated list checked
  against the structure is a fixture and is often clearer than a
  clever derivation. The rule is about the *check*, not the authoring.
- **Not a demand that every comment be mechanically verified.** Prose
  explaining *why* is not a restatement of a structure. This principle
  governs copies of *what*: names, counts, members, shapes.
- **Not satisfied by proximity.** Keeping the summary next to its
  subject does not bind them. The first observation below was a
  capability string emitted three lines from the table it described.

## Promotion history

Four independent observations, all felt rather than read. The trap
memory this graduates from —
`lore/traps/trap_identity_string_written_by_hand_beside_its_table.md`
— stays in place with the mechanism and the trigger conditions a
reviewer would use.

1. **2026-08-07, external dogfood** (`exp/03-wasm-userland`). A
   runtime hand-wrote its own `feat=` capability string; two shipped
   capabilities were missing from it. Repaired by making the
   host-function table the single source for both resolution and
   self-description.
2. **2026-08-10, inside this repo.** The tier tally in
   `src/interface/gate/help.ts` — three copies, all three disagreeing
   with the shipped table, plus a test pinning a fourth hand-typed
   list. Deriving from `visibleVerbs()` immediately failed on a bug
   the literal had been hiding (`--version` reported as a verb).
3. **2026-08-10, across a repository boundary.**
   `docs/design/rom-plugin.md` documented an envelope field with a
   `0x` prefix the engine never emits; a parser written from the
   document rejected every real envelope. Caught only by writing the
   checker from the emitter instead.
4. **2026-08-10, the one that made this a principle.**
   `verbs-consistency.test.ts` compared `verbs.ts` against a mirror
   *inside the test*. `gate swarm-status` was absent from both, so the
   test was green while the entry middleware took a write lock for a
   read-only verb. The trap file had, hours earlier, cited this very
   test as the reassuring counter-example — a claim read off the
   test's header comment rather than off what the test compared.

The fourth is the one that generalizes. The first three are "a copy
drifted." The fourth is "the *check* was a copy," and no amount of
diligence about the first kind prevents it.

## Held to itself

Naming this principle broke four tests, which is the best evidence it
was worth naming.

`tests/scripts/loreScope.test.ts` asserted `files.length === 14` and
`=== 16`, and its header said, in as many words: *"Counts shift when a
new principle lands. If you add principle 17, bump the swarm/all
asserts here."* Principle 17 landed and the counts went stale in the
same commit that forbade them. Bumping would have been obedience to
the comment and disobedience to the principle.

The repair reads `applies_to:` frontmatter from the files and compares
**set membership**, not size — a second, independent implementation of
the rule the shell script implements, so agreement between them is a
differential check rather than a copy agreeing with itself. Set
equality also catches what counting cannot: *the right number of the
wrong files*. Mutation-tested both ways: a script that ignores its
audience reddens 3, a script that emits nothing reddens 5. The old
count assertions would have caught only the second, and only as an
off-by-N.

Two more instances were repaired by deletion rather than increment:
`lore/README.md` said "read all fourteen" with sixteen shipped, and
`examples/quick-start/README.md` said "the 14 principles". Both now
ask the directory.

A number beside a list has no correct value — only a currently-true
one. If you find yourself updating one, the fix is to remove it.
