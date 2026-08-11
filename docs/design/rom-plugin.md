# Design — `RomPlugin`: a bounded extension shape that declares its cost and its capabilities

Status: **Contract implemented and recorded; v1 fully specified.** No
engine is proposed for vendoring, and none is shipped. The deliverable
argued for here is a *wire contract* that `guild-cli` owns, plus the
discipline that makes it worth owning.

Since 2026-08-10 the contract is executable rather than prose:
`src/domain/rom/RomEnvelope.ts` parses and validates a v1 envelope,
`gate rom verify <file|->` is its entry point, and `gate rom record`
appends the result to `observations/` — a substrate kind of its own
(§ How a wave records it). That closes the gap between this document's
central argument — "a `v` field with a specified meaning can be
violated **loudly** instead of silently" — and what the repository
could actually do, which was nothing: prose cannot fail.

On 2026-08-11 the three blocks the reference engine emits beyond the
originally documented key set — `policy`, `timeline`, `exit` — were
specified from stored runs (§ Enforcement, causality and outcome). The
documented key set and the wire now agree.

## Problem recap

Two statements already in this repository do not sit comfortably
together.

`SECURITY.md` § Plugin trust model, on what a plugin is:

> Every plugin is loaded as an ES module via Node's `import()` and runs
> **in the main process** with full Node.js capabilities — file system,
> network, child processes, environment access. There is **no
> sandboxing**. […] The model is "whitelist by author", not "vet by
> review".

`lore/principles/16-substrate-as-replay-corpus.md`, on what makes a
substrate replayable — three properties that must hold *together*:

> 1. **declarative source** […] 2. **deterministic interpreter** —
> given the same source, the interpreter produces the same observable
> behavior […] 3. **persisted trace**

`guild-cli` holds (1) and (3) firmly: request YAML is the declarative
source, `requests/completed/*.yaml` is the persisted trace. For (2) the
principle points outward, to Atelier's Lua sandbox and to AutoTTS's
replay environment. **The substrate does not own a deterministic
interpreter, and its actual extension mechanism is the opposite of
one**: arbitrary Node with ambient authority, unbounded cost, and no
record of what it touched.

So the two statements meet at a specific gap. The moment an extension
participates in a wave, the wave's trace stops being replayable —
the plugin's effect is neither bounded, nor reproducible, nor
described.

A third pressure comes from `lore/principles/15`, which names the
consequence it could not yet resolve:

> **Plugin lifecycle gaps.** `VerbPlugin` / `HookPlugin` / `VoicePlugin`
> are request-scoped: load on CLI invocation, exit on return.
> Long-running daemons or cross-request state caches are not
> expressible today.

## What is proposed

A fourth plugin shape, **`RomPlugin`**, defined entirely as a contract:

> A `RomPlugin` is an artifact executed by an external engine that,
> in the same act as execution, returns a machine-readable report of
> **(a)** the capability surface it was granted, **(b)** the subset of
> that surface it actually used, **(c)** a deterministic cost, and
> **(d)** a fingerprint of its output.

`guild-cli` specifies the report envelope and how a wave records it.
`guild-cli` does **not** ship an engine, does not bundle a WebAssembly
runtime, and takes no new runtime dependency. This is the principle-12
split: the substrate is a pure module; the interpreter is somebody
else's module.

### Non-goals

- **Not a sandbox for existing plugin types.** `VerbPlugin` /
  `HookPlugin` / `VoicePlugin` keep their current trust model. This
  adds a shape for extensions whose authors *want* to be bounded; it
  does not retroactively confine the ones that are not.
- **Not a replacement for `trusted: true`.** Consent still gates
  loading. What changes is that consent stops being the *only* control.
- **Not an engine specification.** Any engine that can emit the
  envelope qualifies. WebAssembly is the obvious substrate but nothing
  in the contract requires it.

## The contract

