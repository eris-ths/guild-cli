# Design — `RomPlugin`: a bounded extension shape that declares its cost and its capabilities

Status: **Design proposal, contract-only.** No implementation is
proposed in this document and no engine is proposed for vendoring. The
deliverable being argued for is a *wire contract* that `guild-cli`
owns, plus the discipline that makes it worth owning.

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
    "out_fnv1a": "0x8f2ad431"            // determinism anchor for the output itself
  },
  "capabilities": {
    "declared": 20,                      // what the engine offered
    "used": 3,                           // what this run actually touched  (illustrative)
    "used_names": [
      { "name": "fd_write", "count": 12 },
      { "name": "fd_read",  "count":  1 },
      { "name": "proc_exit","count":  1 }
    ]
  }
}
```

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

### How a wave records it

The natural landing site is the existing lifecycle trace: an
`after:`-phase record on the wave, holding the envelope verbatim. That
gives `gate transcript` a structured row where today an extension's
participation is invisible, and gives principle 16's self-optimization
axis its first genuinely typed observation — the `s_t` tuple that
section asks for is much closer to hand when cost and capability are
already numbers.

Deliberately left open: whether the envelope is stored inline on the
request record, referenced by digest, or emitted as a distinct
substrate kind. `docs/storage-format.md` does not currently state a
general per-record size discipline — the only bound it names is the
inbox FIFO cap (`MAX_INBOX_SIZE`) — so this choice would be *setting* a
precedent rather than following one. That is a reason to settle it with
a dogfood observation rather than in advance.

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
