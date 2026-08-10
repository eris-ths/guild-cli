**Principle 17 — restatement binds to structure, or it rots.**

Graduates `trap_identity_string_written_by_hand_beside_its_table` after
a fourth independent sighting. The trap file stays in place with the
mechanism and reviewer trigger conditions; the principle carries the
stance.

The first three sightings were copies that drifted. The fourth is why
this is a principle rather than a longer trap: the **check** was itself
a copy. `verbs-consistency.test.ts` compared `verbs.ts` against a
hand-written mirror inside the test, both had forgotten
`gate swarm-status`, and the suite stayed green while the entry
middleware took a write lock for a read-only verb.

> Two restatements that agree prove nothing. They can agree by both
> omitting the same thing — the likely failure, not the unlucky one,
> since whoever forgets the first copy is the same person updating the
> second.

The obligation: every restatement is derived, bound by a check against
the structure itself, or explicitly named as unbound. The deciding
question when a check passes is **"checked against what?"**

Principle 10 (schema as contract) is now framed as one instance of 17 —
which is why `gate schema` matched the dispatcher exactly on the day
all three hand-maintained lists did not.

Stale counts removed rather than incremented, per the principle itself:
`lore/README.md` said "read all fourteen" with sixteen shipped, and
`examples/quick-start/README.md` said "the 14 principles". Both now
point at the directory.