The envelope below is not invented for this document. It is the report
a working engine already emits, in the field, today — the `[agent]`
line from the engine published inside
[`eris-ths/cartridge`](https://github.com/eris-ths/cartridge)
(`engine/`, public). Standardizing an existing wire format rather than
designing a new one is deliberate: the format has running code on both
sides of it, and its stability has been measured (see § Provenance).

**The key set below is the contract; the values are illustrative.** Only
`cost.instrs` and `engine.windows` / `engine.feat` are reproduced from
recorded runs — the remaining numbers are placeholders shaped like real
ones, and should not be read as measurements.

Two corrections landed 2026-08-10, both found by validating this
document against the engine's emitter rather than against itself:

- `io.out_fnv1a` was printed here with a `0x` prefix the engine does not
  emit. Fixed below. A placeholder may have an invented *value*; it must
  not have an invented *shape*.
- The engine also emits blocks this document did not describe. That gap
  is now closed — see § Enforcement, causality and outcome below. It
  was wider than the note that used to sit here claimed: the note named
  `policy` alone, and the wire carries **`policy`, `timeline` and
  `exit`**. A summary of an undocumented surface is itself an
  undocumented surface.

```jsonc
{
  "v": 1,
  "engine": {
    "windows": 20,                       // size of the declared capability surface
    "names": ["fd_write", "fd_read", "clock_time_get", "path_open", "…"],
    "feat": "sandbox,nonrec,sched,budget,cov,reap,setjmp,longjmp,spawn,wait,sigchld"
  },
  "cost": {
    "instrs": 1812458726,                // deterministic: same artifact ⇒ same number
    "hostcalls": 41,                     // (illustrative)
    "mempeak_pages": 528,                // (illustrative)
    "mode": "verify"
  },
  "io": {
    "out_bytes": 230415,                 // (illustrative)
    "out_fnv1a": "8f2ad431"              // determinism anchor: 32-bit FNV-1a,
                                         // bare zero-padded hex, no 0x prefix
  },
  "capabilities": {
    "declared": 20,                      // what the engine offered
    "used": 3,                           // what this run actually touched  (illustrative)
    "used_names": [
      { "name": "fd_write", "count": 12 },
      { "name": "fd_read",  "count":  1 },
      { "name": "proc_exit","count":  1 }
    ]
  },

  // ── optional blocks ──────────────────────────────────────────────
  // Absent means "not reported", never "reported as nothing". An
  // engine that observes without enforcing omits `policy` entirely.
  "policy": {
    "enforced": true,                    // false ⇒ granted/denied/stopped_at MUST be absent
    "granted": ["fd_write", "fd_read", "proc_exit"],
    "denied":  [{ "name": "path_open", "count": 1 }],
    "stopped_at": { "window": "path_open", "instr": 41221, "hostcall": 42 }
  },
  "timeline": [                          // first touch of each window, in order
    { "seq": 1, "window": "fd_write",  "denied": false },
    { "seq": 2, "window": "fd_read",   "denied": false },
    { "seq": 3, "window": "proc_exit", "denied": false },
    { "seq": 4, "window": "path_open", "denied": true  }
  ],
  "exit": { "trapped": true, "exited": false, "code": 0 }
}
```

The optional blocks above are internally consistent with the rest of
the example — `granted` covers exactly `used_names`, `timeline` covers
every used and denied window, and the stop is one of the denials —
because the invariants in § Enforcement below would reject them
otherwise. The one deliberate looseness is the `"…"` elision in
`engine.names`: with it, this document's example is illustrative and
not literally parseable.

**The parseable example is `validFull()` in
`tests/domain/RomEnvelope.test.ts`.** Copy from there, not from here.
A reader who needs a conforming envelope should take one that a parser
accepts on every run, rather than one a human kept true by hand — this
document's `0x8f2ad431` was wrong for months by exactly that mechanism.

Three properties of this envelope are what make it worth adopting, and
each answers one of the pressures above.

**`capabilities.declared ⊇ capabilities.used`, reported per run.** The
plugin's authority stops being a matter of the author's reputation and
becomes an observed quantity. `SECURITY.md`'s "whitelist by author" is
a policy about *who wrote it*; this is a measurement of *what it did*.
The two are complementary, and only the second survives the case that
makes reputation-based trust fragile — a long-trusted author, or a
long-trusted author's compromised account, shipping one changed
release.

**`cost.instrs` is deterministic, not wall-clock.** Same artifact,
same number, on any host. This is what upgrades the trace from a log
into a replay corpus: principle 16's claim that "replaying reduces to
table-lookup, not re-execution" only holds if the recorded cost is a
property of the artifact rather than of the machine that ran it. A
deterministic instruction count is also the only honest basis for a
*budget* — an extension can be cut off at a reproducible point rather
than at a timeout that differs per host.

**`io.out_fnv1a` anchors the output.** "The same thing came out" becomes
checkable without a human comparing bytes, which is what lets a wave
record carry the claim rather than the payload.

### Enforcement, causality and outcome

Specified 2026-08-11. These three blocks were on the wire from the
start and outside the contract until now — accepted as unknown keys by
`gate rom verify`, and preserved verbatim by `gate rom record` in
`ObservationBody.extra`. That preservation is why they could be
specified from **stored runs** rather than from prose, which is the
right direction and the one this document got wrong twice before.

All three are **optional**. `guild-cli` owns the contract and no
engine, so an engine that observes without enforcing conforms. What is
refused is a *present but hollow* block: absence is a legible silence,
a partial block is a silence shaped like an answer.

#### `policy` — what the run was allowed to touch

`capabilities` is an observation: what this run touched, out of what
the engine offers. `policy` is a claim of a different kind — what the
run was *permitted* to touch, and whether it tried to go further.

| field | when | meaning |
|---|---|---|
| `enforced` | always | whether a grant set was in force |
| `granted` | iff `enforced` | window names the run was permitted to call |
| `denied` | iff `enforced` | `{name, count}` for each window called and refused |
| `stopped_at` | optional | `{window, instr, hostcall}` of the **first** refusal |

**The granted set is fixed for the run.** A single list cannot describe
an authority that changes mid-run, so an engine that revokes
dynamically is outside this contract rather than quietly
under-describing itself with it. Several invariants depend on this.

Checked (`parsePolicy`):

- `granted` and every `denied[].name` appear in `engine.names` — an
  engine cannot grant or refuse what it does not offer.
- `granted ∩ denied = ∅` — being refused a window you hold is a
  contradiction, not a rare event.
- **`capabilities.used_names ⊆ granted`.** This is the block's reason
  to exist. `used ⊆ declared` is already checked against
  `engine.names`; under enforcement the binding surface is the grant
  set, which is *narrower*. An engine reporting a used window it never
  granted is reporting that its own enforcement leaked — and that is
  invisible to every count comparison, because the arithmetic stays
  consistent throughout.
- `stopped_at.window` appears in `denied` — a run cannot stop on a
  refusal it did not report.
- `enforced: false` ⇒ `granted` / `denied` / `stopped_at` **absent**. A
  grant list under no enforcement describes a restriction that is not
  in force, and a reader would take the narrower surface as the true
  one.

`denied[].count` of `0` is refused, on the same rule `used_names`
follows: a thing that did not happen has no entry.

#### `timeline` — first touch, in order

`[{seq, window, denied}]`, where `seq` runs `1..N` with no gaps. This
is causality where `capabilities` is a tally: *which window first, and
where did it stop*.

**Emit it complete or omit it.** A truncated timeline is
indistinguishable from a complete one at the reading end, which is the
exact silence this envelope exists to remove. An engine with a bounded
buffer it might overflow should send no `timeline` rather than a
prefix. The parser enforces the choice: every window in `used_names`
and in `policy.denied` must appear, and a well-formed prefix — valid
names, contiguous `seq`, no duplicates — is rejected on completeness.

The `denied` flag restates `policy.denied`; the two are checked against
each other rather than left for a reader to pick whichever they saw
first.

#### `exit` — how the run ended

`{trapped, exited, code}`. `trapped` and `exited` are mutually
exclusive by the meaning of the words; both false means the run
returned normally. `code` is non-negative, `0` by WASI convention for
anything that did not call `proc_exit`.

#### Why the invariants and not just the shape

Shape checking is the cheap half. Everything above is a place where the
envelope states the same fact twice and the two copies can disagree —
`granted` against `used_names`, `timeline` against `policy.denied`,
`stopped_at` against `denied`. The redundancy is the engine's, and it
is useful precisely because it is redundant: **a self-report whose two
halves disagree is a self-report to distrust.** An engine that wanted
to lie would have to lie consistently across all of them, which is a
higher bar than emitting one flattering number.

### How a wave records it

The natural landing site is the existing lifecycle trace: an
`after:`-phase record on the wave, holding the envelope verbatim. That
gives `gate transcript` a structured row where today an extension's
participation is invisible, and gives principle 16's self-optimization
axis its first genuinely typed observation — the `s_t` tuple that
section asks for is much closer to hand when cost and capability are
already numbers.

**Status: settled 2026-08-10.** Of the three options that used to be
listed here — inline on the request record, referenced by digest, or a
distinct substrate kind — the third was taken.

`observations/` is a substrate kind of its own, alongside `requests/`,
`issues/`, `agora/` and `ctx/`:

```
gate rom record <file|-> [--for <request-id>]   # validate, then append
gate rom list [--for <request-id>]              # oldest first
gate rom show <o-id>                            # one observation in full
```

Records are `observations/o-YYYY-MM-DD-NNNN.yaml`, append-only, with
**no state machine and no `save`** — only `saveNew`. The absence is the
invariant: an observation is a report of something that already
happened, and nothing that already happened changes later. Because
there is no update path there is no write race, and therefore no
version field and no compare-and-swap. The store's shape *is* the
machine/human distinction rather than a flag inside a shared one.

The link to a wave is one-directional. `subject` names the request an
observation belongs to; the request does not list its observations. A
wave record is closed when it completes, and letting later machine
output mutate it would make a terminal record non-terminal. Readers
join from the observation side.

Two consequences worth stating, because both were reasons to prefer
this over inline storage:

- **Size discipline stays unset, and stops mattering here.** The
  concern that motivated the digest-reference option was per-record
  growth on the request. A separate kind sidesteps it: an envelope is
  as large as it is, in its own file, and `docs/storage-format.md` did
  not have to invent a general bound to accommodate it.
- **Hydrate re-validates.** The envelope goes back through
  `parseRomEnvelope` on read, so a record hand-edited on disk into an
  inconsistent state fails when someone reads it, not merely when it
  was written. Validation on write is not a property of the file.

What is still open is narrower than the section it replaces: nothing
consumes observations yet beyond `list` / `show`. `gate transcript`
does not join them into the wave's story, and principle 16's `s_t`
tuple remains a thing the data would support rather than a thing the
code emits.

## Provenance of the reference implementation

Honesty about the reference matters more than usual here, because the
argument above leans on "this already works."

- The engine is public: `eris-ths/cartridge`, `engine/`. It ships with
  a `PROVENANCE.md` that names its origin and pins SHA-256 fingerprints
  of the files it was copied from, and its build script **checks those
  fingerprints and says so when they no longer match** — without
  blocking the build, on the stated grounds that rot should be detected
  while the judgment stays with a person.
- That copy is **not** the canonical source. The canonical source is a
  private experiment (`exp/03-wasm-userland`), and the two have
  diverged substantially — the published copy is a pre-refactor
  monolith; the canonical side has since split into separate modules
  and grown additional capability windows.
- **The envelope itself has not diverged at all.** The function that
  emits it (`reportAgent`, 90 lines) is **byte-identical** on both
  sides — not merely same-keyed, same-versioned, or compatible.
  Measured 2026-08-09 by extracting the function from each tree and
  comparing (`cmp`, zero difference).

That last point is the actual argument for standardizing this
particular shape: two implementations drifted by thousands of lines —
across a module split and a set of added capabilities — and the
reporting surface between them did not move by one byte. A contract
that survives that is a contract worth writing down, and writing it
down here is what turns an accident into a guarantee: a `v` field with
a specified meaning can be violated loudly instead of silently.

The honest caveat is that byte-identity across a fork is *evidence of
stability, not proof of it* — the two trees share an ancestor and one
author. What it rules out is the failure mode that matters most here:
a contract that looks stable only because nobody has stressed it. This
one has been carried through a refactor that rewrote its surroundings.

It also sets the boundary correctly. `guild-cli` depending on a
*contract* is durable; `guild-cli` depending on a *copy of an engine
whose canonical source is private* would import someone else's drift.
The contract is the public artifact. The engine stays where it is.

## Risks and open questions

- **A fourth plugin type widens the surface `gate schema` must
  describe.** Principle 15 already notes that plugin verbs are
  explicitly outside the principle-11 contract; a `RomPlugin` report
  is *evidence about a run*, not a verb, so it likely belongs in the
  record schema rather than the verb schema. Worth confirming before
  implementation.
- **`declared ⊇ used` describes, it does not enforce.** A run that
  reports touching the filesystem has still touched the filesystem. The
  enforcement story is the engine's (refuse to offer the window at
  all); the substrate's story is that the touch is now *on the record*.
  This document should not be read as claiming more than that.
- **Determinism is a property of the engine, and the substrate cannot
  verify it.** `guild-cli` can record `instrs`; it cannot confirm the
  number is reproducible. The mitigation is the one already used for
  every other extension claim — an engine that lies is an engine you
  chose to trust — but the failure mode is now *observable across runs*
  rather than invisible, which is a strict improvement over the status
  quo.
- **No second dogfood observation yet.** Per `lore/README.md`'s
  promotion bar, the underlying discipline is currently pinned as
  traps, not principles: `trap_baseline_moves_with_its_subject`,
  `trap_guard_measured_by_running_not_by_failing`,
  `trap_identity_string_written_by_hand_beside_its_table`. If a second
  independent sighting lands inside `guild-cli`, the "bounded extension
  declares its cost and capabilities" stance is a principle candidate.

## Related

- `SECURITY.md` § Plugin trust model — the gap this addresses.
- `lore/principles/15-plugins-as-default-extension.md` — plugin-first
  routing, and the lifecycle gap this shape speaks to.
- `lore/principles/16-substrate-as-replay-corpus.md` — the missing
  deterministic-interpreter leg.
- `lore/principles/12-substrate-pure-module-in-projection-ecosystem.md`
  — why the engine stays outside.
- `docs/plugin-schema.md` — the existing Verb / Hook / Voice contracts
  this would sit beside.
