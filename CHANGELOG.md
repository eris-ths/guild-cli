# Changelog

All notable changes to `guild-cli` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to the versioning policy described in [docs/POLICY.md](./docs/POLICY.md).

<!--
New entries DO NOT belong in the `## [Unreleased]` block below.

Drop a fragment file under `.changelog/next/<category>-<slug>.md`
instead. The release script at `scripts/changelog-release.mjs`
collects fragments at release time and rewrites the [Unreleased]
block into a `## [<version>] - <date>` heading. See
`.changelog/README.md` for the format.

Why fragments: every PR adding to one shared `[Unreleased]` block
collided on the section anchor — even the previous "append to end"
rule produced duplicate `### Fixed` sub-headings inside one
[Unreleased] when two PRs raced. Per-PR filenames make textual
conflicts impossible.

The block below is the pre-fragment backlog. Future PRs MUST NOT
edit it directly — the release script folds it into the next
versioned block alongside collected fragments.
-->

## [Unreleased]

_Add entries by dropping a file under `.changelog/next/` (see `.changelog/README.md`). The release script collects them into a versioned block at `npm run changelog:release -- <ver>`._

## [0.8.0] - 2026-09-03

### Migration

**No action required.** This is a minor bump because the stable `domain/`
surface changed (`docs/POLICY.md` § *Stable surface*): `Request` gained an
optional readonly `supersedes` field (#462). The change is additive:

- Records written before 0.8.0 load unchanged — the field is simply absent.
- A record written by 0.8.0 *without* `--supersedes` serializes exactly as
  0.7.x wrote it: the key is omitted, not emitted as `null`. Verified against
  a 2213-record content_root, where the 2146 records that carry no correction
  link round-trip byte-identical.
- Embedders building against `domain/` gain one new optional property on
  `Request`. No existing field changed shape or meaning, and no state
  transition was added or removed.

### Changed

- `gate --help` on `profile: standard` now lists `issues` and `why`. Both had
  been `--all`-only: `gate boot` advertises `open_issues` on the default
  surface while the verb that acts on it was hidden, and `review` was BASE
  while the verb that renders review outcomes was not. Measured on a
  single-operator content root, `issues` was the most-invoked verb in the
  session and reachable only through the full catalog.

- `gate issues note` accepts `--note`, and `gate issues resolve|defer|start|
  reopen` accept `--text`. Both sub-verbs attach free-form prose to an issue
  under two different flag names, so the spelling learned from one bounced off
  the other with `unknown flag`. Canonical names are unchanged; each now takes
  its sibling's as an alias.

- `GUILD_MAX_DIR_ENTRIES` now overrides the per-directory scan cap (default
  1000, ceiling 100000). A long-lived `content_root` outgrows the default
  legitimately — one dogfood instance passed 1096 completed requests — and the
  choice used to be "list blind" or "archive today". Malformed values throw
  rather than falling back to the default, so a typo cannot silently restore
  the truncated listing this cap was already fixed for once. The overflow
  warning now names the effective cap and the env var. OKF bundle import reads
  the same effective value, so import can never be stricter than the store.

**The ROM envelope contract has been checked against the running
engine, not only against its source.**

`policy` / `timeline` / `exit` were specified by reading the reference
engine's emitter. They have now been validated against its *output*:
two runs, both harnesses, including a run under enforcement where a
window was refused and the ROM trapped.

The measurement that matters: `ObservationBody.extra` was **empty** for
both records. Every top-level key the engine emits is owned by the
contract — the documented key set and the wire agree, measured rather
than asserted. This document had been wrong about that twice before.

Recorded in `docs/design/rom-plugin.md` § Measured against the running
engine, with the reproduction command and an explicit statement of what
the measurement does *not* show.

### Added

`tests/docs/agentVerbCoverage.test.ts` — pins AGENT.md against
`gate schema`.

Both `README.md` and `docs/verbs.md` tell readers that AGENT.md carries
every verb, and `docs/verbs.md` is explicitly partial *because* of that
promise. The promise was prose, and prose cannot fail: AGENT.md was
missing four verbs (`next`, `swarm-status`, `lore`, `rom`), three of
them long-standing.

All four are now documented, including a new § ROM reports section, and
the check derives its expectation from the CLI rather than from a
checked-in list.

Direction is one-way on purpose — every schema verb must appear in
AGENT.md, but a `gate foo` string in AGENT.md with no schema entry is
not flagged, since the file legitimately shows composed shell examples.

- **`gate doctor --format json` now carries `content_root` and
  `config_file`.** The text and `--summary` surfaces disclose the
  resolved root only when it is surprising (cwd outside the root, or
  no config found); a structured consumer has no such notion and
  needs to know which root produced the counts on every run. Both
  fields are unconditional; `config_file` is `null` on the
  cwd-as-fallback path, matching `gate boot`'s `hints.config_file`.
  Additive — `gate doctor --format json | gate repair` is unaffected.

**`observations/` — a fifth substrate kind, for machine-emitted facts.**

`gate rom record <file|->` validates a v1 `RomPlugin` envelope and
appends an Observation; `gate rom list [--for <request-id>]` and
`gate rom show <o-id>` read them back.

Why a separate store rather than a field on the request record: the
four existing kinds all record something a *person* did or decided, and
all are built around transitions. An observation has no author's intent
and no state machine — it is a fact about a run that already happened,
so it cannot be reviewed, superseded, or transitioned. Keeping
measurements in `requests/` (as `fast-track` records, which is what was
happening) forced every projection of "what was decided" to filter them
back out by prefix-matching the action string — a hand-written literal
in the projection layer. With a separate store the machine/human
discriminator is **structural**: everything under
`<paths.observations>/` is machine-origin by construction.

Details worth knowing:

- **Append-only by port shape.** `ObservationRepository` exposes
  `saveNew` and no `save`; with no update path there is nothing to race
  over, so no version/CAS machinery exists either.
- **Envelope keys outside the v1 contract are preserved verbatim.** The
  reference engine emits a `policy` block the contract does not
  describe, carrying `denied` — the windows a ROM *tried* to reach and
  was refused. Storing only the contract fields would discard the most
  security-relevant thing in the report.
- **Re-validated on read.** A record hand-edited on disk into an
  inconsistent state fails when it is read, not merely when it was
  written — "recorded means verified" has to be true for the reader.
- **One-directional link.** An observation names its `subject` request;
  the request does not list its observations, so a completed wave stays
  terminal. Join from this side with `--for`.

Config: `paths.observations` (default `observations/`).
Format: `docs/storage-format.md` § Observation.

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

**ROM envelope v1: `policy`, `timeline` and `exit` are now specified.**

The reference engine emitted all three from the start; the contract
described none of them. They were accepted as unknown keys and stored
verbatim in `ObservationBody.extra`, which is why they could be
specified from **recorded runs** rather than from the design document —
the document named only `policy`, and had already been wrong once about
a field it did restate.

All three are optional (`guild-cli` owns the contract and no engine, so
an engine that observes without enforcing conforms). What is refused is
a *present but hollow* block.

The invariant worth the work is `capabilities.used_names ⊆
policy.granted` under `enforced: true`. `used ⊆ declared` was already
checked against `engine.names`; under enforcement the binding surface
is the grant set, which is narrower. An engine reporting a used window
it never granted is reporting that its own enforcement leaked — and the
arithmetic stays consistent throughout, so no count comparison can see
it. `timeline` must be complete or absent: a truncated one is
indistinguishable from a whole one at the reading end.

`gate rom verify` now reports enforcement state, denials and the stop
location, and distinguishes an absent `policy` ("no enforcement claim")
from `enforced: false` ("every declared window was permitted").

Two shape restatements were bound rather than updated, per principle
17. `ROM_CONTRACT_KEYS` moved to the module that owns the contract and
is checked against the keys the parser returns; `romEnvelopeToJSON` is
checked by round-trip. The second guard was written because that
serializer had *already* been dropping the three blocks — they parsed,
they validated, and then they did not reach disk.

`gate rom verify <file|->` — validates a v1 `RomPlugin` report envelope
(`docs/design/rom-plugin.md`), which until now existed only as prose.

Beyond shape, it checks the places where the envelope restates a fact
twice and the two copies can drift: `engine.names.length ===
engine.windows`, `capabilities.declared === engine.windows`,
`capabilities.used === used_names.length`, and — the one that matters —
every used window **by name** present in `engine.names`. Comparing only
counts would accept a run that touched windows the engine never
offered, which is the exact claim the envelope exists to make checkable.

Accepts a bare JSON document or a run log carrying the envelope on one
line; no engine-specific prefix is assumed, so the substrate stays
independent of any one engine. Read-only — where a verified envelope
should be *recorded* on a wave is still deliberately open.

Hidden from default help (`extra` tier); present in `gate schema`.

`--supersedes <id>` on `gate request` / `gate fast-track` — a
forward-only link to an older request this one corrects.

Principle 04 has stated the shape since it was written ("a correction is
a new record that references the old"), and the `ctx` passage has
shipped `ctx supersede` for a while. `gate` never had it, so corrections
lived in `action` prose: measured against a 2213-record content_root,
67 records (3.0%) name an older id in prose that no reader can traverse
mechanically. That is principle 17 — a restatement bound to nothing.

The old record is never mutated; both stay in the ledger. A target that
does not exist is refused at the write boundary, before any id is
allocated, so a bad link never leaves a half-written record behind.

Deliberately absent: an inverse `superseded_by` field (it would mutate
an immutable record) and any taxonomy of correction kinds (`--reason`
carries which of the four shapes applies). `gate show <old-id>` stays
silent about corrections that point at it — closing that costs a full
scan, 0.11s to 0.91s on the measured root, and belongs on `gate chain`.

### Fixed

**`devil entry --severity` no longer advertises values it rejects.**

The usage line read `<c|h|m|l|info>`: four initials and one full word,
which reads as a literal list and is not one. The parser accepts
`critical|high|medium|low|info`. Found by being rejected while
recording a devil review with `--severity med`.

Fixed by derivation rather than by rewriting the string —
`VALID_SEVERITIES` is exported and the help joins it, so the two cannot
disagree again. The passage's "11 verbs" headline is now derived from
the verb sets for the same reason; that one happened to be correct,
which is exactly why it was worth binding before it stopped being.

**A non-contract envelope key named `__proto__` is no longer silently
discarded.**

`extractRomExtra` built its result with `out[k] = v`. For `k ===
"__proto__"` that routes through the prototype setter: the value became
the object's prototype instead of one of its keys, `Object.keys`
reported nothing, and the function returned `undefined` — dropping
every non-contract key in the envelope, not just that one.

Reachable from engine output rather than only from a hand-built object:
`JSON.parse` produces an own `__proto__` property. No global prototype
was ever at risk (the target is a fresh literal), so this is silent
data loss rather than prototype pollution — in the one function whose
purpose is to not lose things. Now built with `Object.fromEntries`,
which defines own properties.

- `gate --help` documents `gate review --note`. It had shown only `--comment`,
  which the runtime already reports as a deprecated alias — following the help
  guaranteed a deprecation notice. The deprecated spelling is still accepted and
  is now labelled as such in the help body.

**`gate request --reason -` no longer loses the reason.**

The stdin read was written twice: once while resolving the optional
`--reason` for the `--template` / `--from-agora` paths, and again
inside the plain-request branch. The first drained the stream, the
second returned `""`, and the wave failed as `reason required` with the
author's text already consumed. The failure looked like a missing flag.

`gate fast-track --reason -` reads once and always worked, which is
what let this survive: the two verbs share the flag, the docs and the
wrapper's advice, and only one of them was ever exercised. Both are now
pinned by a test that round-trips the reason through the store.

**`gate rom list` no longer reports unreadable records as absence.**

A record that fails hydrate is skipped by design — one corrupt file
must not take down a read — but the skip warned on stderr while stdout
said "no rom observations recorded yet." A reader piping stdout was
told the opposite of the truth.

`rom list` now reports how many files on disk could not be read, and
withholds the emptiness claim when any were. `--format json` carries an
`unreadable` count, so machine readers get the same distinction rather
than a softer one.

This became reachable when `policy` moved from `extra` into the
contract: hydrate re-validates on every read, so a record written while
a block was unspecified can stop being readable the day it is
specified. No such records exist yet — the next block promoted will not
have that luxury.

`--flag -` (read the value from stdin) now works on every prose flag in
`agora` and `ctx`, not just on `gate`.

The sentinel was wired handler-by-handler on `gate` — round 3 of the
dogfood sweep closed `gate message` and `gate broadcast`, which had been
accepting the token and storing the literal `-`. The same gap was still
open everywhere outside `gate`: `agora move --text -`,
`agora suspend --cliff -/--invitation -`, `agora conclude/resume
--note -`, and `ctx record/supersede --fact -` all wrote a one-character
body and exited 0.

That failure mode is expensive in proportion to how much the record
mattered. A downstream house used the convention for a day and lost 18
`agora` moves and 9 `ctx` facts — including the handoff move written for
a context compaction, i.e. the one record that existed *because* no
other copy would survive. Nothing surfaced at write time; `agora last`
after the compaction was the first signal.

`src/interface/shared/stdinSentinel.ts` now holds the shared resolver,
so a passage that grows a prose flag inherits the behaviour instead of
re-deriving it. It adds two guards over the plain `if (v === '-')`
shape:

- **at most one sentinel per invocation** — there is one stdin, and
  `agora suspend --cliff - --invitation -` cannot be satisfied; feeding
  the same bytes to both would be worse than refusing;
- **a blank body is refused** — an empty pipe would otherwise reproduce
  the silent-empty record the wiring exists to prevent.

`gate` is deliberately untouched in this change: `gate rom` and
`gate repair` already treat `-` as a *JSON* input they read themselves,
so they are not prose-flag surfaces. Their empty-stdin behaviour is a
separate question from this fix.

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

- A voice plugin may now omit `verbs`. The loader had required it, contradicting
  the documented contract that all four sections are optional, so a voice that
  only curated `essentials` was rejected. `gate --help --essentials` also
  swallowed that rejection and rendered the plain profile help, leaving no way
  to see the reason short of importing the loader by hand — loader rejections
  are now reported on stderr, naming the file and the cause. Help still renders
  either way: a broken voice degrades the surface, it never blocks it.

<!-- carried over from pre-fragment [Unreleased] -->

_Add entries by dropping a file under `.changelog/next/` (see `.changelog/README.md`). The release script collects them into a versioned block at `npm run changelog:release -- <ver>`._

## [0.7.2] - 2026-08-01

### Changed

- **`guild --help` now discloses the four passages.** `guild` is the
  admin-side helper for managing actors, so its help listed only
  member-management verbs — an agent that entered via `guild` had no
  in-CLI path to the passages where the work actually happens
  (orientation-disclosure gap, principle 09). The help now names
  `gate` / `agora` / `devil` / `ctx` with their one-line shape and a
  `<passage> --help` pointer, and points a newcomer at `gate --help`
  and `AGENT.md`. Member-management docs are unchanged. Surfaced by a
  "what if the entry point is guild, not gate?" walkthrough.

### Added

- **`ctx chain <id>` — the second phase-2 ctx verb (read-side).** Shows
  the one-hop neighborhood of a fact so a reader can follow related
  observations without grepping the substrate. It walks four edge kinds
  from a single read: **outbound** (ctx ids the root's prose mentions, each
  resolved to its fact or surfaced as `(referenced but not found)` rather
  than dropped), **inbound** (facts whose prose mentions the root),
  **supersedes** (the fact the root corrects), and **superseded by** (the
  facts that correct the root — a fork shows more than one). One hop only,
  like `gate chain`: to go deeper, run `ctx chain` on a surfaced id. A
  missing root is a recoverable not-found; an isolated fact reports an
  empty neighborhood rather than an error.
- The shared id scanner `extractReferences` (also behind `gate chain`) now
  recognizes the `ctx-YYYY-MM-DD-NNN` id shape as a third kind alongside
  request and issue ids, returned in a new `ctxIds` field. This also fixes
  a latent mis-classification: the leading boundary allowed a hyphen, so a
  `ctx-…` (or `i-…`) id's digits could leak into `requestIds`; capturing
  the prefix keeps the three kinds disjoint. `gate chain` behavior is
  unchanged (it does not surface ctx ids). Remaining phase-2 verbs: `fork`
  / `status`.

- **`gate issues promote` now accepts `--format json|text`.** It is a
  write verb but previously had no `--format`, so an agent couldn't
  receive the created request id as JSON — a schema-as-contract gap
  (principle 10), since every other write verb returns the unified
  `ok` / `id` / `state` / `message` / `suggested_next` envelope. promote
  now shares that envelope via `emitWriteResponse`, so its JSON shape is
  stable with `gate request`. The resolved-issue id rides in `message`
  (`✓ promoted i-… → … (issue resolved)`), so both the new request id and
  the resolved issue id stay greppable from the structured output
  (records-outlive-writers). Text output is unchanged; no `--format`
  defaults to text (back-compatible). Surfaced by a playbook dogfood pass.

- **`gate_board` — the example MCP server now speaks the MCP Apps extension
  (`io.modelcontextprotocol/ui`).** The tool carries
  `_meta.ui.resourceUri` pointing at a `ui://gate/board` resource, so hosts
  that implement the extension render the decision history as an
  interactive board inline in the conversation instead of a wall of text.
  The board shows request id, passage kind, actor, timestamp, action,
  reason, and completion note per record. Hosts without the extension
  ignore `_meta` and get `gate_board` as a plain text tool, so nothing
  breaks — support is per-client (as of 2026-07-31 the published client
  matrix lists Claude web/Desktop, VS Code Copilot, Cursor and ChatGPT
  among others; Claude Code is not listed).
- The board reads `gate tail --format json` rather than parsing text
  output, following principle 11: the substrate is the contract and text is
  a human projection. The HTML is self-contained (no CDN) because MCP Apps
  cannot reach external origins unless they are declared in `_meta.ui.csp`,
  and because an example should not grow dependencies.
- **`gate` remains the source of truth.** This adds a window, not a
  migration: no existing tool, verb, or substrate shape changed. The board
  is read-only and does the one thing the CLI cannot — put "who decided
  what, and why" next to the conversation that led there.
- Substrate values are HTML-escaped before they reach `innerHTML`, and the
  embedded JSON escapes `</` so an action or reason containing markup
  cannot break out of the page.

### Fixed

- **Record listings no longer drop the newest records in silence.**
  `MAX_DIR_ENTRIES` (1000) is a memory guard, but four repositories applied
  it with a bare `.slice(0, MAX_DIR_ENTRIES)`. A long-lived content_root
  *does* reach that ceiling — a dogfood instance hit 1006 completed requests
  and `gate list` / `gate tail` began returning exit 0 with a short list.
  Records written seconds earlier were absent with no error, no warning and
  no exit code; `gate show <id>` still returned them, so the writes had
  succeeded and only the listings had gone blind. Worse, it dropped the
  wrong end: ids are date-prefixed and the scan is ordered, so slicing from
  the front discarded the *newest* records — precisely what `tail` exists to
  show and what a session had just written, while a stale 1000-record window
  survived. Listings now go through `capDirEntries`, which keeps the cap,
  takes it from the end so the newest records always survive, preserves
  ascending order for callers, and warns on stderr naming the directory, the
  real entry count and how many older entries were dropped. Affects
  `requests/<state>`, `issues`, `members` and `sessions`. The OKF bundle
  reader already threw on the same condition; this closes the gap where one
  constant was loud in one place and mute in four others.

<!-- carried over from pre-fragment [Unreleased] -->

_Add entries by dropping a file under `.changelog/next/` (see `.changelog/README.md`). The release script collects them into a versioned block at `npm run changelog:release -- <ver>`._

## [0.7.1] - 2026-06-23

### Changed

- **`changelog-release` now also bumps the `version` field in
  `package.json` and `package-lock.json` (root + `packages[""]`) to the
  release version**, in the same step that rewrites `CHANGELOG.md`.
  Previously the script only touched the changelog, so a release had to
  remember to bump the manifests by hand — and the 0.7.0 release didn't,
  leaving `package-lock.json` at `0.6.0` until CI's version-drift guard
  caught it (#442). The bump is a byte-stable text replacement (only the
  version line(s) move), and `--dry-run`/`changelog:preview` reports the
  would-bump without writing. `.changelog/README.md` documents the new
  release step and the annotated `vX.Y.Z` tag convention. (#441/#442
  follow-up.)

- **`changelog-release` now refuses to run when `.changelog/next/` holds
  a file with an unrecognized category, instead of warning and silently
  leaving it behind.** A `docs-foo.md` (no `docs` category exists) used to
  be `warn`ed-and-skipped while the release still exited 0 — the entry was
  dropped on the floor and the orphan lingered for every future release
  ("silence reads as success"). The script now collects such files as
  *orphans* and exits 1 with a per-file list and the fix (rename to a
  valid category, or delete — docs-only changes have no fragment). The
  same guard fires under `--dry-run`/`changelog:preview`, so a
  mis-categorized fragment surfaces before release. `.changelog/README.md`
  documents that docs-only changes get no fragment. (#441, surfaced by the
  0.7.0 release dogfood.)

### Added

- **`ctx supersede <old-id> --fact "..."` — the first phase-2 ctx verb.**
  ctx records are immutable on save, so a correction is not an in-place
  edit: `supersede` records a **new** fact whose `supersedes` field points
  back at the one it replaces. The old record is never mutated, so the
  ledger keeps both and the supersession is reconstructable from the
  forward-only link alone. `ctx list` now folds superseded facts out by
  default (showing the current head of each chain) and gains `--all` to
  keep every fact, marking the superseded ones; `ctx show <old-id>` stays
  readable and resolves the reverse link at read time as `superseded_by`, an
  **array** of successor ids (empty while current, more than one when two
  independent corrections fork the same fact — both are reported rather than
  silently picking one). A chain is allowed (C supersedes B supersedes A)
  and stays acyclic — every link points strictly backward to an id that
  already existed, and the domain rejects a self-supersession outright;
  since the newest fact can never be superseded, a non-empty store always
  keeps at least one current head. Superseding an id with no record is a
  recoverable not-found (a correction must point at something real). The
  `supersedes` key is omitted from an ordinary record's YAML, so phase-1
  records round-trip byte-for-byte. Remaining phase-2 verbs: `fork` /
  `chain` / `status`.

<!-- carried over from pre-fragment [Unreleased] -->

_Add entries by dropping a file under `.changelog/next/` (see `.changelog/README.md`). The release script collects them into a versioned block at `npm run changelog:release -- <ver>`._

## [0.7.0] - 2026-06-22

### Changed

- **`ctx` OKF hardening — collision-safe import + export overwrite guard.**
  Two follow-ups from the OKF round-trip review (#431): (1) on import, a
  foreign `id` that collides with an existing record but carries
  *different* prose is now reallocated a fresh id instead of being
  dropped — the idempotent skip is gated on a prose match, so a distinct
  observation reusing the `ctx-YYYY-MM-DD-NNN` namespace is never
  silently lost (records-outlive-writers). The incumbent is read on
  demand only on a collision, so the common path stays a single id-set
  check. (2) `ctx export` refuses a non-empty target directory unless
  `--force`, so it can't silently clobber an unrelated tree.

- **`ctx import` tags type-less docs `okf:none`.** OKF requires a
  `type` on every concept; import stays tolerant (a frontmatter-less or
  `type`-empty `.md` still records — its body is the fact) but now tags
  such a doc `okf:none` instead of letting it pass as a plain Fact. A
  stray non-concept file in a bundle (a README, a note) is therefore
  auditable after the fact via `ctx list --tag okf:none`, rather than
  being indistinguishable from a real guild fact. The marker is `none`,
  not `untyped`: a real type literally named "Untyped" slugs to
  `okf:untyped`, so using `untyped` for the missing-type marker would
  collide the two and defeat the audit; `none` is not a plausible OKF
  concept type and stays unambiguous. A document with a usable
  type is unchanged (`Fact` stays tag-clean; other types keep their
  `okf:<type>` provenance tag). Also clarifies, in help and the docs, that
  prose dedup matches on a **trim + whitespace-collapse only — case and
  punctuation are significant** (it catches a markdown re-wrap, not a
  hand-edited copy).

- **`ctx <phase-2 verb>` now gives a roadmap-aware message.** Typing a
  verb that the help / docs name as "arriving in phase 2" (`fork` /
  `supersede` / `show` / `list` / `chain` / `status`) used to produce the
  same bare `unknown verb` a typo gets. It now says the verb is *planned
  for phase 2, not yet implemented* and points at the phase-1 surface
  (`record` / `export` / `import`). Genuine typos still get the
  did-you-mean suggestion. Surfaced by dogfooding ctx from a user's
  perspective.

- **`gate complete` (from approved) and `gate deny` (from executing) now
  redirect by verb name**, completing the verb-shape redirect family
  alongside the existing `fail`-from-pending/approved and the
  `execute`-from-pending cases. Scoped (per a dev-substrate agora play) to
  the two transitions with a clean single-verb bridge:
  - `gate complete` on an *approved* request → names `gate execute`
    (start the work first), recovery `{verb:"execute"}`.
  - `gate deny` on an *executing* request → names `gate fail` (deny is the
    *pending* cancel path; once work has started, fail is the cancel),
    recovery `{verb:"fail"}`; the dry-run path redirects identically.
  Deliberately left on the domain's state-name hint: `complete`-on-pending
  (recovery is multi-step approve→execute→complete, no single verb) and
  `deny`-on-approved (no clean cancel verb exists from approved). State
  vocabulary stays in the domain; the verb hint is an interface concern.

- **`gate execute` on a pending request now redirects to `gate approve`
  by name.** The domain rejects `pending → executing` with a state-name
  hint ("valid next states from pending: approved, denied"), leaving a
  caller who skipped approve to translate "approved" back into a verb.
  `reqExecute` now pre-checks the pending state and throws a
  `RecoverableError` naming the bridge directly — prose `error:` line
  plus a structured `error.recovery: {verb:"approve", args:{id}, …}` for
  JSON consumers. This mirrors the existing `gate fail`-from-pending
  (→ `deny`) and `gate fail`-from-approved (→ `execute`) redirects; the
  dry-run path redirects identically rather than throwing the bare
  domain hint. State vocabulary stays in the domain (RequestState.ts);
  the verb hint stays an interface concern.

- **`gate boot` / `gate status` / `gate doctor`: the misconfigured-cwd
  warning no longer asserts "not a fresh start".** On a genuine fresh
  clone (the dogfood substrate's `guild.config.yaml` is local-only, so a
  fresh checkout always lands here) the block read "likely wrong cwd, not
  a fresh start" while boot's own `→ next:` hint said `gate register` —
  a self-contradiction. The block now reads "either the wrong cwd, or a
  fresh start here" and offers the `gate register --name <you>` escape
  hatch alongside the cd-elsewhere fix, aligning both surfaces. (This
  also closes the `formatContentRootDisclosure` arm of
  `trap_silent_fallback_loses_signal`: a fallback disclosure now carries a
  recovery `next:` cue instead of reading as noise.)

- **README `30 seconds`: install entry now 3-tier + shell-portable
  GUILD_ACTOR.** R19 first-impression dogfood (yuki / asteria /
  miki) surfaced two doc papercuts that the prior block left to the
  reader:
  - The leading `npm install` looked clone-first by default, with
    `npx gate` / `npm i -g` buried in a blockquote — newcomers
    repeatedly missed the "use inside an existing repo" path. The
    block now presents three explicit install styles (A clone, B
    drop-in dev-dep, C one-off npx) so the reader picks before
    running anything.
  - The `export GUILD_ACTOR=` line was bash-shaped only; fish and
    PowerShell readers had to mentally re-translate. The exports
    for all three shells now sit inline as comments under the
    POSIX form.
- **README config warning: "no `guild.config.yaml`? no problem" is
  now leading prose, not the overcautious "pick a name distinct
  from `host_names:`" warning the dogfood read as gatekeeping.**
  The substrate already handles the config-less path with a clear
  `notice: config: none — cwd used as fallback root` line; the
  README now says that *before* getting into the host-name
  collision detail, which is now framed as "if you do add a
  config" rather than "before you start".
- **`AGENT.md`: explicit "humans welcome" preface.** R19 dogfood
  (yuki) found the "AI-agent-first" framing read as a membership
  tier to first-time human readers. The preface now reframes it as
  "documentation density choice, not membership tier" — humans and
  AI share a content_root, share a trail, share the same verbs.

- **README: `gate fast-track` is now glossed where the "30 seconds" loop
  first uses it.** The quick-start told newcomers to run `gate fast-track`
  but the verb was absent from the "the whole tool is six verbs" list and
  never defined — so the loop you're told to run and the loop you're shown
  didn't line up. An inline comment plus a one-line note now explain that
  fast-track collapses request → approve → execute for the self-flow case,
  while the six verbs remain the full deliberation loop.
- **README: the Passages note says *why* agora / devil / ctx run via
  `node ./bin/<name>.mjs`.** Only `gate` and `guild` are registered as
  `bin` commands in `package.json`, so the alpha passages aren't on PATH
  even after a global install — the README now states that rather than
  leaving the reader to infer it.

- **Split `tests/interface/ax.test.ts`** (1549 lines, 56 tests — the
  largest test file) following the #421 exemplar. The four largest
  cohesive sections move into focused, well-named files sharing one
  fixture module:
  - `_axHelpers.ts` — the shared `bootstrap` + `runGate` + `rid`/`today`
  - `axSuggest.test.ts` — `gate suggest` tight-loop behavior
  - `axVerbsAvailableNow.test.ts` — `boot.verbs_available_now` discovery
  - `axVoiceCalibration.test.ts` — Two-Persona Devil voice memory
  - `axThank.test.ts` — `gate thank` appreciation primitive
  - `ax.test.ts` (trimmed, 648 lines) keeps the remaining AX affordances
    (suggested_next routing, JSON error envelope, board/show surfaces,
    advisory semantics, transcript, --plain, --dry-run, the text footer).
  Same 56 tests, no behavior change — navigability only. (`boot.test.ts`,
  the other 1.4k-line file, is the remaining follow-up.)

- **Split `tests/interface/boot.test.ts`** (1444 lines, 42 tests — the
  last of the three oversized files, after #421/Request and #422/ax).
  Its seven helpers (`bootstrap` / `runGate` / `escapeRegex` /
  `bootstrapWithMembers` / `registerMember` / `makeRequestWithTarget` /
  `makeRequestSessioned`, plus the `GATE` path) were interleaved through
  the file; they're now centralized in `_bootHelpers.ts` and the tests
  split by concern:
  - `boot.test.ts` (trimmed) — JSON-shape stability, actor/role,
    misconfigured-cwd, content_root_health, content-root disclosure, tail
  - `bootReviewedAuthored.test.ts` — the reviewed-authored surface
  - `bootOverlap.test.ts` — `active_overlapping_targets` + same-actor
    parallel-session detection (#234 / #249)
  - `bootWarnings.test.ts` — the C3 silent-fallback warnings
  Same 42 tests, no behavior change. With this the three big test files
  (Request 1158, ax 1549, boot 1444) are all decomposed.

- **`gate boot` / `gate suggest`: new `suggested_next_reason` field.**
  When `suggested_next` is `null` but the substrate has open
  (`pending` / `approved` / `executing`) requests that don't name the
  caller as executor, the field carries a one-line explanation —
  closing the asteria-dogfood gap where `status.pending.total: 1`
  next to `suggested_next: null` read as a substrate bug for a host
  who approves from `gate list --state pending` rather than through
  the suggest ladder. Field is `null` when silence is genuine. Text
  mode renders the reason inline as `(nothing urgent — <reason>)` /
  `→ (no suggestion — <reason>)`.
- **`gate register --name <n>`: host-collision error front-loads the
  fix.** The "pick a different `--name`" path is now the lead
  recovery hint; "remove from `host_names:`" is parenthetical. Lines
  up with the asteria observation that a first-time user hitting
  `nao` (a default `host_names` reservation) was reading the longer
  guidance first. README `30 seconds` block also picks up a
  one-liner: `<you>` should be distinct from `host_names:` (default
  reservations: `eris`, `nao`).

- **Per-group test scripts.** `package.json` gains `test:domain`,
  `test:application`, `test:infrastructure`, `test:interface`,
  `test:passages`, and `test:e2e` — each builds then runs only that
  subtree via `node tests/run.mjs dist/tests/<group>` (the runner already
  accepted a root argument). Iterating on one area no longer requires the
  full ~1.8k-test suite. The default `npm test` is unchanged.
- **Split the largest domain test file.** `tests/domain/Request.test.ts`
  (1158 lines, 69 tests) is broken into focused files sharing one
  fixture module: `RequestId.test.ts` (id format), `RequestSlices294.test.ts`
  (the self-contained #294 per-executor slice-closure block), and the
  trimmed `Request.test.ts` (core lifecycle / serialization / actor
  stamps), with `_requestHelpers.ts` holding the shared clock + builder.
  Same 69 tests, no behavior change — just navigability. (Exemplar for
  the remaining large files; `ax.test.ts` is left untouched here to avoid
  colliding with an in-flight change.)

### Added

- **`gate boot` cross_passage — oldest-paused alarm.** Each passage's
  orientation summary now carries `oldest_suspended_age_days` and
  `oldest_suspended_cliff` (null when nothing is paused). A bare
  `suspended` count reads the same whether the oldest pause is two hours
  or two months old, so a long-forgotten thread hides inside the count;
  surfacing the oldest pause's age plus its one-line cliff turns boot
  into a forgotten-thread alarm. Text mode renders an `↳ oldest paused
  Nd ago: <cliff>` line under the passage when the oldest pause is at
  least a day old. Found by dogfood: an agora play sat suspended 39 days
  with its conclusion intact, because re-entry only ever saw the count.
  Closes the other half of records-outlive-writers — records must also be
  *findable* on re-entry, not merely countable.

- **`ctx list` / `ctx show` — phase-1 read-side.** Facts can now be read
  back without grep. `ctx list` prints recorded facts newest-first (id,
  author, timestamp, tags, snippet); `--tag prefix:value` filters by an
  exact tag and `--by <m>` by author. `ctx list` with no records and
  `ctx list` with a filter that matches nothing give distinct messages.
  `ctx show <id>` prints one fact in full; a well-formed but absent id
  raises a not-found that names `ctx list` as the recovery (text hint +
  structured `error.recovery` in JSON), and a malformed id fails at the
  domain boundary. `list` / `show` leave the phase-2 verb set. Surfaced as
  the strongest pull toward phase 2 while dogfooding ctx.

- **`ctx export` / `ctx import` — Open Knowledge Format (OKF) round-trip.**
  ctx facts can now be projected to and recorded from
  [OKF](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/)
  bundles (a directory of `<id>.md` files: YAML frontmatter + fact prose,
  plus generated `index.md` / `log.md` views). `ctx export <dir>` writes
  the bundle; `ctx import <dir>` records it back. Guild-authored bundles
  round-trip losslessly — id, timestamp, author and tags survive, and a
  re-import is idempotent (existing ids skip). Foreign bundles import
  tolerantly: nested subtrees are walked, bare/prefixed tags are coerced
  to `prefix:value` (bare → `topic:`), a non-`Fact` type is preserved as
  an `okf:<type>` provenance tag, missing authors fall back to `--by`,
  and empty/unparseable documents are reported as skipped rather than
  failing the import. Prose dedup is on by default — a fact whose prose
  (matched on a trim + whitespace-collapse, so case and punctuation are
  significant) is already recorded (under any id, or earlier in the same
  bundle) is skipped, so even an id-less foreign bundle re-imported is a
  no-op; `--allow-duplicates` opts out. OKF is an interchange
  *projection* (principle 11), not a storage change — the on-disk
  substrate stays YAML.

- **`gate show` / `gate chain` / `gate wave-status`: not-found errors
  now honor `--format json` (#408).** Pre-#408 these surfaces
  emitted `not found: <id>\n  try 'gate list' or 'gate tail' ...`
  as free text even when the caller requested `--format json` —
  tool-use agents that pipe `gate show <id> --format json` into a
  JSON parser tripped on the prose. A new `notFoundEnvelope` helper
  in `src/interface/shared/notFoundHint.ts` renders the same
  information through the existing envelope shape used by `whoami`
  and the write-verb error path (issue #194 lineage):
  `{ok:false, error:{kind:'not_found', entity, id, message, hint}}`.
  Text and `--plain` formats are unchanged — the asymmetry the PR
  fixes is "format flag was ignored", not "format default changed".
  Unknown-command and `lore` not-found are out of scope (separate
  contract decisions; tracked in #408 discussion).

### Fixed

- **`after:review` hooks now receive the appended review on
  `ctx.extra.review`.** The review handler fired `fireAfterHook`
  without the `extra` argument, so `ctx.extra` was `undefined` for
  `after:review` subscribers — contradicting the contract documented
  in `docs/plugin-schema.md` ("`before:review` / `after:review` set
  `extra.review`"). A hook reading `ctx.extra.review.verdict` to
  route reject/concern verdicts silently saw `undefined`. The
  handler now passes the terminal (just-appended) review as
  `{ review }`, and a regression test in
  `tests/interface/hookPluginLoader.test.ts` asserts the hook
  receives `lense` / `verdict` / `comment` / `by`. (`before:review`
  carrying its own payload is tracked separately — it fires before
  the append, so the documented "appended review" shape needs a
  distinct decision.)

- **bin entries: a missing dependency is no longer misreported as an
  unbuilt `dist/`.** On a fresh clone where `tsc` had run (so `dist/`
  exists) but `npm install` had not (so `node_modules` is absent), the
  bare `yaml` import failed and every `gate`/`guild`/`agora`/`devil`/`ctx`
  invocation printed `dist/ not built (or out of date) … npm run build` —
  pointing the operator at a rebuild when the actual fix is installing
  deps. Node phrases the failure as `Cannot find package 'yaml' imported
  from <dist importer>`, so the old `/dist/` message scan misclassified
  it. The 5 inlined catch-blocks now delegate to a shared
  `bin/_lib/handleDistLoadError.mjs` that distinguishes a bare-specifier
  dependency miss (→ `dependency '<pkg>' is not installed … npm install`)
  from a genuine missing/stale `dist/` (→ unchanged build message +
  transitive-miss hint). New unit tests in
  `tests/interface/distLoadError.test.ts` pin both paths.

- **`members/`: identity resolution chain hardened (#407).** Two
  related gaps in the `members/` actor identity boundary, surfaced
  by a first-impression dogfood:
  - An empty (0-byte) or malformed `members/<name>.yaml` no longer
    promotes `<name>` to a registered actor. Previously `exists()`
    was filename-only, so `touch members/ghost.yaml` was enough for
    `gate fast-track --from ghost ...` to slip past `assertActor`
    while `whoami` already classified `ghost` as `unknown` — write
    verbs and the read-side identity surface disagreed. Both
    surfaces now follow the same parse + hydrate contract.
  - The internal `name:` field of `members/<filename>.yaml`, if
    present, must match the filename stem. A divergence (e.g.
    `members/alice.yaml` containing `name: leysia`) is now flagged
    as malformed by `hydrate` and the record is rejected — neither
    `alice` nor `leysia` resolves to member status from such a file.
    Previously yaml.name silently won, letting a write-access
    adversary (or careless operator) promote arbitrary names to
    `member` by editing the yaml internals without renaming the file.
  - `SECURITY.md` "Invariants enforced in code" gains an "Identity
    resolution chain" entry documenting the `GUILD_ACTOR` env /
    filename / yaml.name resolution rules now enforced.
  - Three new tests under
    `tests/infrastructure/hydrateErrorSurface.test.ts` cover the
    empty-file path, the divergence path, and the regression guard
    that properly-registered actors (with or without an explicit
    yaml.name) continue to work transparently.

- **`gate --help` now advertises the `list` filter as `--executor <m>`,
  matching the runtime.** The BASE catalog line showed `gate list …
  [--executors a[,b,...]]` (plural, copied from `gate request`'s
  multi-executor flag), but the `list` verb accepts only `--executor`
  (singular — "match waves naming this one executor") and rejects
  `--executors` with "unknown flag". An agent copying the advertised flag
  from `--help` hit a wall — a help-text ↔ runtime drift (principle 10 /
  `trap_help_text_drift_on_new_verb`). Help line corrected; a regression
  test pins the help and the runtime KNOWN_FLAGS to the same singular flag.

- **`gate list --state <bogus>` now enumerates the valid states instead
  of dead-ending.** It errored with a bare `Invalid state: <x>` and no
  valid set, while sibling unknown-flag errors list their valid flags — an
  asymmetric touch-feel that violated the "error + recovery path" house
  style. `reqList` now validates `--state` at the interface boundary and,
  on a miss, names the full CLI-valid set: `pending, approved, executing,
  completed, failed, denied, all` (built from the domain's `REQUEST_STATES`
  ∪ the interface-only `all` sugar, so it can't drift from the enum) plus a
  note that omitting `--state` uses the verb's default. The app-layer guard
  in `RequestUseCases.listByState` stays as defense-in-depth. State
  vocabulary lives in the domain; the CLI-facing hint is an interface
  concern — same split as the deny/execute verb redirects. Pinned by
  `tests/interface/listInvalidState.test.ts`.

- **Docs + touch-feel: `gate pending`'s filter surface is now accurate
  and self-directing.** `docs/verbs.md` had lumped `gate list` and `gate
  pending` together as accepting `--from / --executor / --auto-review /
  --for`, but `pending` is the lean "--for me" shortcut — its known flags
  are `{for, format}` and it rejects the richer filters (surfaced by a
  two-persona review red-teaming the #426/#427 docs work, which had
  reasoned about `list` in isolation). The doc now describes `list`'s full
  filter set and `pending`'s narrow one separately, pointing richer
  pending filtering at `gate list --state pending`. And the runtime
  matches the advice: `gate pending --executor <m>` (or `--from` /
  `--auto-review`) no longer dead-ends at "valid flags: --for, --format"
  — it appends `to filter pending by author/executor/reviewer, use: gate
  list --state pending …`. (`rejectUnknownFlags` gained an optional
  `hint`; only `pending` passes one, so every other verb's error is
  unchanged.) Pinned by `tests/interface/pendingFilterFlags.test.ts`.

- **Transition-redirect errors now carry `error.code` again, not just
  `error.recovery`.** `RecoverableError` (thrown by the verb-shape
  redirects: `execute`-from-pending → approve, `complete`-from-approved
  → execute, `deny`-from-executing → fail, `fail`-from-pending/approved)
  reworded the message away from the domain's "Illegal state transition"
  phrasing, so `deriveErrorCode`'s prose scan stopped classifying it and
  the JSON envelope emitted `recovery` but a `code: undefined`. An agent
  branching on `error.code` was blind to exactly the errors carrying the
  richest recovery hint (surfaced dogfooding the JSON surface as an
  orchestrator). `RecoverableError` now carries a `code` (default
  `illegal_transition`, overridable) and the envelope emits it — so every
  redirect error classifies as `illegal_transition` *and* ships a
  dispatchable `recovery`. `not_found` and the plain transition errors are
  unchanged.

- **`gate suggest` / `gate boot` no longer undercount pending when a
  self-wave is open.** A request the actor both authored and is the
  executor of (a self-wave) is deliberately kept off the suggestion
  ladder — its only open transition is a self-approve, which
  `actionableTransitions` won't nudge. But `deriveSuggestedNextNullReason`
  skipped those requests entirely, so the null-reason's pending tally
  read one lower than `boot`'s `queues: pending` line for the same
  substrate (e.g. queues showed `pending=2` while the reason said "1
  pending"). The two surfaces now reconcile: the reason carries a
  dedicated self-wave clause ("N pending request(s) you authored also
  name you as executor (self-wave) — `gate suggest` does not nudge
  self-approve …"). This also closes a silent-gap sub-case where a
  *lone* self-wave pending produced no reason at all (the not-mine total
  was zero) while `queues: pending=1` showed it — the exact "silence
  reads as a bug" failure the reason field was added to prevent.

- **Write-lifecycle not-found errors now carry the same discovery hint
  the read verbs already emit.** `gate approve` / `deny` / `execute` /
  `complete` / `fail` on a mistyped or stale id threw `Request not found:
  <id>` straight through the shared error envelope with no pointer to
  recovery — while `gate show <id>` (and the other read verbs) had carried
  `try 'gate list' or 'gate tail'` since the not-found-hint work. The two
  not-found surfaces disagreed; the write side was the worse touch-feel.
  `emitErrorEnvelope` now performs the wire-up sweep its own doc
  anticipated: a recognized `Request not found` gains the prose hint line
  plus, under `--format json`, an `error.hint` field and a structured
  `error.recovery` (`{verb: "list", …}`) — `error.message` stays clean so
  existing parsers are unaffected. Both the dry-run (plain `Error`) and
  real (`DomainError`) not-found paths are covered. Sibling passages
  (agora / devil / ctx) that share the envelope are untouched: the hint is
  attached only for the `request` entity, never stapled onto an unrelated
  `Play not found` / `Review not found`.

<!-- carried over from pre-fragment [Unreleased] -->

_Add entries by dropping a file under `.changelog/next/` (see `.changelog/README.md`). The release script collects them into a versioned block at `npm run changelog:release -- <ver>`._

## [0.6.0] - 2026-05-16

### ⚠ BREAKING

- **BREAKING (v0.6 cut, closes #239): `--executor` (singular) and the
  `executor` JSON alias are removed.** The multi-executor surface
  introduced in #230 carried both forms for a v0.6 deprecation
  window; 330 commits later the singular form is gone:
  - `gate request --executor <m>` → use `gate request --executors <m>`
  - `gate fast-track --executor <m>` → use `gate fast-track --executors <m>` (omit for self-execute)
  - `gate issues promote <id> --executor <m>` → `--executors <m>`
  - `gate show --format json | jq .executor` → read `.executors[].name`
  - `CreateRequestInput.executor: string` (domain/application) → use
    `executors: readonly string[]` (the only form accepted as input)
  Hydrate is unchanged: YAML records written before #230 with the
  legacy `executor: <string>` field still load via
  `YamlRequestRepository.hydrate` (records-outlive-writers per
  principle 04). Only the *input* surface is removed.

- **`Request.toRenderJSON()` removed.** It was a back-compat
  shim that copied `toJSON()` and added the deprecated `executor`
  key; callers (`gate show / list / board`, dry-run preview) now
  call `toJSON()` directly. The render-vs-persistence split was
  there to keep the deprecated alias from polluting on-disk
  records — with the alias gone, the separation has no reason to
  exist.

## Migration

If you have shell scripts using `--executor <m>`, replace with
`--executors <m>` (same value, plural flag). If you have tooling
parsing `gate show --format json | jq .executor`, switch to
`.executors[].name` — the field has been `executors[]` (an array
of `{name, status}` objects since #294) for the entire v0.5.x
range; the singular alias was the only thing keeping the old
shape compatible.

`agent-loop / SubAgent` callers already use `--executors` as of
PR #382 (the `executors-singular-to-plural-in-examples` sweep), so
no action is required there.

### Changed

- **Advisory fields classified ambient-by-design now name that status at
  the declaration site (#344 audit close-out).** Touched 4 fields per
  the 2026-05-15 audit: `Issue.severity`, `Issue.area`,
  `Request.sourceAgoraPlay`, `Request.template` (representing the
  template / templateVersion / gateRequiredAcknowledged trio).
  Each gets a one-paragraph comment naming the audit, its consumer
  (display-only or cold-reader audit), and why no further consumer
  is needed. `schema.ts` description for `from-agora` softened — it
  previously promised `gate chain`-style navigation that did not ship.

- **`gate decisions` no longer mis-attributes slice-fail/complete
  reasons to the `executing` row.** Issue surfaced by asteria's
  dogfood run (2026-05-16, finding D1): running `gate fail <id>
  --by X --reason "msg"` produced a `decisions` payload where the
  fail row carried the cascade auto-note (`wave failed (any-fail-
  wave-fail)`) while the **execute** row carried the actor's
  `--reason` text. Root cause: per-#294 slice-closure writes a
  second `executing` status_log stamp (with the slice note) that
  the dedupe walk collapsed into the execute row via "later wins".
  Fix: detect slice-close stamps (executing entry whose `at`
  matches the executor record's `completed_at`) and re-kind them
  to fail/complete; skip wave-cascade entries whose auto-notes
  match the domain-emitted patterns from `Request.ts:1060`.

- **`gate transcript` prose reads naturally on slice-closure
  waves.** Same root cause as the decisions fix (eris touch-feel
  2026-05-16 finding 4.4). Before:
  `Asteria moved it to executing (90ms later). Asteria moved it
  to executing (87ms later) (note: "slice done"). Asteria moved
  it to completed (0ms later) (note: "wave completed (all slices
  closed)").`
  After:
  `Asteria moved it to executing (90ms later). Asteria closed
  their slice as completed (87ms later) (note: "slice done").
  The wave completed (all slices closed) (0ms later).`
  Cold readers see one judgement per executor, plus the wave-level
  consequence as subject-less prose (no actor credited with
  writing the auto-text).

- **`gate fail` on an approved wave now surfaces the `gate execute`
  bridge.** asteria finding B1: pending → fail returned a
  RecoverableError with a `gate deny` recovery hint and the JSON
  envelope's `error.recovery` field; approved → fail returned the
  domain layer's raw `Illegal state transition: approved → failed`
  with no recovery shape at all. Same prose + structured-recovery
  discipline now applies — JSON consumers can dispatch the
  `execute` move without pattern-matching on state-machine prose.

- **`gate help` is now a sugar alias for `gate --help`.** The bare
  `help` was previously rejected as `unknown command`, costing one
  tool-call round-trip for the universal "what does this CLI do?"
  reflex (asteria finding A1). Aligns with `gate --help` / `-h`.

- **`boot.session_id_source: "unset"` replaces `null`.** Enum is
  now `['flag', 'env', 'unset']`. asteria finding A2 — null
  required readers to know whether it meant "not present yet" or
  "error". The explicit `"unset"` token is principle 10 (schema-
  as-contract / output specificity) applied at the value layer.
  Schema enum updated; tests adjusted.

- **`gate lore show <number>` resolves to the slug.** Numeric input
  (`gate lore show 11`) now matches the unique principle/trap with
  that number prefix (`11-ai-first-human-as-projection`). Cold
  readers reach for the number first; the slug-only requirement
  cost a round-trip (eris touch-feel finding 4.6). Ambiguous or
  non-numeric input falls through to the previous "not found"
  hint unchanged.

- **`--note` / `--reason` / `--action` / stake-note fields now
  declare `maxLength` in `gate schema`.** Free-form text fields
  (`MAX_TEXT = 4096`) and stake fields (`MAX_STAKE_NOTE = 80`)
  ship their domain caps via the schema envelope so AI consumers
  pre-validate before composing long payloads. asteria finding F1
  ("`--note` cap not advertised → silent truncate risk on long
  handoff messages"). Applied to gate's primary write verbs
  (approve, deny, execute, complete, fail, claim, witness);
  others inherit the same caps but advertise them less
  prominently — sweep-out is a follow-up.

- **`gate review` help example uses `--note` (the canonical flag)
  instead of `--comment` (the deprecated alias).** Drift surfaced
  by eris touch-feel finding 4.5: the same verb runs a deprecation
  notice when `--comment` is used, but the canonical example still
  showed it as the first surface. Aligned.

- **Lore broken citations removed.** Principle 12 cited
  `substrate/agora/plays/whole-repo-review/2026-05-04-001.yaml`
  (dir doesn't exist in repo); principle 04 cited
  `alexandria/orientation/PHILOSOPHY.md` (dir doesn't exist).
  Both were dangling references — the irony of principle 04
  (records-outlive-writers) carrying a citation that didn't
  outlive its writer was not lost. Principle 12 kept the
  three-voice framing but removed the file pin; principle 04 lost
  the alexandria bullet entirely (asteria findings 1 & 2).

- **Docs and `gate --help` examples now consistently use
  `--executors a[,b,c]` rather than the deprecated `--executor <m>`.**
  The singular flag is still accepted as a back-compat alias (removed
  at v0.7 per #239). Filter-side `gate list --executor <name>` keeps
  its semantically-singular spelling — only the create-side examples
  (request / fast-track / issues promote) have been swept.

- **`gate next` setup-failure errors now flow through the structured
  JSON error envelope** instead of plain-text `error: <msg>` on
  stderr. Three sites (GUILD_ACTOR not set / actor not registered /
  --confirm but verb needs extra args) used to write
  `process.stderr.write('error: ...')` + `return 1`, bypassing the
  outer-catch's `emitErrorEnvelope` helper. JSON consumers got plain
  text where every other gate verb gives them
  `{"ok":false,"error":{"message":"...","field":"...","code":"..."}}`.
  After this PR, the first two throw `DomainError(field='GUILD_ACTOR')`
  and route through the standard envelope; the third (post-plan-emit
  failure) emits the plan with `dispatched: false` and confines the
  prose hint to text mode.

- **`gate next --confirm` on a verb-needing-args now emits `dispatched: false`**
  in the plan envelope (was `dispatched: true` — misleading, since
  nothing was dispatched). Consumers branching on `dispatched` to
  decide retry semantics were getting false positives.

  Follow-up to #400's success-path notice gating: same eris-first
  cleanup applied to error paths.

- **`mcp/` moved to `examples/mcp/`.** The directory held a worked
  example of MCP integration (`gate_mcp.py`) plus two example hook
  plugins (`mcp/plugins/{doc-check,self-loop-check}.mjs`) — none of
  it is core substrate, so its top-level position misled cold readers
  about what was load-bearing. The move brings the repo root one
  step closer to the 11 → 8 dir target named in #385. Voice-budget
  test allowlist and principle 03 reference paths updated to match.

- **Shared `--format` validator (`src/interface/shared/parseFormat.ts`)
  replaces 55 inline `if format !== json && format !== text` blocks
  across gate / agora / devil / ctx handlers.** Drift surface
  collapses to a single source of truth; the validation message
  ("`--format must be 'json' or 'text', got: <raw>`") is now uniform
  across passages (previously several handlers had the reversed-order
  "text or json" variant). Helper throws `DomainError(field='format')`
  so JSON-mode callers now receive the structured envelope
  (`{"ok":false,"error":{"field":"format","code":"validation_error",…}}`)
  instead of plain text — consistent with how every OTHER error in
  the same handler renders. Single-format verbs (`gate boot`,
  `gate schema`, `gate status`, etc.) pass `'json'` as the default
  via `parseFormat(args, 'json')`. Net: −134 LOC across 55 files.

- **`notice: wrote <path>` stderr line is suppressed in JSON mode
  for `agora new`, `agora play`, `devil open`.** The path and
  config-file are already in the stdout JSON envelope
  (`where_written` + `config_file`); re-emitting them on stderr was
  pure context pollution for AI consumers — every successful create
  burned two extra lines of tool-result context for information the
  caller already had structured. Text-mode readers still get the
  disclosure (the stdout `✓ created` line does not carry the path).
  `ctx record` already had the notice correctly gated inside its
  text-mode `else` branch.

- **Error prefix unified to `error: <msg>` across `gate next`,
  `gate self-pattern`, `gate decisions`.** Three handlers used a
  passage-verb-named prefix (`gate next: GUILD_ACTOR is not set…`),
  which on the `throw new Error` path produced the doubled prologue
  `error: gate self-pattern: …` once the outer-catch added its own
  `error:` envelope. Machine consumers that grep for `^error:` now
  match every error from every verb; prose hints retain the
  `next: <command>` recovery line below for the human reader.

- **Four post-2026-05-15-touch-feel polish fixes.** None blocked any
  current workflow; each closes a small papercut surfaced during the
  end-of-day dogfood pass.

  1. **`bin/_lib/checkDistFreshness.mjs`** — stale-dist warning now
     names *"after switching worktrees on this repo"* alongside the
     existing *"after a `git pull`"* cause. Worktree exit followed by
     `./bin/gate.mjs` in the parent is a regular trigger and the
     prior hint missed it.

  2. **`GuildConfig.load()`** — `GUILD_CONFIG=""` (set-but-empty) now
     emits a one-line stderr nudge before falling back to walk-up.
     The previous behavior silently treated empty as unset, which is
     the footgun mode where the caller thinks they're clearing the
     override but is in fact letting walk-up decide the substrate.

  3. **`gate swarm-status` text rendering** — waves with no executors
     render on a single line (`<id> [state] from=<from> (no executors)`)
     rather than emitting a separate indented `(no executors assigned)`
     sub-line. Substrates dominated by pre-#230 records (or freshly-
     filed pending waves) no longer present visually heavy two-line
     blocks per wave.

  4. **`gate swarm-status` summary hint** — when `active_waves > 0` but
     `distinct_executors == 0`, a one-line hint surfaces
     `(no executor-stamped activity — likely pre-#230 records or
     freshly-filed pending)`. The previous summary line read as
     "swarm picture" at face value, misleading the reader for the
     legacy-substrate case.

- **Success-path stderr notices now suppressed in JSON mode** for
  `gate approve`, `gate execute`, `gate review`, `gate thank`. The
  notices (self-approve / executor-assignment mismatch / self-review
  / `--comment` deprecation hint / self-thank) carry information that
  JSON consumers can already detect structurally from the envelope
  (`by` / `from` / `executors[].name` fields), so re-emitting prose
  on stderr was pure context pollution for AI consumers. Text-mode
  readers still get the disclosure unchanged.
  - `gate approve --by X` where `X == request.from`, profile-feature
    `selfApprove: warn` → notice (text only)
  - `gate execute --by X` where `X` is not in the assigned executors
    list → notice (text only); message updated from
    `--executor records intent` to `--executors records intent`
    (singular flag was removed in #398)
  - `gate review --by X` where `X == request.from` → ⚠ self-review
    (text only)
  - `gate review --comment <s>` → deprecation hint (text only)
  - `gate thank X --to X` → self-thank notice (text only)

  Audit follow-up to #397 (which handled `notice: wrote <path>` in
  agora new/play, devil open). Same eris-first principle: stderr on
  success paths should not carry prose that's already in the JSON
  envelope.

  Out of scope (kept as-is):
  - `gate message` self-message / inactive-recipient notices: this
    verb has no JSON output mode at all, so stderr is the only
    signal channel.
  - `gate next` setup-failure notices: those are error paths, not
    success-path notices; they need a separate parity refactor
    (route through `emitErrorEnvelope` for JSON consumers) covered
    by a future PR.
  - `errorEnvelope.ts` JSON-on-stderr write: that's the contract
    (JSON consumers parse stderr for the envelope), not pollution.
  - `(explain: ...)`: opt-in via `--explain`, caller asked for it.
  - `⟶ <voice>`: text-mode-only ornament by design (#382).

- **Test runner default concurrency raised from 4 → 8** (override via
  `TEST_CONCURRENCY=<N>`). The suite is subprocess-spawn-bound (~119
  of 173 tests `spawnSync` a fresh `gate.mjs`), not CPU-bound, so
  oversubscription pays even on the 4-vCPU GitHub `ubuntu-latest`
  runner. Local measurement on a 10-core mac: 4 → 513s, 8 → ~310s,
  12 → 224s, 20 → 159s. The doc-comment block in `tests/run.mjs` carries
  the table so future tuning has a baseline.

- **`tools/lore-scope.sh` moved to `scripts/lore-scope.sh`.** Top-level
  `tools/` held a single shell script that paralleled `scripts/`
  without a meaningful distinction. Merging removes a one-script
  directory and brings the root listing down 1 (part of #385's
  cold-reader discoverability pass). Test file moved
  `tests/tools/` → `tests/scripts/` to match. Doc refs in
  `lore/README.md`, `docs/glossary.md`, and source comments updated.

- **`writeFormat.ts:parseFormat` re-export shim removed.** PR #397
  introduced `src/interface/shared/parseFormat.ts` as the canonical
  parser and left a single-line re-export in `writeFormat.ts` so the
  9 write-side handlers that pull `parseFormat` from there didn't
  need touching in the same PR. This PR finishes the move: those 9
  handlers now import from `../../shared/parseFormat.js` directly,
  the shim is gone. Single import path for one symbol — no
  divergence risk if either side changes signature.

### Added

- **`.changelog/next/` fragment system replaces concurrent writes to
  `CHANGELOG.md`'s `[Unreleased]` block.** Each PR drops one file at
  `.changelog/next/<category>-<slug>.md`; at release time
  `npm run changelog:release -- <version>` collects fragments,
  groups by category, and rewrites the `[Unreleased]` block. Per-PR
  filenames make textual conflicts impossible — the previous "append
  to end of section" convention still produced duplicate `### Fixed`
  sub-headings when PRs raced. See `.changelog/README.md` for the
  format.

- **`gate decisions --limit <N>`** truncates the rendered decision
  list to the most-recent N entries after sort. `totals.entries_counted`
  continues to reflect pre-truncation total so callers can detect
  whether more decisions existed past the cap. Sibling
  `gate voices --limit` already had this; aligning the flag surface
  removes a cross-verb inconsistency.

- **`gate swarm-status` — cross-wave director / participant view
  (#346).** Closes the principle-14 loop: composes `wave-status`
  across all active waves into one envelope so a director never has
  to chain 1 + N + N×M sub-reads to compose the swarm picture.
  Returns waves (with per-executor freshness bands per #309),
  distinct-executor count, and a flat `alerts[]` array surfacing
  `stale_executor` / `overlapping_target` / `attribution_risk`.
  Dual scope flags: `--orchestrating <actor>` (director-centric, "what
  swarm am I conducting?") and `--for <actor>` (participant-centric,
  "what swarm am I part of?"). GUILD_ACTOR env defaults to
  `orchestrating=$GUILD_ACTOR` with `scope.for_source="env"` reported
  in the payload. Sibling of `gate wave-status` (per-wave) and
  `gate decisions` (per-actor history). 8 tests under
  `tests/interface/swarmStatus346.test.ts`.

- **`GUILD_CONFIG` env var override for cross-tree substrate access
  (#308 Layer A).** When set to an absolute path, `gate` skips the
  cwd walk-up and uses the named `guild.config.yaml` directly.
  Unblocks the "worktree at <path-A>, substrate at <path-B>" case
  where the orchestrator's substrate is not in the worktree's git
  ancestry — most notably Claude Code SubAgents running in
  `.claude/worktrees/agent-X/` against a parent substrate that
  lives outside the repo tree. Resolution priority:
  `GUILD_CONFIG` env > `findConfig(cwd)` walk-up > cwd fallback.
  A nonexistent path errors loudly rather than silently falling
  back (silent fallback here would let a SubAgent write to a
  stale substrate without realising).

- **Claude Code `PostToolUse` → `gate witness` example wiring**
  shipped under `examples/plugins/harness-wirings/claude-code/`.
  Surfaces SubAgent tool-use as throttled witness updates on the
  parent wave so `gate wave-status` / `gate swarm-status` show
  fresh activity without polling. Source 3 of the #308 Layer A
  bundle (per principle 15 routing: harness-specific wirings live
  in `examples/`, not in core).

- **Principle 15 promoted: "Plugins are the default extension surface;
  core owns substrate identity."** Names the long-implicit order
  asymmetry between core and plugin routing — plugin-first for
  surface / style / cross-cutting; core only for substrate identity
  (domain semantics, lifecycle, principle-11 director-axis reads).
  Promotion observations: #308 design re-route (core daemon →
  plugin composition) and the voice plugin cluster (#377–#383)
  shipping `VoicePlugin` as a fourth plugin type rather than as a
  core feature. Glossary count updated 14 → 15.

### Fixed

- **`bin/*.mjs` entries now catch unhandled errors and render them in
  the standard `error: <msg>` envelope instead of raw Node stack
  traces.** Surfaced by `GUILD_CONFIG=/nonexistent` printing an
  `at file:///…/bin/gate.mjs:54:1 { field: 'GUILD_CONFIG' }` stack
  with a `Node.js v23.6.1` footer — unprofessional for what is user
  error. The shared helper `bin/_lib/handleMainError.mjs` detects
  DomainError-shaped throws (presence of `.field` property) and
  prints clean `error: <msg>` + exit 1; unexpected internal throws
  still surface their stack with a `<bin>: internal error (please
  file an issue …)` preamble. Fired from gate / guild / agora /
  devil / ctx — all five entry-points.

- **`GUILD_CONFIG=""` stderr nudge now fires exactly once per
  process** instead of twice. `GuildConfig.load()` is called
  multiple times in one invocation (top-level + at least one
  plugin loader); the prior implementation re-emitted on each.
  Module-private one-shot guard `emptyGuildConfigNudgeFired`
  preserves per-process emission semantics so a fresh shell still
  gets the warning, but a single CLI run no longer doubles it.

- **`gate boot --by <actor>` (and `--as` alias) now resolves identity
  for one invocation, overriding `GUILD_ACTOR`.** Pre-fix the
  muscle-memory `gate boot --by eris` bounced with
  `unknown flag: --by` because boot only consulted env. Lifecycle
  verbs all take `--by`; aligning boot removes the cross-verb
  surprise.

- **`gate voices` (no positional) now emits a per-actor utterance
  index instead of a bare usage error.** Pre-fix the no-arg invocation
  returned `Usage: gate voices <name>` with no way to discover *which*
  actors had utterances to walk — a silent-fallback signal-loss
  against the discovery question (`trap_silent_fallback_loses_signal`).
  Index counts both authored requests and reviews, labels each row
  `member` / `host` / `historical`, and sorts by activity desc.

<!-- carried over from pre-fragment [Unreleased] -->

### Fixed

- **`gate tail 0` no longer falsely claims the content_root is
  empty.** Pre-fix, `gate tail 0` on a rich substrate rendered
  the same `(no utterances on this content_root yet)` line as a
  truly-empty root — a false claim about source state
  (`trap_silent_fallback_loses_signal`). The empty-result branch
  now disambiguates: `(0 utterances requested)` when the caller
  asked for zero, the original message only when source is
  actually empty.
- **`gate tail` rejects extra positional arguments instead of
  silently dropping them.** Pre-fix, `gate tail 3 extra`
  returned the first 3 utterances and threw `extra` on the
  floor — the same fail-open shape that `rejectUnknownFlags`
  exists to prevent for flags. The rejection now fires
  symmetrically for positionals, naming the unexpected values
  in the error message.
- **`gate voices <typo>` now surfaces a "did you typo the
  name?" diagnostic instead of returning identical empty output
  to a registered-but-quiet actor.** Pre-fix, the two cases were
  shape-indistinguishable — a silent-fallback signal-loss named
  by `lore/traps/trap_silent_fallback_loses_signal.md`. Text
  mode adds a 3-line hint pointing at `gate tail` / `gate
  register`; JSON mode wraps the output in `{utterances: [],
  _meta: {actor_unknown: true}}` only on the typo branch.
  Registered members and hosts with no utterances keep the
  pre-fix shape unchanged (array form for JSON consumers, plain
  empty-line for text).
- **`gate boot` no longer raises the 7-line
  "inbox-enrichment-failed" warning when the actor is a host.**
  Hosts have no inbox by design (`MessageUseCases.inbox` throws
  "hosts do not have inboxes"). Before this fix, every host-side
  boot recapped that fact as a warning block, inverting
  principle 09 (orientation-disclosure: surface surprising
  cases, stay quiet otherwise). The fact is already conveyed by
  `role: 'host'` in the payload. Inbox enrichment now skips on
  the host path; the warning still fires for an unknown actor
  (typo diagnostic), so the no-inbox surface remains useful
  where it actually disambiguates.
- **`gate list` / `gate pending` / `gate board` no longer
  emit the "filtered by GUILD_ACTOR=..." stderr disclosure in
  JSON mode.** That disclosure exists so a *human* reading text
  output knows why their result set is implicitly scoped. JSON
  consumers already receive the same fact on stdout as
  `_meta.filter.for_source: 'GUILD_ACTOR'` (or
  `_meta.filter.source` on board), so the stderr line is
  structurally redundant; emitting it on every JSON invocation
  crosses the chronic-noise threshold named by
  `lore/traps/trap_chronic_noise_blindness.md`. Text mode
  keeps the line because that's the only surface humans see.
- **`gate boot` no longer steers the author of an executing
  wave toward `gate complete --by <author>` when a different
  actor is the named executor.** The actionable-transition
  predicate previously matched `executing-mine` on either
  `r.hasExecutor(actor) || r.from === actor`, so a wave authored
  by eris with `--executor miki` surfaced to eris with
  `→ next: gate complete <id> --by eris`. Dispatch then failed
  ("eris is not in this wave's executors (miki)"). The author
  fallback is now gated on `executors.length === 0` (legacy /
  self-execute records that never populated executors); when
  the list names someone else, the wave does not appear on the
  author's actionable ladder. Observed 2026-05-13 on a drained
  test fixture (req 2026-05-08-0012).
- **`gate fail` on a pending request redirects to `gate deny`
  by name.** The domain still rejects the transition with the
  state-name hint (`valid next states from pending: approved,
  denied`) — that's the right shape for the domain layer — but
  the interface now pre-checks state and surfaces `gate deny
  <id> --by <m> --reason <s>` directly, so the next verb is
  one line away instead of a translation step. Pairs with the
  help-tier promotion below.
- **`gate schema` now declares `inbox mark-read` as a
  subcommand on the `inbox` entry.** Pre-fix, the schema's
  `summary` claimed "mark-read as subcommand" but the
  `input.properties` carried no `subcommand` field — an MCP
  orchestrator reading the structured contract saw no way to
  invoke `gate inbox mark-read`. The prose and the structured
  contract disagreed (`trap_help_text_drift_on_new_verb`).
  Pattern aligns with the existing `doctor` / `issues` /
  `templates` / `lore` schema entries which carry a
  `subcommand` enum.
- **`gate list` / `gate pending` text mode no longer silently
  truncates long actions and no longer corrupts table layout on
  multi-line actions.** Pre-fix, `printSummary` used
  `String(j['action']).slice(0, 60)`: (a) it cut at exactly 60
  chars with no indicator (`trap_silent_fallback_loses_signal`
  — a 500-char action and a 60-char action rendered
  identically), (b) it kept embedded `\n` in the slice, so the
  second line shifted to column 0 and broke the columnar
  layout, and (c) `.slice` on a UTF-16 boundary risked cleaving
  a surrogate pair. The fix collapses `\r\n\t` to a U+21B5 ↵
  marker first, then runs the existing
  `truncateCodePoints(..., 60)` helper (appends `...`, splits
  on code points). JSON consumers continue to see the full
  action verbatim — truncation is a text-mode-only concern.
- **`bin/ctx.mjs` is now tracked as executable (mode 100755).**
  Pre-fix, the file was shipped with mode 100644 since #143
  (2026-05-04) — `./bin/ctx.mjs` from a clean checkout failed
  with "permission denied." Invocation via `npm run ctx` or
  `node bin/ctx.mjs` worked (which is how every test path
  reaches it), so the regression hid in the gap between
  shell-invoked and node-invoked entry points. The four
  sibling dispatchers (`agora` / `devil` / `gate` / `guild`)
  were already 100755. A new test
  (`binEntryExecutableBit.test.ts`) pins the invariant via
  `git ls-files -s` so the next bin entry can't regress in the
  same way.

### Changed

- **`gate deny` is now part of BASE help (profile=standard).**
  Pre-fix it was tier=`extra`, visible only via `gate --help
  --all` — yet `denied` was listed in BASE help's terminal
  states block. A cold-session caller searching for "cancel a
  pending request" hit `gate fail` first (illegal pending →
  failed) and only found `deny` after invoking `--all`. The
  verb is now surfaced symmetrically with `approve` /
  `complete` / `fail`.
- **`examples/agent-voices/README.md` cross-references the
  underlying lore.** Adds an "Anchoring principles" section
  linking principle 08 (voice-as-doctrine) and principle 07
  (perception-not-judgement) so a cold reader sees why this
  content_root exists in the shape it does, not just how to
  use it. Also surfaces the new boot/lore/`--explain`
  affordances under "Everything is gate voices readable."
- **`--explain` registered for `gate voices` and `gate tail`.**
  These read verbs now emit a one-line orientation on stderr
  when called with `--explain`, joining `boot` / `list` /
  `show` / `chain` / `lore list` / `lore show`. JSON contract
  unchanged.
- **`handlers/request.ts` split into three files by passage
  role.** The original 1656-line module mixed creation,
  read, lifecycle, and fast-track handlers in one place;
  it has been split into `request.ts` (create + fast-track,
  605 lines), `requestReads.ts` (list/pending/show +
  formatters, 582 lines), and `requestLifecycle.ts` (approve/
  deny/execute/complete/fail + helpers, 533 lines). The
  dispatcher in `index.ts` now imports each set from its
  dedicated module. **No behavior change** — every handler's
  signature, output, and lifecycle remain byte-identical;
  the existing test suite passes unchanged (1677/1677).
  `board.ts` and the test re-export in `index.ts` updated to
  import `formatReviewMarkers` / `computeReviewMarkerWidth`
  from the new `requestReads.ts`; `issues.ts` still imports
  `parseExecutorsList` from `request.ts` (unchanged path).
- **`handlers/boot.ts` split into four files by concern.**
  The original 1661-line module mixed payload types, derivation
  logic, text rendering, and the dispatcher. It has been split
  into `bootTypes.ts` (250 lines, leaf module owning every
  shape), `bootActionable.ts` (650 lines, all derivation —
  actionable transitions, suggested_next, verbs_available_now,
  overlap detection, computeLastAuthoredWriteAt),
  `bootRender.ts` (320 lines, text mode renderer + cross-passage
  fan-out), and `boot.ts` itself (370 lines — bootCmd
  orchestrator only). **No behavior change** — full test suite
  passes unchanged (1677/1677). External consumers (`suggest.ts`,
  `tests/interface/boot.test.ts`) keep their original import
  paths via re-exports of `deriveBootSuggestedNext`,
  `BootSuggestedNext`, and `computeLastAuthoredWriteAt` from
  `boot.ts`. The leaf-module type layout was chosen specifically
  to avoid the circular-import shape that would otherwise emerge
  from "boot.ts holds bootCmd that needs derivation that needs
  the payload shape that lives in boot.ts."

### Added

- **`gate boot` ladder thickening — lore stats + alternative
  next steps.** Two surface improvements to the orientation
  payload:
  1. **`lore_stats`** is now part of the boot payload (JSON:
     `{ available, principles, traps }`; text: a `lore: N
     principles, M traps  (gate lore list)` line below
     `queues:`). Cold AI agents learn that `gate lore` exists at
     orientation time, without having to grep the verb catalog.
  2. **Alternative ladder** in text mode: when
     `verbs_available_now.actionable` carries more than one
     entry, the renderer surfaces up to two siblings as `→ or:`
     lines beneath the primary `→ next:`. Previously the
     catalog was JSON-only — callers reading text saw a single
     suggestion and had to round-trip through `--format json`
     to see what else they could do. The primary is de-duped
     from the ladder via verb + id match. JSON shape unchanged.

- **Universal `--explain` flag on read verbs.** Callers append
  `--explain` to a registered read verb to receive a one-line
  orientation message on stderr describing what the verb returns
  and which related verbs to reach for. Stdout output is
  unchanged, so `--explain` composes with `--format json` and
  shell pipelines — orientation is a sibling channel. Initial
  coverage: `gate boot`, `gate list`, `gate pending`,
  `gate show`, `gate chain`, `gate lore list`, `gate lore show`.
  Adding more verbs is a two-line change (an entry in
  `EXPLAIN_MESSAGES` + a `maybeEmitExplain(args, verb)` call after
  `rejectUnknownFlags`). Shaped by principle 09 (orientation-
  disclosure): instead of waiting for friction to teach, callers
  can ask for orientation up front at the cost of one stderr line.

- **`lore/traps/trap_eris_first_override_of_ai_first.md` — public
  trap disclosure.** Names the structural pattern where a
  dogfooder-of-one substrate can silently override its declared
  AI-agent-first axis through private preference. Establishes that
  a forward-looking audit is being run (without exposing the audit
  contents publicly) and treats accumulated weight as the signal
  to re-evaluate principle 11. One-way link to principles 11 / 02 /
  04; principle 11 itself is not edited — the trap is the watcher,
  the principle is the watched.

- **`gate lore` verb — package-shipped doctrine reader.**
  Lets agents browse principles and traps from inside the substrate
  without needing to know the `lore/` directory layout. Subcommands:
  `list` (with `--type`, `--applies-to`, `--relevant-until` filters)
  and `show <name>` (full markdown body, or `--format json` for the
  structured entry). Reads `<packageRoot>/lore/principles/*.md` and
  `<packageRoot>/lore/traps/*.md`; no per-content_root tier (lore is
  authored via PR, not by a CLI write). The `--applies-to` filter
  matches `applies_to:` frontmatter on principles; entries without an
  explicit scope are universal (`all`) and surface regardless. The
  `--relevant-until` filter classifies trap frontmatter as `current`
  (indefinite or future-dated), `expired` (past-dated), or
  `indefinite` (literal only).

- **`gate issues show <id>` — per-id issue reader.** Sibling of
  `gate show <id>` (request) and `agora show <id>` (play); closes the
  asymmetry where `issues` had list/add/note/transition but no per-id
  detail view. Supports `--format text|json`. Text renders the full
  body (no list-row truncation) plus a notes block; JSON returns the
  full issue `toJSON()`. Callers wired into muscle memory for
  `gate show <id>` no longer bounce when reaching for the issue
  equivalent.

- **`gate chain --format text|json`.** Previously text-only by
  design — the asymmetry vs every other read verb made `chain` an
  outlier for pipeline writers. JSON shape: `{root, forward: {issues,
  requests}, inbound: {issues, requests}}`, each item carrying `id /
  found / bidirectional / summary / cross_passage`.

- **Cross-passage chain resolution (gate → agora).** Request-shaped
  ids (`YYYY-MM-DD-NNN`) that miss the gate request store are now
  probed against the agora play store. Found plays render as
  `→ agora play (game=<slug>, <state>)` instead of the previous
  bare `(referenced but not found)`. Multi-game match (same play id
  in multiple games) surfaces every candidate. The JSON shape carries
  the matches under each item's `cross_passage.matches[]`.

- **`gate issues <unknown-sub>` suggests the closest valid sub.**
  Previously the error was bare `unknown issues sub: X`; readers
  reaching for `issues show` got no orientation. Now the error
  includes a `did you mean 'gate issues <best>'?` hint when the typo
  has ≥50% overlap with a known sub, plus the full catalog inline.

- **`gate decisions` verb — director-axis decision audit.**
  Surfaces the approve / deny / execute / complete / fail transitions
  an actor authored within a window. Decision-shaped sibling of
  `gate voices` (review-shaped) and `gate lense-stats` (lense-shaped).
  Defaults `--for` to `GUILD_ACTOR` so a bare `gate decisions` from
  the calling actor's shell answers "what have I decided in the last
  7 days?" Dedupes by `(request_id, transition)` — the #294 slice-
  closure path adds an extra `executing` stamp on `gate complete --by X`
  which would otherwise inflate raw counts.

- **`gate self-pattern` verb — actor behavioral bias surface.**
  Aggregates an actor's substrate footprint over a window: decision
  counts (approve/deny/execute/complete/fail), review verdict ratio
  (ok / concern / reject), top review lense, `approve_rate`
  (approve / approve+deny), `ok_rate` (ok / total reviews). For the
  *full* lense breakdown the verb hints at `gate lense-stats --for
  <actor>` rather than duplicating it. Defaults `--for` to
  `GUILD_ACTOR`. Read-only; no schema change — composes from existing
  `status_log` + `reviews` data.

- **`gate lense-stats` verb — lense rotation diagnostic (closes #305)**
  ([#305](https://github.com/eris-ths/guild-cli/issues/305)).
  Counts review entries per lense over a window (`--since 7d` default),
  highlights the most-frequent and least-frequent lense, and surfaces a
  `next:` hint when one lense dominates 3× the bottom.

- **Per-executor freshness for `gate wave-status` (closes #309)**
  ([#309](https://github.com/eris-ths/guild-cli/issues/309)).
  Stale judgment is now per-executor, derived from each executor's
  most recent attributable activity. Wave-level `(stale)` in the
  footer now derives from "all executors stale" (`wave_stale_effective`).

- **`gate review-context <id>` verb — depth-aware reviewer bundle (closes #310)**
  ([#310](https://github.com/eris-ths/guild-cli/issues/310),
  builds on [#221](https://github.com/eris-ths/guild-cli/issues/221)).
  Returns the bundle a reviewer needs to drive behaviour from substrate
  state: `action`, `reason`, `target`, `executors`, `depth`,
  `recommended_lenses` (`shallow` → `[Logic]`; `standard` → 6-lens
  default; `deep` → all 10 + memory MCP + state-machine + cross-check),
  `prior_reviews`. Closes the substrate-to-reviewer signal loop: the
  `--depth` field was previously decorative — set on the wave but read
  by nobody. Also declares `wave-status` in `verbs.ts` READ_VERBS,
  closing a pre-existing gap.
- **`error.recovery` structured next-step in the JSON envelope.**
  Throw sites with an obvious "use verb X instead" answer can now
  carry the recovery in a machine-readable slot: `error.recovery: {
  verb: string, args: Record<string,string>, reason: string }`.
  AI-agent consumers dispatch from this directly instead of
  parsing the prose `error:` line. Text-mode runs are unaffected
  — the prose hint remains the human surface; the structured form
  is its additive sibling. Wired today: `gate fail <pending-id>`
  carries `{verb: 'deny', args: {id}, reason: '...'}`. Future
  throw sites can opt-in by throwing the new `RecoverableError`
  (exported from `shared/errorEnvelope.ts`) instead of `Error`.
  Shape mirrors `BootSuggestedNext` (verb/args/reason) so
  orchestrators that already consume `boot.suggested_next` can
  reuse the same dispatch path. First step of the "AI-agent-
  first delight" cluster — see `memory/eris_first_overrides.md`
  default-pattern section for the design rubric.
- **`gate next` — one-call read-and-dispatch of the top
  actionable verb.** Composes boot's actionable ladder with verb
  dispatch so an agent loop can chain
  `gate boot && gate next --confirm` to drain its queue one
  transition at a time. Without `--confirm`, the verb is a read:
  it prints the plan (verb / args / reason / can_auto_dispatch /
  command) and exits 0 (or 2 when nothing is actionable — the
  loop terminator). With `--confirm`, it dispatches via
  subprocess so the actioned verb runs through its normal code
  path (rejectUnknownFlags, hooks, write guards) and propagates
  the exit code. Auto-dispatch is gated on whether the verb
  needs only `--by` (`complete` / `execute` / `approve` /
  `show`); verbs needing extra args (`review` / `deny` / `fail`)
  refuse with a "needs additional args" message and the
  caller-facing command line to invoke manually. The canonical
  agent loop is `while gate next --confirm; do :; done`. Second
  step of the "AI-agent-first delight" cluster (see
  `memory/eris_first_overrides.md` default-pattern section);
  pure shape, no eris-specific content.

### ⚠ BREAKING (JSON shape)

- **`executors` field in JSON / YAML changed shape for any mutated
  multi-executor request.** Prior to #294 the field serialized as
  a flat array of name strings: `"executors": ["a", "b"]`. After
  the first slice closure (or for any request created post-merge),
  the field serializes as an array of objects:
  `"executors": [{"name": "a", "status": "completed", "completed_at": "...", "note": "..."}, {"name": "b", "status": "pending"}]`.
  Records that have never seen a slice closure (legacy pre-#294
  files that are read-then-resaved without mutation) still emit
  the legacy flat shape — byte-stable round-trip is preserved by a
  sentinel-rule (`status: 'unknown'` on every entry collapses the
  serializer to the legacy form).

  **Migration for JSON consumers** (`jq` pipelines, dashboards,
  third-party scripts):

  ```diff
  - jq '.executors[]'
  + jq '.executors[] | (.name // .)'
  ```

  The same expression works against both legacy flat records and
  post-#294 structured records.

### Changed

- **Per-executor slice closure on multi-executor requests (closes #294 — PR-A2 schema migration)**
  ([#294](https://github.com/eris-ths/guild-cli/issues/294),
  design lock at [#304](https://github.com/eris-ths/guild-cli/pull/304)).
  `gate complete --by X` and `gate fail --by X` are now per-slice
  operations on multi-executor waves. Each executor's slice has its
  own `status` (`pending` / `completed` / `failed` / `unknown`) and
  `completed_at` stamp; the wave-level state transitions only when
  every assigned executor's slice is terminal (any-fail-wave-fail is
  the phase-1 default — PR-C will replace it with template-bound
  policy via #235 phase 2).
  - **Domain (Request entity)**: `executors` getter signature
    unchanged (`readonly MemberName[]`, 55+ existing call sites
    keep working). New surface: `executorRecords` getter, plus
    `executorStatus(name)` and `completeSlice` / `failSlice`
    methods. `Request.complete(by)` auto-routes to `completeSlice`
    when `hasExecutor(by)` is true; falls back to direct wave
    transition otherwise (pre-#294 record compat). Note: the
    design doc (#304) sketched a rename from `executors` to
    `executorNames`; PR-A2 declined to follow that and kept the
    existing getter intact to avoid 55+ call-site sweeps. Will
    revisit if a structural reason for the rename surfaces.
  - **Persistence**: byte-stable round-trip is preserved by a
    sentinel rule — when every executor record has `status:
    'unknown'` (= legacy hydrate of a pre-#294 record), the
    serializer emits the legacy flat array form
    (`executors: [a, b]`). Any structural mutation (a single
    `completeSlice` call) flips the record to structured-form
    output on the next save; the migration is one-way per the
    design doc.
  - **Hydrate tolerance**: three input shapes are accepted —
    structured array of `{name, status, ...}`, legacy flat
    `[name, name]`, single-string `executor: name`. The first two
    are tested via existing fixtures; legacy records that never
    re-save stay byte-identical forever.
  - **Interface (`gate complete` / `gate fail`)**: a slice-closing
    call that leaves other executors open emits `slice closed:
    <id> by <by>` plus a list of remaining open executors with
    their current status and a "next: each remaining executor
    must run `gate complete --by <name>` to terminate the wave"
    hint. When the call closes the last slice, the historical
    `completed: <id>` output is preserved.
  - **Typo safety (miki concern #1 from #304 review)**: if a wave
    has assigned executors and the `--by` actor is not among them,
    the verb refuses with exit 1 instead of silently stamping the
    wave terminal. Closes the multi-executor wave-fail-on-typo
    accident path.
  - **`gate wave-status` pivot**: reads structured form directly.
    Per-executor lines surface `[pending]` / `[completed]` /
    `[failed]` / `[?]` (legacy unknown). Witness-inference (v1)
    remains as the freshness fallback until #309 lands per-
    executor freshness.
  - 22 new tests across domain + interface layers; 1509/1509 pass.

- **Template registry — two-tier resolution with built-in templates shipped (closes #302)**
  ([#302](https://github.com/eris-ths/guild-cli/issues/302)).
  Wave-brief templates now resolve from two sources, with the
  user override always shadowing the built-in of the same name:
  1. **Built-in** — packaged with guild-cli at
     `<packageRoot>/templates/wave-brief/`. Five templates ship
     out of the box (`single-impl`, `parallel-impl`,
     `research-wave`, `verification`, `compare-and-ratify`) — a
     fresh install / public-repo clone now sees a populated
     `gate templates list` instead of an empty registry.
  2. **User override** — per-instance customization at
     `<content_root>/data/guild/templates/wave-brief/` (unchanged
     path). A file there with the same `template_name` as a
     built-in replaces the built-in entirely for that instance
     (no merge; override wins).
  - `gate templates list` (text) tags each entry with its source
    (`[built-in]` / `[content_root]`).
  - `gate templates list --format json` adds `source` per entry
    and `_meta.builtin_dir` / `_meta.builtin_exists`.
  - **Structural cleanup**: the previous one-off
    `data/guild/templates/wave-brief/` at the repo top — which was
    a `<content_root>` convention path masquerading as a tracked
    distribution asset — moves to `templates/wave-brief/` (a
    proper packaged asset). `package.json` `files:` adds
    `templates` so npm publish ships them. The top-level `data/`
    directory no longer holds tracked content.
  - Backwards-compatible: existing instances with content_root
    overrides keep working unchanged; the override path is
    unchanged and still wins precedence.

### Added

- **`gate resume --with-doctor [--auto-repair]` — surface substrate health at session re-entry (closes #306)**
  ([#306](https://github.com/eris-ths/guild-cli/issues/306)).
  New flags on the existing `gate resume` verb that fold a `gate
  doctor` summary into the resume payload (`doctor.findings`,
  `doctor.summary`, `doctor.is_clean`). With `--auto-repair`,
  quarantineable findings are processed inline via the repair
  use case and the outcome is reported under `doctor.auto_repair`.
  Default behavior is unchanged — without `--with-doctor` the JSON
  shape and text prose are byte-identical to pre-#306.

- **`gate flow-suggest` — advisory verb for picking a flow shape (closes #307)**
  ([#307](https://github.com/eris-ths/guild-cli/issues/307)).
  New read verb: `gate flow-suggest --severity <low|med|high> --area <s>
  [--scope <s>] [--format json|text]`. Maps the (severity, area, scope)
  tuple to a recommended flow — `fast-track`, `direct-pr`, or
  `full-request` — and returns the reason plus alternative options.
  Pure advisory: no substrate writes, no state. Rule engine in
  `application/request/flowSuggest.ts`; future v2 can wrap it with a
  `guild.config.yaml` override without touching the CLI surface.

- **`gate wave-status <id>` — per-executor in-flight slice status (closes #295)**
  ([#295](https://github.com/eris-ths/guild-cli/issues/295)).
  New read verb that composes per-executor view from existing
  substrate fields (witness notes + claim state + status_log
  timestamps) — no schema change needed for v1. Sibling of `gate
  boot`'s cross-request overlap surface (#234): boot is actor-axis
  cross-wave, wave-status is wave-axis cross-actor.
  - Works on any state (pending / approved / executing / completed /
    failed / denied).
  - Single-executor renders a compact one-line form so the verb is
    not useless for the common case.
  - Multi-executor renders a per-executor block with witness note +
    claim state + last attributable write.
  - **Age-threshold disambiguation** (per #295 acceptance):
    `< 5 min` suppresses any "no progress" warning (fresh wave —
    witnesses may simply be incoming); `5-30 min` neutral note;
    `≥ 30 min` no attributable activity surfaces `⚠ stale — no
    in-flight progress note recorded` — the ceremony-swarm failure
    mode (a wave with executors named who never landed any
    substrate-side activity).
  - Forward-compatible with #294: v1 uses witness-inference; when
    #294 ships structured `executors[].status`, this verb pivots to
    read that field directly without breaking the JSON shape.
  - `gate schema` lists the verb under `category: 'read'` with full
    input/output schema; the keys snapshot test surfaces the
    addition forward-compatibly.

### Fixed

- **`gate boot` now surfaces enrichment failures via `warnings: string[]`
  (combo C3 / silent-fallback-loses-signal)**.
  Pre-fix, four enrichment paths (issues count, inbox unread,
  unresponded concerns, content_root_health probe) caught their own
  errors silently — `// may not be configured — non-fatal` — so a
  broken issue repository or a partly-quarantined inbox passed
  through invisibly: `status.open_issues = 0` looked identical
  whether there were genuinely zero issues or the repo was unreadable.
  Devil's concern2 on PR #105 (agent-first-session 2026-04-16-0001)
  flagged this; 2026-05-10 dogfood (`substrate/agora/plays/eris-
  dogfood-0510/`) re-surfaced it. New `warnings: string[]` field on
  `BootPayload` (sorted into the keys snapshot per 0.x stability);
  each silent catch now pushes a descriptive single-line entry
  including `e.message`. Empty array = clean case (no extra noise).
  Text format adds a `⚠ N warning(s) raised...` block when non-empty
  with a one-line disclaimer naming which downstream values may be
  inaccurate. Three regression tests pin: clean-empty / broken-repo-
  surfaces / message-includes-error-detail.

### Added

- **hook bus extended for session-boundary events (#290 — closes #290)**
  ([#290](https://github.com/eris-ths/guild-cli/issues/290)).
  The Phase 1 hook bus (#259) was request-shaped only — `HookContext.request`
  was a non-optional `Request` and the event union covered only the six
  request-lifecycle verbs plus review. Phase 2 verbs (`gate rest` /
  `gate wake` / `gate farewell`, #261-#263) now fire `before:` / `after:`
  hooks via a new `ctx.sessionEvent: SessionEvent | undefined` field
  alongside the existing `ctx.request: Request | undefined`. Exactly one
  of the two is populated per invocation — picked by which verb fired
  the hook. The event union grew six entries (`before:`/`after:rest`,
  `wake`, `farewell`). A `before:` veto on a session-boundary event
  blocks the YAML write, so a vetoed `gate rest` leaves no record on
  disk (substrate untouched). The `after:` fires post-save with the
  final id allocated. Existing plugins that read `ctx.request.X`
  directly continue to work for their subscribed events; multi-axis
  plugins discriminate on which subject is populated. Migration
  guidance in `docs/POLICY.md` § "Hook subject migration"; updated
  `examples/plugins/hooks/audit-log.mjs` shows the branching pattern;
  `policy-no-self-approve.mjs` got a defensive null-check for
  forward-compat. Plugin schema doc updated with a `SessionEvent`
  reference section.

- **plugin schema doc drift detection (#283 — closes #283)**
  ([#283](https://github.com/eris-ths/guild-cli/issues/283)).
  New CI test `tests/docs/pluginSchemaDocSync.test.ts` enforces sync
  between `docs/plugin-schema.md` and the actual `Request` / `Review`
  class surfaces. Adding a `Request` getter without updating the doc
  fails CI with an actionable error pointing at the section to update;
  removing or renaming a getter without updating the doc fails the
  same way. Stale `r.X` references in the `extra.review` doc section
  are also caught. The doc carries an `## Intentionally undocumented
  Request getters` allowlist for internal-only getters
  (`loadedVersion` / `currentVersion` / `mutationSeq`); new getters
  must land in either the doc tables OR the allowlist — silently
  skipping is not allowed. Implementation reads the `.d.ts` emitted
  by `tsc` (no extra dependencies) and skips method calls (e.g.
  `request.toJSON()`) since the v1 contract is getter-only.

### Fixed

- **`gate fast-track` now fires lifecycle hooks (#279)**
  ([#279](https://github.com/eris-ths/guild-cli/issues/279)).
  Pre-fix, `reqFastTrack` called the use cases directly (create →
  approve → execute → complete) and skipped every handler-level hook
  fire. Audit-log plugins (`after:approve`, `after:execute`,
  `after:complete`) observed zero events for self-flow waves; policy
  plugins (`before:approve`, ...) were silently bypassed — the exact
  path those policies were designed to govern. Post-fix: each of the
  three sub-transitions runs its before/after hooks identically to
  the multi-step path. A before-hook veto aborts the chain and leaves
  the substrate in the pre-veto state (no synthetic "fast-track
  aborted" state — same contract as the multi-step path). Three new
  regression tests pin the fires + veto semantics. Discovered via
  dogfood walking `examples/plugins/`.

- **strict-mode review hydrate (#134 H2 hotfix)** — review records
  written under `gate.strict_lenses: true` (using a bundled devil
  catalog lense like `injection`) failed re-read by `gate show` /
  `gate list` because the hydrate path only knew the (narrower)
  `config.lenses` allowed-set. `Review.restore` now uses a permissive
  lense parser (`parseLenseLoose`): the allowed-set check fires only
  on fresh writes, not on re-reads. Records-outlive-writers — a
  historical record's lense was already validated at write time, and
  re-validating against a possibly-changed policy would erase the
  audit trail. This also closes a pre-existing latent bug where
  removing a lense from `config.lenses` would silently drop older
  reviews from list output.

### Added

- **opt-in strict lense vocabulary for `gate review` (#134 H2 — closes #134)**
  ([#274](https://github.com/eris-ths/guild-cli/issues/274)).
  New top-level `gate.strict_lenses: bool` config (default `false`,
  **permanently** opt-in). When `false`, gate review's allowed-lense
  set comes from `lenses:` in `guild.config.yaml` — byte-identical to
  pre-H2. When `true`, the allowed set is the unified devil
  `ComposedLenseCatalog` (bundled defaults + content_root extensions
  from G under `<content_root>/devil/lenses/*.yaml`). Composes with G:
  teams that registered `team-perf.yaml` / `team-a11y.yaml` etc. get
  gate-side vocabulary enforcement on the full custom catalog without
  touching devil's coverage discipline. `gate review --help` reflects
  whichever source is load-bearing for the run. Coverage gating
  (devil's "conclude requires every catalog lense touched") is NOT
  propagated — strict mode is vocabulary enforcement only. Default is
  permanently opt-in: we do not flip to `true` at v1.0 or any future
  cut.

- **per-content_root lense extension loader for devil-review (#134 G)**
  ([#134](https://github.com/eris-ths/guild-cli/issues/134)).
  `<content_root>/devil/lenses/<name>.yaml` now extends the bundled
  lense catalog. Each YAML file follows the same shape as `Lense.create`
  input (`name` / `title` / `description` / `ingest_sources?` /
  `delegate?` / `examples?`) and is loaded by `ComposedLenseCatalog`
  on top of `BundledLenseCatalog`.
  - **extend-only, hard-error on collision.** A name collision between
    a content_root extension and a bundled lense raises `LenseCollision`
    at startup. Silent override would make older review records
    ambiguous to re-read (records-outlive-writers). The fix is to pick
    a distinct extension name (e.g. `security-strict`).
  - **provenance pinned at write time.** Every `Lense` carries
    `source: 'bundled' | 'extension'`; entry records persist
    `lense_source: extension` when the lense was loaded from
    content_root (omitted for the bundled-default common case to keep
    YAML terse). A future bundled v2 that adds the same name cannot
    retroactively reinterpret a recorded entry — the record disambiguates
    itself.
  - **doctor-friendly failure modes.** Malformed YAML and schema
    validation failures route through `onMalformed` rather than
    crashing startup, so `gate doctor` can surface them.
  - `devil schema --format json` now exposes `source` per lense so
    consumers can distinguish bundled vs extension entries.
  - H2 (gate-side `gate.strict_lenses` opt-in mode) is the next slice
    and lands as a separate PR; this ship is loader + record
    annotation only.

### Deprecated

- **`--executor` (singular) on `gate request` / `gate fast-track`**
  ([#239](https://github.com/eris-ths/guild-cli/issues/239)).
  Explicit `--executor <name>` now emits a stderr notice pointing at
  `--executors <name>` and announcing v0.7.0 removal. The implicit
  `--executor` fallback in `gate fast-track` (defaulting to `--from`
  when neither flag is given) stays silent — only user-supplied
  values trigger the notice. Behavior is otherwise unchanged through
  the v0.6 cycle; the deprecated surface is removed at v0.7.0 cut
  along with the `executor` JSON alias on rendering.
  Notice introduced for v0.6.0; removal scheduled for v0.7.0.

### Fixed

- **friction bundle — flag aliases / lense help / self-approve discoverability /
  stderr warnings**
  ([#228](https://github.com/eris-ths/guild-cli/issues/228)).
  Four touch-feel improvements that descend to the standard profile
  (sibling to #233 self_approve under swarm):
  - `gate review` now accepts `--note` as the canonical comment flag
    (parity with the six other write verbs — approve / deny / execute
    / complete / fail / fast-track). `--comment` is preserved as a
    deprecated alias for back-compat; passing both is rejected as
    mutually exclusive, and using the alias surfaces a stderr
    deprecation notice (stderr only, so JSON consumers stay clean).
  - `gate review --help` dynamically lists the lenses resolved from
    `guild.config.yaml` rather than the four domain defaults — so a
    project that registered `security` / `perf` / `a11y` sees them
    in help, not just in the post-error hint. Implemented via a new
    optional `extras` field on `HelpRequested` so other verbs can
    surface their own dynamic info without bespoke renderers.
  - `gate request` emits a `suggested_next` line mentioning
    `gate fast-track` whenever the author and the (sole) executor
    coincide — the self-wave case where the standard
    pending → approve → execute → complete dance is overkill. Cross-
    actor waves keep the standard hint without the fast-track nudge.
  - dist staleness warning is verified to ride stderr (was already
    correct in `bin/_lib/checkDistFreshness.mjs` —
    `process.stderr.write`, not `console.log`); the new test pins
    the contract so a regression that flips to stdout is caught.

### Added

- **`gate request --from-agora <play_id>` bridges agora play
  cliff/invitation into request action/reason**
  ([#232](https://github.com/eris-ths/guild-cli/issues/232)).
  Surfaces the substrate-side link from agora (suspended-conversation
  passage) into gate (request passage) without forcing the operator
  to copy/paste prose between two CLIs. Lift policy: `action ←
  invitation` (the "what to do next" half of the cliff), `reason ←
  cliff` (the "what was happening" half); either flag may still be
  passed explicitly to override its corresponding lift while the other
  axis stays bridged. The play id is stamped structurally on
  `Request.sourceAgoraPlay` (YAML key `source_agora_play`) so
  `gate chain`-style walks see the agora→gate edge without scanning
  free-form text. `--game <slug>` disambiguates cross-game play-id
  collisions (each agora game sequences plays independently per day);
  passing `--game` without `--from-agora` is refused as a flag-shaped
  error rather than silently ignored. Refusal cases each carry an
  actionable `next:` hint: concluded plays (terminal — open a fresh
  play or file without `--from-agora`); playing-but-never-suspended
  plays (no cliff to bridge — `agora suspend` first); not-found play
  ids (surfaces the agora content_root the bridge consulted, so a
  multi-root operator sees which tree rejected the lookup); invalid
  id shape (names the YYYY-MM-DD-NNN format). Profile-agnostic — works
  identically under `standard` and `swarm`. Byte-stable persistence:
  `source_agora_play` is omitted from YAML when unset (every plain
  `gate request` and every pre-#232 record); hydrate tolerates the
  absence by leaving the field undefined. `gate show` renders
  `source_agora_play: <id>` in text mode (next to `created:`) and
  exposes the same key under the JSON payload. Mutually exclusive
  with `--template` (#235) at the interface layer — both supply
  action/reason defaults, so combining them is rejected with a
  flag-shaped error rather than silently picking one.
- **`feat(gate templates): wave-brief template registry — list / show /
  --template skeleton expansion
  ([#235](https://github.com/eris-ths/guild-cli/issues/235))**.
  Adds two read subverbs (`gate templates list` / `gate templates show
  <name>`) over a per-instance template SOT at
  `<content_root>/data/guild/templates/wave-brief/`, and threads
  `gate request --template <name>` through to stamp three new fields
  on the request record (`template`, `template_version`,
  `gate_required_acknowledged`). The skeleton expansion populates
  `--action` / `--reason` from the template's frontmatter when the
  caller omits them; explicit overrides win and the template stamp
  survives. Templates are markdown files with YAML frontmatter
  (`template_name` / `template_version` / `intended_use` /
  `gate_required`); malformed frontmatter routes through the
  conventional `onMalformed` warn-and-skip path so one bad file
  doesn't take the registry offline. The public `guild-cli` repo does
  NOT ship templates — each guild instance keeps its own brief
  catalogue under `content_root`, and a missing dir is the legitimate
  empty-registry case (the `list` surface emits a single-line advisory
  rather than failing). Profile=swarm gating for parallel-executor
  waves is in stub form for this phase: when `executors.length > 1`
  is supplied without `--template`, a stderr notice points at the
  registry and `gate templates list`, but the request still lands.
  Enforcement (refuse without `--template` for parallel waves) is the
  follow-up issue. Pre-#235 records lack all three template fields
  and round-trip clean (records-outlive-writers, principle 04). Schema
  declares the new `templates` verb under category `read` with a
  `subcommand` discriminator; the schema-drift detector treats it as
  a subcommand umbrella alongside `issues` and `inbox`. Mutually
  exclusive with `--from-agora` (#232) at the interface layer (both
  supply action/reason defaults).

- **`features.self_approve: { allowed | warn | forbidden }` —
  profile-gated self-approve policy on `gate approve`**
  ([#233](https://github.com/eris-ths/guild-cli/issues/233)).
  Tri-state config gates the case where `--by` matches the request
  author. Three states (not a boolean) because failure modes differ:
  `allowed` passes silently for deployments that actively rely on
  self-approve, `warn` passes with a stderr notice pointing at
  fast-track (the historical default), `forbidden` refuses with exit
  1 and an actionable error naming three recovery paths
  (`gate fast-track`, another actor approving, or switching profile /
  setting `self_approve: warn`). Profile defaults: `warn` under
  `standard` (preserves current behaviour), `forbidden` under `swarm`
  (parallel waves require bias-checked approvals — same shape as
  `worktree_required_for_parallel`). An explicit
  `features.self_approve` always overrides the profile default so a
  deployment can opt in/out without flipping the whole profile.
  Malformed values (non-string, or string outside the enum) surface
  via `onMalformed` and fall back to the profile default rather than
  rejecting the config — same conservative read pattern other
  optional fields use. `fast-track` is unaffected (orthogonal verb,
  never gated). Non-self approve is also unaffected regardless of
  profile/policy — the gate is self-only.
  + Self-detection is now performed on the canonical actor
    representation (case-fold + trim, via `MemberName`) rather than
    the raw CLI argument. Pre-fix, daily typing habits like `--by
    ALICE` or `--by 'alice '` slipped past the swarm `forbidden`
    gate even though the persisted record collapsed both to `alice`
    — a critical bypass surfaced by Asteria during cross-review.
    The same normalization is applied to all handler-side
    self-detection sites (review's self-review warning, thank's
    self-thank notice, message's self-message advisory) and to the
    `# verb id: invoked by X on behalf of Y` surface line, so
    whitespace no longer leaks into the audit trail.
- **`gate witness <id> --by <actor>` / `gate unwitness <id> --by <actor>`
  for non-exclusive cross-session observation**
  ([#244](https://github.com/eris-ths/guild-cli/issues/244),
  [#226](https://github.com/eris-ths/guild-cli/issues/226) phase 2).
  Companion verb to `claim` (phase 1): where claim is "I'm working on
  this right now, do not double-stake" (exclusive, refuses on
  conflict), witness is "I'm watching this" (non-exclusive — multiple
  actors can witness simultaneously, never refuses on conflict with a
  claim or another witness). Re-witness by the same actor is a no-op
  (idempotent — the array doubles as a set ordered by first
  registration). `unwitness` removes only the caller's own witness,
  refusing on a foreign actor (no kick semantics in this primitive).
  State guard: witness allowed on pending/approved/executing (the live
  race window — passive observation of in-progress work is
  legitimate); terminal states refuse and auto-reset existing
  witnesses to `[]` on the transition. Pre-#244 records hydrate as no
  witnesses and YAML stays byte-stable (the `witnesses:` field is
  omitted when empty). `gate show` surfaces `witnesses: a, b, c` below
  the claim line in text mode, and exposes the structured `witnesses`
  array in JSON mode (omitted when empty in both surfaces).
  + Hydrate dedup: hand-edited YAML with duplicate `witnesses` entries
    is collapsed to first-occurrence on load (matching the domain's
    set-by-first-registration semantic) and the migration surfaces via
    `onMalformed` rather than passing silently — without this, a single
    `unwitness` would leave duplicate names visible on `show`.
    + Terminal-aware `unwitness` error: when invoked on a closed record
    (completed/failed/denied) where auto-reset has already cleared the
    list, the error message names the auto-release behavior and signals
    "no action needed", distinguishing a benign cleanup pass from a
    real misnamed `--by` typo (which keeps the original phrasing on
    pending/approved/executing).

- **`gate claim <id> --by <actor>` for cross-session stake**
  ([#226](https://github.com/eris-ths/guild-cli/issues/226) phase 1).
  Two concurrent main-session agents that independently pick up the
  same id (substrate-experiment 5) can now mediate the race by
  claiming the request before working on it. Same-actor re-claim is
  a no-op (idempotent — `claimed_at` is NOT bumped, the timestamp is
  a "since when" stamp, not a heartbeat); a different actor's claim
  is refused while one is held; the claim auto-releases when the
  request reaches a terminal state (completed/failed/denied).
  Pre-#226 records hydrate as unclaimed and YAML stays byte-stable
  (the field is omitted entirely when null). Witness/explicit-release
  verbs are deferred to a follow-up issue — phase 1 ships claim only.

### Fixed

- **`witness` / `unwitness` / `claim` concurrency safety
  ([#244](https://github.com/eris-ths/guild-cli/issues/244) Devil
  REJECT root cause).** Pre-fix: these verbs mutated state without
  appending to `status_log` / `reviews` / `thanks`, so the optimistic-
  lock token (sum of those three array lengths) was non-monotonic
  across them. Two concurrent `gate witness` calls both passed the
  lock check on identical pre-state and last-writer-wins atomic
  rename silently dropped one of the two writes — Devil's repro
  showed 4 parallel witnesses landing exactly 1 entry, parallel
  `unwitness` losing the loser, and `claim ⊥ witness` mixed races
  destroying the #244 core promise that "witness coexists with any
  claim". Fix: each `claim` / `witness` / `unwitness` mutation (and
  every per-actor terminal auto-reset) bumps a new `mutation_seq`
  counter on Request, and `computeVersion` includes it in the
  optimistic-lock token; concurrent writers now throw
  `RequestVersionConflict` and the use case
  (`RequestUseCases.{claim,witness,unwitness}`) retries the load →
  mutate → save loop on conflict (bounded, with stagger). Idempotent
  re-claim / re-witness by the same actor does NOT bump (no-op, save
  skipped). Per-actor accounting on terminal auto-reset means a
  frontier collapsing "claim + 3 witnesses" contributes `+4` so the
  seq delta remains a faithful "how many actors were mediating"
  signal. YAML byte-stable: `mutation_seq` is omitted when 0, so
  pre-#244 records and never-mediated post-fix records round-trip
  identically.

- **darwin path-comparison flakes in `tests/{interface,passages}/`
  ([#238](https://github.com/eris-ths/guild-cli/issues/238)).** Twelve
  tests across `boot`, `doctor`, `register`, and `agora new`/`play`
  asserted on absolute paths derived from `mkdtempSync(os.tmpdir())`
  via `new RegExp(escapeRegex(root))`. On macOS, `os.tmpdir()` returns
  `/var/folders/...` but child processes resolve their cwd through the
  `/var → /private/var` symlink, so subprocess output names the
  `/private/var/...` form and the regex `^...$` anchors miss. Fix:
  wrap `mkdtempSync(...)` results in `realpathSync` at the test
  bootstrap so the root used in assertions matches what spawned
  subprocesses emit. Test-infra only — no production code touched.

- **`optionalOption` rejects bare flags (`--depth`, `--executor`,
  `--state`, ... with no value).** Pre-fix, an optional flag passed
  without a value silently fell through to the env fallback / undefined.
  Surfaced in v0.5 dogfood: `gate request --depth` (intending to set
  the value but forgetting to type it) silently created a request
  with no depth. Same fail-open class `requireOption` already protects
  against; `optionalOption` now mirrors the shape:
  ```
  error: Missing --depth value.
    (If your value begins with "--", use --depth=<value> or place "-- <value>" after the other flags.)
  ```
  Affects every callsite — `--executor`, `--target`, `--state`,
  `--game`, `--note`, etc — uniformly. Bare-flag short-circuits the
  env fallback path so a typo can't be silently overridden by ambient
  GUILD_ACTOR.

- **Inbox text-mode surfaces `(unread, expects response)`.** Phase 1
  of [#220](https://github.com/eris-ths/guild-cli/issues/220) (PR #222)
  stamped `expects_response` on inbox YAML and surfaced it via
  `gate boot`'s `suggested_next`, but the inbox **text** rendering
  only said `(unread)` for both flagged and unflagged broadcasts. A
  human scanning the text inbox couldn't tell them apart without
  re-running with `--format json`. Now the marker shows inline:
  ```
  1. [...] broadcast from nao (unread, expects response)
     audit needed
  2. [...] broadcast from nao (unread)
     FYI only
  ```
  Read state suppresses the marker (Phase 1 ack proxy: read drains
  the surface). Same principle-09 disclosure shape — visible at the
  surface that emits it, in both text and JSON.

### **BREAKING**

- **`gate show --format text` label rename: `executor:` → `executors:`**
  ([#230](https://github.com/eris-ths/guild-cli/issues/230)). text mode
  の label が常に複数形になる (単数 wave でも `executors: miki`)。
  人間スクリプト (`grep '^executor:'`, `sed 's/executor: //'`, etc.)
  を破壊するため BREAKING として明示。
  - **Before**: `executor: miki` (単数 wave のとき) / `executor: miki, leysia` (複数のとき、暫定 v0.5 形式は未存在)
  - **After**: `executors: miki` / `executors: miki, leysia` (uniformly plural)
  - **Migration**: 新 label に追従するか、構造化 consumer は
    `--format json` の `executors` array key を使うこと。永続化
    YAML 側の field rename (`executor` → `executors`) は同じ
    release で起きるが、read-only の legacy hydrate により旧
    record は透過に load される (詳細は
    [docs/storage-format.md](./docs/storage-format.md) §Request
    の Hydrate tolerance)。

- **`gate list` (no `--state`) now defaults to `--state all`**
  ([#218](https://github.com/eris-ths/guild-cli/pull/218),
  closes [#217](https://github.com/eris-ths/guild-cli/issues/217)).
  Pre-fix the no-flag call exited 1 with a hint that disclosed
  the `--state` enum + the `all` sugar. The hint was good but
  the exit-1-on-muscle-memory-call posture was inconsistent with
  every sibling list verb (`agora list`, `devil list`,
  `gate issues list` all "just work" without flags). A v0.5
  dogfood pass surfaced this as the last remaining touch-feel
  asymmetry across the four passages.
  - **Before**: `gate list` → exit 1, hint on stderr.
  - **After**: `gate list` → exit 0, every request across every
    state, identical to `gate list --state all`.
  - **Migration**: callers that explicitly passed `--state pending`
    (or any other state) are unaffected. Callers relying on the
    exit-1 + hint behaviour (likely none — this was a discovery
    affordance, not an API) should migrate to `gate list --state
    pending` if they wanted the pending-only triage view, or
    `gate status` for the count snapshot. The hint itself moves
    to `gate list --help` (the runnable-example surface from
    PR #163), out of the hot path.

### Added

- **`gate request --executors a,b,c` records multiple executors per
  request** ([#230](https://github.com/eris-ths/guild-cli/issues/230)).
  parallel-impl wave 等で複数の executor を attribution として
  正しく保存できるようになる。各要素は member name regex
  (`/^[a-z][a-z0-9_-]{0,31}$/`) で個別検証、重複・空文字は loud に
  reject。`--executor` 単数 flag は後方互換 alias として継続するが、
  `--executors` と同時指定すると排他エラー。永続化 YAML は
  `executors: [<name>, ...]` (array) で書かれ、単数 wave でも
  `executors: [miki]` の形を取る (uniformity)。pre-#230 の
  `executor: <single>` record は read 時に透過 hydrate され、
  次回 save 時に新形式へ rewrite される (in-place migration なし)。
  substrate-experiment 実験 6 で実証された並列実装 attribution
  race を構造的に解く修正。
- **`gate issues promote --executors a,b,c` symmetric with request**
  (Devil concern follow-up from #230). promote 経路でも複数 executor
  を一発で記録できる。`--executor` 単数 alias は同様に継続。

- **`gate request --depth shallow|standard|deep` reviewer-depth advisory**
  ([#221](https://github.com/eris-ths/guild-cli/issues/221) phase 1
  substrate slot).
  Substrate-experiment 実験 2 で発見した sharp edge への対応:
  Devil agent が常時最大深度で grep + 検証するため、極小実装に
  対しオーバーレビューが構造的に発生していた (PR #207 の事例)。
  `--depth` flag を `gate request` に opt-in で追加し、enum
  `[shallow, standard, deep]` で reviewer 側 (Devil agent) に
  advisory を渡せるようにする。
  - `shallow`: surface 点検、grep 自走しない
  - `standard`: 現行と等価 (default、互換)
  - `deep`: arch / threat-model まで掘る
  - **substrate slot のみ**: agent 側の prompt 3 段階化は
    operator/agent setup 側で対応する (本 repo の外)。
    principle 02 (advisory-not-directive) のとおり、reviewer は
    depth を尊重する義務を負わず、substrate は signal を carry
    するだけ。
  - **byte-stable**: `--depth` 省略時は YAML に `depth:` フィールド
    を書かない。pre-#221 record と round-trip-byte-同等
    (principle 04: records-outlive-writers)。
  - hydrate tolerance: 既存 record ですべての older 形 (`depth:`
    なし) が clean に load される test。
  - Schema input + drift detector update + advisory-framing
    description (principle 02 / 10)。

- **`gate whoami` honours `--format json|text` with a typed payload.**
  whoami was the lone read-shape verb without `--format` support —
  every sibling (`status` / `board` / `list` / `show` / `voices` /
  `tail` / `doctor`) accepted both formats, but whoami declared
  only `--limit` and was text-only. That meant the principle-09
  `actor source: ...` disclosure was reachable to agents only via
  regex parsing of prose. JSON now emits
  `{actor, role, display_name, actor_source, recent_utterances}`
  with the schema's `output` properties fleshed out to match
  (previously declared as `{type: "object"}`, contributing to the
  schema-as-contract gap that principle 10 names). Error path
  (missing `GUILD_ACTOR`) returns the standard `ok: false` envelope
  in JSON mode so orchestrators don't switch parsers based on
  outcome. whoami joins the format-symmetry CASES; new focused
  JSON-path tests cover env / file / missing-actor / invalid-format.

- **bin entries set stdio blocking before dispatch.** Pipe-targeted
  `process.stdout.write` is async; on `--format json` payloads above
  ~8 KB (notably `gate schema` once whoami's output shape was
  fleshed out, but every verb is exposed to the same race) the
  trailing `process.exit(code)` would cut the tail of the JSON
  envelope, surfacing as `Unexpected end of JSON input` in
  spawn-based tests and non-tty consumers. All 5 bin entries
  (`gate` / `agora` / `devil` / `ctx` / `guild`) now flip
  `process.stdout._handle.setBlocking(true)` (and stderr) before
  dispatch — tty writes are already synchronous so this is a no-op
  on interactive runs. Latent bug surfaced by the whoami
  schema-as-contract fix above pushing `gate schema` past the
  threshold.

- **Format-symmetry contract test (principle 11 enforcement).** A
  v0.5 dogfood pass found that `gate status` and `gate doctor`
  silently fell back to text mode for unknown `--format` values
  (the inverse symmetry — every `--format`-aware verb must reject
  unknown values uniformly — had no CI guard). New test runs both
  `--format json` and `--format text` against a representative set
  of read verbs (gate status / board / schema / doctor / tail,
  agora list / schema, devil list / schema), asserts both succeed
  and produce parseable output, plus a negative pass that pins
  rejection of `--format yaml`. Two handler fixes shipped together:
  `gate status` and `gate doctor` now validate `--format` at entry
  (matches the existing pattern used by board / list / schema).

- **Schema ↔ handler flag-coverage CI test.** `<cli> schema --verb
  <name>` is the agent-dispatch reflection layer; the handler's
  `*_KNOWN_FLAGS` set is what the CLI actually accepts via
  `rejectUnknownFlags`. There was no CI guard against the two
  drifting. New test enumerates every verb across the 5 passages
  via `<cli> schema --format json`, parses the handler's known-flag
  set from the unknown-flag error message, and asserts set
  equality (after filtering positionals — those carry a
  `description: 'positional; ...'` marker in devil's schema and
  are absent from agora's). Sub-dispatchers (`gate issues`,
  `gate message`) are skipped: their schema models a `subcommand`
  enum rather than a flag set. A floor-check verifies at least 3
  verbs per CLI passed the comparison so a regression in the
  unknown-flag error shape doesn't silently empty the loop.

- **`gate whoami` discloses actor source provenance.** When
  `GUILD_ACTOR` (env) and `.guild-actor` (file) both produce a
  valid identity, the resolved actor looks the same on the
  surface but the *path* that produced it carried different
  signals (env from shell vs. file dropped into the tree by a
  colleague). New `actor source: GUILD_ACTOR (env)` /
  `actor source: .guild-actor (file)` line under `you are X`
  closes the orientation gap. Sibling helper
  `resolveGuildActorWithSource()` exposes the source as a typed
  field for other surfaces that want it. Mirrors principle 09
  (orientation-disclosure) — when two valid configurations
  produce the same value, name which one was used.

### Changed

- **`gate show --format text`: label `executor:` → `executors:`**
  ([#230](https://github.com/eris-ths/guild-cli/issues/230)). uniformity:
  単数 wave でも複数形 `executors: miki` で表示される (record の
  arity に関わらず)。grep / sed で `^executor:` を expecting する
  外部スクリプトは `executors:` に追従が必要 — 移行先は
  `executors:` を grep するか、`--format json` の `executors`
  array key を使う。BREAKING 節にも明示。
- **`gate show --format json` adds `executors: <array>` key**
  ([#230](https://github.com/eris-ths/guild-cli/issues/230); canonical
  shape). 既存の `executor: <string>` key も back-compat として
  first-of-list 値を 1 リリース継続 emit する (consumer の段階
  移行のため)。`executor` JSON key は **v0.7 で削除予定**。
  consumer は `executors` array に migrate すること。
- **`gate list --executor <name>` matches against the array.**
  ([#230](https://github.com/eris-ths/guild-cli/issues/230)). 1 人でも
  array に含まれていれば match。flag 名は `--executor` 単数のまま
  (filter は単一 name 検索なので、複数指定の必要なし)。

- **Actor-flag missing-arg errors unified across agora / devil / ctx
  to the #164 `requireOption` shape.** A v0.5 dogfood sweep found 16
  callsites still using the pre-#164 pattern
  (`optionalOption` + manual `--by required (or set GUILD_ACTOR)`
  stderr write) — the gate sweep had been thorough but agora / devil /
  ctx kept the older bespoke message. Now every actor-flag error
  reads `Missing --by <m> (or set GUILD_ACTOR).` regardless of which
  passage emitted it. Net deletion of ~90 lines (one `requireOption`
  call replaces six lines of manual handling). Tests asserting the
  prior `/--by required/` shape updated to `/Missing --by/`.

### Added

- **Partial-dist-staleness detector at bin entry.** The existing
  guard at #139/#140 catches "dist not built at all" but not
  "dist exists, but lags src after a `git pull`". A v0.5 dogfood
  pass hit the lag case — `agora last` returned `unknown verb`
  because dist held the pre-#179 dispatcher. New shared helper
  `bin/_lib/checkDistFreshness.mjs` (plain ESM, lives outside
  `dist/` to avoid the circular trap) compares newest src/`*.ts`
  mtime against newest `dist/src/*.js` mtime, with a 2-second
  grace for fs clock skew. Emits a single stderr notice and
  continues — staleness is dev-loop friction, not a correctness
  failure (a stale dist often runs fine for the verbs that didn't
  change). Silent when src/ is missing (installed-via-npm shape).
  Wired into all 5 bin entries (gate / guild / agora / devil / ctx).

- **`agora list --state all` and `devil list --state all` accept the
  cross-passage sugar.** A v0.5 dogfood pass surfaced a touch-feel
  asymmetry: `gate list --state all` and `gate issues list --state all`
  both accept `all` as sugar for "every state, no filter" (#170), but
  the sibling `agora list` and `devil list` errored:
  ```
  agora: error: --state must be one of playing|suspended|concluded, got: all
  devil: error: review state must be one of open, concluded, got: all
  ```
  Same friction class #170 closed for `gate` — muscle memory between
  sibling list verbs across passages was breaking on the `agora` /
  `devil` boundary. Both now accept `--state all` and treat it as
  "no filter" at the interface layer; the domain enums are
  unchanged (the sugar is a CLI affordance, not a state). agora's
  invalid-state error now also names `|all` so the option is
  discoverable from the failure itself.

- **`gate boot --since <ISO-timestamp>` delta surface.** Token-cost
  lever for long sessions: agents that re-boot mid-flow now pass the
  previous boot's `last_activity` (or any ISO-8601 UTC timestamp the
  substrate would emit) and receive `tail`, `your_recent`, and
  `inbox_unread` filtered to entries strictly newer than the cutoff.
  Validation is strict — the value must match
  `YYYY-MM-DDTHH:MM:SS(.sss)?Z` so the echoed `since` field is always
  directly comparable to substrate timestamps; malformed input is
  rejected with a `next:` hint pointing at the previous boot's
  `last_activity` as the canonical chain value. Two invariants
  preserved across the filter: (1) `status.inbox_unread` SCALAR
  reflects the TRUE unread count, not the filtered slice, so the
  orientation counter never undercounts; (2) `last_activity` itself
  is NOT filtered, so the next boot can chain
  `--since=$last_activity` without a second read. AI-agent-first
  delight cluster #2; pure shape (rubric tier-1), no eris-specific
  content. (#37x)

- **`gate complete --cliff <s>` forward-pointing close note + boot
  `past_cliffs` surface.** Zeigarnik continuity for gate: a completing
  actor can stamp "next agent should..." prose onto the terminal
  request, and `gate boot` resurfaces those cliffs the next session
  under `past_cliffs` for the authoring / executing actor. Mirrors
  agora's `cliff/invitation` semantic across passages but ports only
  the forward half — `--note` already covers "what happened," so the
  asymmetry is intentional. v1 scope: completed-only (fail/deny carry
  forward intent in their reasons already). Persistence: cliff lands
  on the terminal `status_log` entry and projects to the top-level
  `cliff` field on the JSON envelope (mirroring the `completion_note`
  projection pattern). Hydrate is strict — a cliff stamped on a
  non-completed entry is dropped via `onMalformed` rather than
  silently accepted. Boot surface: `past_cliffs` lists the actor's
  newest 5 cliff-stamped closures (authored OR executed), filterable
  by `--since`, null when no actor is resolved (global-view boot has
  no self to attach "past selves" to). AI-agent-first delight
  cluster #6; pure shape (rubric tier-1), no eris-specific content.
  Text-mode boot adds a `past selves left these cliffs:` section that
  renders only when entries exist (principle 13 voice budget). (#37x)

- **Voice plugin infrastructure: ornamental-voice surface as the
  second dogfood validation of principle 15.** Introduces a third
  plugin kind (`plugins.voices`) alongside the existing verb/hook
  plugins. A voice plugin attaches OPTIONAL personality narration to
  write-verb JSON envelopes via a new `_meta.voice` field, distinct
  from the doctrinal voice held in handlers (principle 08 — that
  voice is intentionally NOT pluggable). Two-layer model preserved
  by construction: doctrinal voice carries lore in `message` /
  `suggested_next.reason` / schema descriptions; ornamental voice
  carries personality and CANNOT replace doctrinal prose. Stripping
  `_meta.voice` from a pipeline loses zero information — that
  invariant is what keeps the two layers honest. Activation:
  `GUILD_VOICE=<name>` env picks one loaded plugin by name; unset or
  no match → no `_meta` field emitted (silent miss, never error).
  Plugin shape: `{name, verbs: {<verb>: [{when, template}, ...]}}`
  with `when ∈ {default, cliff_present, cliff_absent}` and
  `{id} / {action} / {by} / {cliff}` template variables sourced from
  the substrate (voice cannot invent facts). v1 scope: `gate
  complete` fires voice on wave-terminal completion only; slice-only
  closes do not emit voice (narrating a slice as "completed" would
  be a false claim). Trust model: shares `plugins.trusted: true`
  consent gate with verb/hook plugins. Doctor surfaces voice plugin
  load failures as `area: 'plugin'` findings, same channel as the
  other plugin kinds. Text-mode renders ornamental voice on stderr
  (`(voice: …)` line) so JSON-piped consumers stay clean. (#37x —
  cluster #1)

- **Voice plugin extension: all write verbs now fire ornamental
  voice.** Sibling PR to the infrastructure landing — voice templates
  may now be authored against `approve` / `deny` / `execute` /
  `complete` / `fail` / `review` (the full write-verb surface).
  Template variables `{note}`, `{verdict}`, `{lense}`, `{comment}`
  join the existing `{id}` / `{action}` / `{by}` / `{cliff}`; `{by}`
  resolves to the just-appended review's reviewer on `review`, the
  terminal status_log entry's actor everywhere else (matches a human
  reader's intuition: "by" means the actor of the salient event).
  New `when` predicates: `verdict_ok` / `verdict_concern` /
  `verdict_reject` (review verb), `with_note` / `without_note`
  (every write verb). `fail` mirrors `complete`'s honesty rule —
  voice fires on wave-terminal only; slice-only closures are not
  narrated (per-slice failure is not the wave failing). Doctrinal
  voice (`message` / `suggested_next.reason`) unchanged across every
  verb — the augment-not-replace invariant carries from PR 1
  unchanged. (#37x — cluster #1 continuation)

- **`gate schema --voice <name>` voice-flavored description overlay.**
  Voice plugin shape gains an optional `schema` section carrying
  per-verb `summary` + per-flag `input.<flag>` description overrides;
  `gate schema --voice <plugin-name>` overlays them onto the doctrinal
  schema before emitting. Augment-only — any field a voice does NOT
  override falls through verbatim, so principle 08 (voice-as-doctrine,
  doctrinal voice held in handlers) is preserved as the substrate
  floor. Unknown voice name → silent miss (no error, no overlay),
  mirroring the `_meta.voice` semantic on write envelopes. Activation
  is per-invocation (a flag, not env) so a reader can switch voices
  without exporting `GUILD_VOICE` — useful for AI agents that want
  to inspect what eris's schema reads like before committing to that
  voice for the whole shell. (#37x — cluster #5, second half of the
  voice-plugin landing pair)

- **`gate voice` mode-switch verb + 4-layer voice resolution.**
  Lowers the burden of switching between voice plugins ("今この気分")
  from "edit env / config" down to a one-keystroke verb. Resolution
  order (least → most specific):
  `config.voice.default < <content_root>/.guild-voice file <
  GUILD_VOICE env < per-invocation --voice flag`. The new
  `.guild-voice` file (single-line voice name) is the cwd-stable
  middle tier — written by `gate voice <name>`, cleared by
  `gate voice off`, inspected by bare `gate voice`. Introspect output
  surfaces the active layer and emits a hint when a higher-priority
  layer is masking the file ("$ unset GUILD_VOICE"). New optional
  `voice.default: <name>` in `guild.config.yaml` provides the
  deployment-baseline lowest tier. Set is permissive on whether the
  named voice is currently loaded — mirrors the silent-miss contract
  established by `_meta.voice` on write envelopes. Lock-exempt (the
  marker file is config-shaped, not substrate-data-shaped, so the
  content-root lock would be over-conservative). (#37x — eris-first
  refinement, follow-up to the AI-agent-first delight cluster)

- **Voice plugin `essentials` section + `gate --help --essentials`
  curation.** Voice plugin gains an optional `essentials: {verbs:
  [...], note?: string}` section carrying a per-mode curated verb
  list — the verbs the voice (and the operator wearing it) considers
  load-bearing for daily work. `gate --help --essentials` reads the
  active voice (resolved via the 4-layer order shipped alongside
  `gate voice`) and renders only those verbs, orthogonal to the
  profile-driven BASE/COORDINATION/EXTRA tiering. The banner names
  the curating voice and surfaces the optional `note` so readers
  see whose curation they're looking through. Silent fallback when
  no voice is active or the active voice has no essentials section
  — `--help` falls back to the profile tier. Mode IS the curation:
  `gate voice devil` swaps to a devil-mode essentials (review / deny
  / fail emphasis) in one keystroke. (#37x — eris-first refinement
  PR-D, builds on the `gate voice` lever)

- **`gate boot` refinement: `past_cliffs` voice re-rendering +
  `--since-last-mine` sugar.** Two `gate boot` upgrades bundled as one
  PR — both refine the boot text-mode surface for an eris-first
  Zeigarnik experience.

  Voice plugin gains an optional `read.past_cliffs: {header?, entry?}`
  section. When the active voice (resolved via the 4-layer order from
  #380) carries either template, boot's text-mode `past_cliffs`
  section re-renders through it: `header` may use `{count}`, `entry`
  may use `{id}/{action}/{cliff}/{closed_by}/{closed_at}`. Doctrinal
  voice fallback when no voice / no read section / no template — the
  augment-not-replace invariant carries from the write side (principle
  08 unchanged). JSON mode is untouched; structured `past_cliffs`
  preserves the data shape for orchestrators that compose their own
  narration. The 「過去の私からの手紙」 framing this section was always
  trying to surface now actually reads as a letter when an eris voice
  is wearing it.

  Boot gains `--since-last-mine`: sugar for `--since=<actor's last
  authored write>`. Internally resolves via
  `computeLastAuthoredWriteAt(GUILD_ACTOR)` and applies the same
  delta-filter semantic shipped in #375. Mutually exclusive with
  `--since` (usage error to pass both). Requires `GUILD_ACTOR`;
  without one, errors with a `next:` hint. Actor with no prior writes
  → cutoff stays null and boot returns the full snapshot (correct
  first-time-here behavior). Removes the agent-side
  read-last-activity-then-pass-it-back-as-ISO loop ─ the substrate
  owns the resolution. (#37x — eris-first refinement PR-B + PR-C
  bundled)

- **Voice polish bundle: dogfood-driven 4-fix pack.** Touch-feel pass
  through the cluster shipped in #380-#382 surfaced four refinements;
  bundled here so they ship together.

  **P0** `gate voice` masking hint fires only when an env source is
  winning. The pre-fix code emitted "higher-priority layer in effect"
  on any non-file resolution including `config`, but `config` is the
  BOTTOM layer — nothing was masking it, so the hint was misleading.
  Hint now keyed to `source === 'env'` only.

  **P1** `gate fast-track` fires ornamental voice on its `complete`
  segment. v1 wired voice through `gate complete` direct only;
  fast-track is the daily-use shortcut and was silent on the most
  common write surface. Same template (`verbs.complete`) fires on
  both paths now — eris's voice doesn't go quiet on the chained
  flow.

  **P2** text-mode voice marker changes from `(voice: …)` to
  `⟶ …` (U+27F6). The parenthetical form read as a debug label
  during dogfood; the arrow signals "voiced echo of what just
  happened" without the hedge. stderr-only as before, so JSON-piped
  consumers stay unaffected.

  **P3** `gate --help --essentials --compact` renders one usage line
  per verb instead of the full multi-line entry. Multi-line was
  defensible for tier rendering (BASE/COORDINATION/EXTRA where the
  audience is "everyone") but contradicted the essentials framing
  ("the verbs I reach for, at a glance"). `--compact` is opt-in;
  bare `--essentials` keeps the existing multi-line output, and
  `--compact` without `--essentials` is a noop on the tier surface.

  Existing voice envelope assertions updated for the new marker.
  (#37x — eris-first refinement polish PR, dogfood-driven)

## [0.5.0] — 2026-05-06

> **substrate self-improvement wave** (#207 / #208) closes the loop:
> guild-cli's own `gate` substrate was used to design and ship two
> guild-cli improvements — meta-experiment that doubled as a v0.5
> hardening pass.
>
> - **`gate boot` surfaces authored requests with new reviews**
>   ([#207](https://github.com/eris-ths/guild-cli/pull/207)). Adds a
>   fifth `ActionableKind` `reviewed-authored` (PRIORITY=4) lifted via
>   a derived `lastAuthoredWriteAt(actor)` boundary aggregating
>   `status_log[].at ∪ reviews[].at ∪ thanks[].at` per actor. Zero
>   persistence, READ/WRITE invariants intact, host/member treated
>   uniformly (string actor space). Designed entirely via the
>   guild-cli substrate at `data/guild/` (Noir v1→Devil reject→Noir
>   v2→Devil concern→Noir v3→Devil ratify→Miki impl).
> - **`<write-verb> --help` bypasses the lock**
>   ([#208](https://github.com/eris-ths/guild-cli/pull/208)). Detects
>   `args.options.help` after `parseArgs` and routes dispatch around
>   `withEntryLock` so help is never gated by a contended lock.
>   Closes [#200](https://github.com/eris-ths/guild-cli/issues/200).
> - **Wave 8 (#155 lock landing) + envelope contract (#194 / #205)**
>   — full notes below; v0.5 ships the locking substrate, the JSON
>   error envelope contract across all four entries, and the
>   handler-internal catch fix that closes the envelope gap left by
>   #204.

> **Cross-process write serialization** (#155 — landed via #193 as a
> single squash that combined PR-A and PR-B; docs follow as PR-C).
> Replaces "serialize at the caller" with `withGuildLock`, a
> content-root-wide single-writer mutex enforced by per-entry
> middleware across all five CLIs (`gate`, `guild`, `agora`, `devil`,
> `ctx`). The optimistic per-record CAS is retained as an in-process
> safety net.
>
> Convergence path: design (Eris + Noir) → devil-review surfaced 5
> ship-blockers (entry coverage, host self-attestation, `buildContainer`
> invariant, verb-set SOT, `doctor` chicken-and-egg) → all accepted →
> implementation (Miki) → real-machine validation (Asteria, 14
> scenarios) → final-gate devil pass (zero ship-blockers, 6
> follow-ups filed: #194 / #195 / #196 / #197 / #200 / #201).

### Added

- **`withGuildLock` + `withEntryLock`** lock primitive and middleware
  ([#155](https://github.com/eris-ths/guild-cli/issues/155),
   [#193](https://github.com/eris-ths/guild-cli/pull/193)).
  `${contentRoot}/.guild-lock` via `O_CREAT | O_EXCL`, JSON metadata
  payload, `unlink` in `finally`. Three reclaim branches: dead pid
  (`kill 0` → `ESRCH` with ancestor-pid safety valve), pre-boot lock
  (`os.uptime()`-derived), and `GUILD_LOCK_MAX_AGE_MS` env cap.
  Engaged by per-entry middleware that consults a per-passage
  `verbs.ts` exporting three sets (`READ_VERBS` / `WRITE_VERBS` /
  `LOCK_EXEMPT_VERBS`); decision order is EXEMPT → READ →
  acquire-lock (unknown verbs are fail-safe to the lock side).
  Cross-passage race is exercised in CI by
  `tests/integration/lock/cross-passage-race.test.ts` (spawn-based
  with a shared barrier file via `GUILD_LOCK_TEST_BARRIER`, no-op
  in production). `buildContainer` invariant pin tests on each
  passage (`tests/infrastructure/{gate,agora,devil,ctx}Container.test.ts`)
  catch any regression that would put a write side-effect ahead of
  the lock.
- **`LockBusyError` (DomainError subclass)** — JSON envelope code
  `lock_busy` on the gate path; non-gate parity tracked in #194.
- **`SECURITY.md` § Concurrent writes** rewritten to describe
  guildLock as the serialization boundary, with the threat-model
  caveat (writers with content_root access are out of scope) and
  links to the six follow-up issues.
- **`docs/storage-format.md` § Cross-process serialization** —
  on-disk contract for `.guild-lock` (path, payload shape, reclaim
  rules, test barrier env) so the format is documented alongside
  the rest of the substrate.

> **Touch-feel campaign** (5 PRs, 1 design issue). A P3 dogfood pass
> with fresh-agent eyes surfaced the same friction class repeatedly:
> "the user knows something is wrong / done / different but not what
> to do next." Each PR fixes one layer of that gap; together they
> compound — by the final dogfood, every error / not-found / state
> mismatch / list-shape touch point answers the next-move question
> inline. No architectural changes; substrate, domain, and persistence
> contracts unchanged.

### Added

- **Verb-help shows a runnable usage example.**
  ([#163](https://github.com/eris-ths/guild-cli/pull/163))
  PR #148 made `--help` a universal escape valve and printed each
  verb's flag catalog. What was still missing was a runnable
  invocation. `gate request --help` now reads:
  ```
  gate request: --action, --auto-review, --executor, --format, --from, --reason, --target, --with
    e.g. gate request --action "<what>" --reason "<why>"
    see `gate --help` for the full verb catalog.
  ```
  Examples live in `src/interface/shared/verbExamples.ts`, keyed by
  `cli → verb → string` (same-named verbs across CLIs need scoping
  so an `agora list --help` example doesn't render a `gate ...`
  command). Coverage tests pin the (cli, verb) pairs that exist; an
  invariant test asserts every example begins with its own verb name
  to catch copy/paste typos.

- **`requireOption` errors name the value shape and the env fallback.**
  ([#164](https://github.com/eris-ths/guild-cli/pull/164))
  Pre-fix: `error: Missing --from. --from required` — the second
  sentence repeated the flag name without saying what value to put
  there or that `GUILD_ACTOR` would have satisfied the call.
  Post-fix:
  ```
  error: Missing --from <m> (or set GUILD_ACTOR).
  error: Missing --persona <red-team|author-defender|mirror>.
  error: Missing --severity <low|med|high>.
  ```
  The third argument is renamed `usage` → `shape` (the value
  placeholder); the env hint `(or set <env>)` is composed in one
  place and propagates to every actor-flag callsite (~22 of them).
  All ~50 callsites swept to structured shapes — free text passes
  `"..."`, members `<m>`, enums spell their option set inline.

- **`assertTransition` lists valid next states.**
  ([#167](https://github.com/eris-ths/guild-cli/pull/167))
  Pre-fix: `error: Illegal state transition: pending → completed`.
  Post-fix:
  ```
  error: Illegal state transition: pending → completed.
    valid next states from pending: approved, denied.
  ```
  For terminal states (completed/failed/denied), the message reads
  `X is terminal — no further transitions are allowed` instead of
  empty `valid next: ` (which would have been more confusing than
  the rejection itself). State names are the only domain vocabulary
  added — verb hints belong in the interface layer and intentionally
  stay out of `RequestState.ts`.

- **`not found: <id>` gains a per-entity discovery hint.**
  ([#167](https://github.com/eris-ths/guild-cli/pull/167))
  Pre-fix: `not found: 2026-05-05-9999`. Post-fix:
  ```
  not found: 2026-05-05-9999
    try 'gate list' or 'gate tail' to see existing requests.
  ```
  Centralised in `notFoundMessage(entity, id)`. Three call shapes:
  request → `gate list` / `gate tail`; issue → `gate issues list`;
  member → `guild list`. Wired into `gate show`, `summarize`,
  `transcript`, `why`, `chain`, `issues note`, `guild show`.

- **`gate execute` notice when actor differs from `--executor`.**
  ([#169](https://github.com/eris-ths/guild-cli/pull/169) for
  [#168](https://github.com/eris-ths/guild-cli/issues/168))
  `--executor` records **intent**, not access — anyone with substrate
  access may run `gate execute`. Pre-fix, a fresh agent reading
  `--executor bob` reasonably interpreted it as a gate; when alice
  ran execute on bob's assignment, the substrate captured both but
  the surface gave no signal. Post-fix:
  ```
  notice: alice executed request 2026-05-05-0001 (assigned to bob); --executor records intent, not access.
  ```
  Mirrors the shape of the self-approve notice on `gate approve`.
  Silent when `--executor` was never set or matches the actor.
  AGENT.md cross-links #168 for the design rationale (recorded so
  future readers see the deliberate choice, not an oversight).

- **`gate list --state all` is sugar for "every state, no filter."**
  ([#170](https://github.com/eris-ths/guild-cli/pull/170))
  Pre-fix, `gate list --state all` errored `Invalid state: all`
  while the sibling `gate issues list --state all` already accepted
  it — broke muscle memory between the two list verbs. The hint
  shown when `--state` is omitted now mentions `| all` and includes
  a `gate list --state all` example line.

- **`guild` verbs honour `--help` like every other CLI.**
  ([#166](https://github.com/eris-ths/guild-cli/pull/166))
  PR #148 rolled out the universal `HelpRequested` /
  `rejectUnknownFlags` / `renderVerbHelp` mechanism across gate /
  agora / devil / ctx, but the operator-helper `guild` was out of
  scope. The 4 `guild` verbs (`list` / `show` / `new` / `validate`)
  now honour `--help` with the same shape and `guild new --bogus`
  no longer hardcodes `guild` in the unknown-flag error prefix.

- **`agora` / `ctx` / `devil` get the same did-you-mean as `gate`.**
  ([#173](https://github.com/eris-ths/guild-cli/pull/173))
  Typo'd verbs across the three passages now surface the closest
  matches inline rather than dumping the full HELP. Same Levenshtein
  shape gate already used. Also drops the `agora — v0 skeleton`
  label from agora's HELP block (alpha v1 has shipped).

- **`--version` reports a parseable version across all 5 CLIs.**
  ([#174](https://github.com/eris-ths/guild-cli/pull/174))
  Pre-fix, `gate --version` and `guild --version` printed
  `guild-cli <X.Y.Z>` while `agora` / `ctx` / `devil --version`
  printed status strings without a version number — a shell that
  did `agora --version | grep <version>` was silently broken. Each
  passage now prints `<cli> (under guild-cli <X.Y.Z>) — <status>`
  so the version is grep-able and the status remains visible.
  Also: `agora new` `suggested_next` points at `play` (the natural
  next step) instead of `list`.

- **`agora new` defaults `--kind sandbox` and `--title` to the slug;**
  **`agora move`'s next-hint stops repeating on every move.**
  ([#177](https://github.com/eris-ths/guild-cli/pull/177))
  `agora new --slug <s>` now works without `--kind` or `--title`,
  matching the most common opening shape (Sandbox plays without
  ceremony). And the `next: agora move ... | agora suspend ...`
  block that previously printed after every successful move was
  noise once a play got going — `move` is now a quiet `✓` line.

### Security

- **Sanitize absolute paths in CLI error messages.**
  ([#172](https://github.com/eris-ths/guild-cli/pull/172),
  closes [#153](https://github.com/eris-ths/guild-cli/issues/153))
  Errors from `safeFs` and friends carried the full resolved path
  (e.g. `/Users/alice/work/proj/substrate/requests/pending/foo.yaml`),
  incidentally leaking home-directory and checkout-location info
  into logs / screenshots / bug reports. Each CLI's main() catch
  now collapses the configured `contentRoot` prefix to the literal
  `<content_root>` token via `sanitizeError` (new pure function in
  `src/interface/shared/sanitizeError.ts`). The structural tail is
  preserved so debugging is not impaired. Paths outside contentRoot
  (`/etc`, `/tmp`, user-input absolute paths) are intentionally not
  sanitized — the threat model is single-user, trusted-environment.

- **Close `agora new` collision-error sanitizer hole.**
  ([#175](https://github.com/eris-ths/guild-cli/pull/175))
  Follow-up to #172. The `GameSlugCollision` branch returned 1
  directly from the handler instead of throwing, bypassing main()'s
  catch where `sanitizeError` runs — so its `At: <path>` line still
  leaked the absolute substrate path. Apply `sanitizeError` at the
  handler level so this alternate egress matches the contract every
  other error-path emission already holds.

### Changed

- **DomainError trailing `(field)` tag and `DomainError:` prefix
  dropped from human-readable error output across all five
  dispatchers** (gate / agora / devil / ctx / guild).
  ([#170](https://github.com/eris-ths/guild-cli/pull/170))
  Pre-fix: `error: Invalid lense: "bogus" ... (lense)` — the
  trailing tag was design intent at one point ("name which flag
  was bad") but read as redundant for flag-aligned fields and as
  debug noise for domain-internal fields (`(state)`, `(sequence)`).
  The `DomainError:` class-name prefix on agora/devil/ctx/guild
  also leaked an internal class name. JSON envelopes are unchanged:
  `error.field` still surfaces in `--format json` so orchestrators
  retain the structured info.

### Wave 7 — 4-passage convergence + agora sugar verbs

> Picks up where the touch-feel campaign closed. With `gate` /
> `agora` / `devil` / `ctx` all in active use, the cross-passage
> orientation surface (`gate boot`) finally caught up with the
> 4-passage reality, and agora grew two read-only sugar verbs to
> answer the daily-use questions ("which play am I in?", "what was
> I about to do?") that the v1 core didn't directly address.

- **`agora last` and `agora cliff` sugar verbs.**
  ([#179](https://github.com/eris-ths/guild-cli/pull/179))
  Two read-only verbs on top of the v1 core. `agora last` returns
  the actor's most recent open play (no `agora list` + copy
  required); `agora cliff <id>` peeks the closing
  cliff/invitation of a suspended play without resuming. Both
  preserve agora's JSON envelope contract.

- **`gate boot` cross_passage now surfaces ctx (4th passage).**
  ([#184](https://github.com/eris-ths/guild-cli/pull/184))
  ctx records existed on the substrate but `boot` only reported
  agora and devil activity. Added `ctxOrientation` provider; ctx
  in phase 1 is record-only (no transitions), so `open` is the
  count and `last_state` is `'recorded'`.

- **`agora list --state suspended` sorts by most-recent suspension.**
  ([#182](https://github.com/eris-ths/guild-cli/pull/182))
  Among suspended plays, the one suspended most recently shows up
  first — id-desc (creation date) was the wrong axis when the
  question is "what's been hibernating, and for how long?". Other
  states preserve the id-desc default. Re-sort happens in the
  handler; substrate contract unchanged.

- **`devil entry` lense/persona miss includes catalog + did-you-mean.**
  ([#185](https://github.com/eris-ths/guild-cli/pull/185))
  Typing `devil entry --lense bogus` now lists the 12 lenses + a
  Levenshtein "did you mean: --lense X?" hint on near-matches.
  Same for `--persona` (6 personas). Hint on stderr — JSON
  consumers reading stdout unaffected.

- **`gate boot` default `--tail` lowered 10 → 5 (principle 13).**
  ([#181](https://github.com/eris-ths/guild-cli/pull/181))
  `boot` is the hot-path bootstrap verb; default tail of 10
  produced ~250-line JSON. Override via `--tail <N>` unchanged.
  Codifies principle 13 "affordance density follows verb shape"
  added in [#180](https://github.com/eris-ths/guild-cli/pull/180).

- **Doc sweep: 4-passage architecture reflected across README/AGENT/etc.**
  ([#178](https://github.com/eris-ths/guild-cli/pull/178))
  Audit of cross-passage references caught 4 docs still framed
  around 3 passages. Updated to the current shape (gate / agora /
  devil / ctx).

### v1-prep — touch-feel follow-ups, hardening, contracts

> A focused pass to defendable v1 surface: a touch-feel friction
> that surfaced during a fresh-eyes review of the latest agora
> shape, three v1-prep items from the external deep-dive review
> (#153 sibling cluster), and one CI-signal-reliability bug.

- **`agora last` next-hint includes `--game <slug>`; `list --state
  suspended` text shows suspension timestamps.**
  ([#186](https://github.com/eris-ths/guild-cli/pull/186))
  Surfaced by a 2026-05-05 main-merge dogfood pass. Bare play-ids
  collide across games, so `agora last`'s `next:` hint produced a
  call that errored on the very next line. Hint is now
  `--game`-qualified, state-aware (playing → move/suspend, suspended
  → resume/cliff, concluded → no hint). `list --state suspended`
  surfaces the `at` timestamp so the post-#182 sort axis is visible.

- **Devil-review consistency follow-up: `--game` qualifier across
  play / suspend / resume next-hints.**
  ([#188](https://github.com/eris-ths/guild-cli/pull/188))
  Devil review on #186 caught that the `--game` fix landed only in
  `agora last` while the same hint shape lived unqualified in three
  other verbs. Same logic applies — extended consistently. Also
  documents `concluded`-state intent in `last.ts` and the
  serial-execution dependency of `withCleanCwd` (from #187).

- **Test isolation: `.guild-actor` file leak in develop-cut PRs.**
  ([#187](https://github.com/eris-ths/guild-cli/pull/187),
  closes [#183](https://github.com/eris-ths/guild-cli/issues/183))
  Three env-unset tests in `parseArgs.test.ts` silently failed in
  CI when the PR branch was cut from `develop` — that branch tracks
  `.guild-actor` at repo root for dogfood ergonomics, and PR
  branches inherit it; `resolveGuildActor()` reads both env AND
  file, so deleting `GUILD_ACTOR` alone didn't isolate the call.
  Wrapped affected tests in a `withCleanCwd()` helper. Regression
  test pins both the leak observability and the fix.

- **`docs/storage-format.md` — explicit on-disk YAML contract.**
  ([#189](https://github.com/eris-ths/guild-cli/pull/189),
  closes [#157](https://github.com/eris-ths/guild-cli/issues/157))
  POLICY.md declared the YAML shapes "stable surface" but never
  described them. New doc covers all 7 `Yaml*Repository` adapters:
  layout, fields, hydrate tolerance, versioning expressions,
  backward-compat rules table. Cross-linked from POLICY.md /
  AGENT.md / README.md. Out of scope: format changes themselves
  (separate concern, requires minor bump).

### Security

- **Defense-in-depth prototype-pollution guard in `parseYamlSafe`.**
  ([#190](https://github.com/eris-ths/guild-cli/pull/190),
  closes [#154](https://github.com/eris-ths/guild-cli/issues/154))
  Hydrate layer was leaning on `yaml`-lib's promise that `__proto__`
  lands as a literal key. Added independent guard at the
  `parseYamlSafe` chokepoint: walks the parsed tree, drops
  `__proto__` / `constructor` / `prototype` literal keys at every
  nesting level, rebuilds plain objects via `Object.create(null)`.
  No `Yaml*Repository.ts` changes needed — bracket-index reads work
  transparently. SECURITY.md known-hardening item now marked
  mitigated, sibling shape to #153.

### Tracked follow-ups

- **[#168](https://github.com/eris-ths/guild-cli/issues/168)** —
  `--executor` records intent, not access (closed by #169). Issue
  preserved in the substrate as the design-rationale anchor.

## [0.4.0] — 2026-05-03

> **Three-passage release.** Two new CLI passages land alongside `gate`:
> `agora` (second passage — play / narrative / exploration; suspend
> and resume as first-class primitives), and `devil-review` (third
> passage — security-backstop multi-persona scrutiny that composes
> with `/ultrareview` / Claude Security / supply-chain-guard). The
> three-passage architecture is named in `lore/principles/11-ai-first
> -human-as-projection.md`; the dispatch shorthand (gate=判断 /
> agora=探索 / devil=守備) is now in README / AGENT / per-passage
> READMEs; `docs/playbook.md` collects the cross-passage combos
> (including the bug-killing recipe). Two example content_roots
> are preserved as substrate (`examples/three-passages-framing/`
> shows agora's full propose→suspend→resume→conclude arc).

### Documentation

- **`docs/playbook.md`** ([#131](https://github.com/eris-ths/guild-cli/pull/131))
  — practical guide for combining `gate` / `agora` / `devil` on real
  work. Each section is a recipe: 6 gate-only patterns, 4 agora-only,
  4 devil-only, 4 combos (including the bug-killing flow as
  `issue → agora → gate (+ devil if security)`), and 8 tips for AI
  agents. Linked from AGENT.md (top callout), README.md (depth
  ladder), and docs/concepts-for-newcomers.md (Where-to-go-next).

- **判断 / 探索 / 守備 framing** ([#130](https://github.com/eris-ths/guild-cli/pull/130))
  — single-kanji + English shorthand for the three passages added to
  README / README.ja / AGENT / docs/concepts-for-newcomers + per-passage
  READMEs. Per principle 11 (AI-first), the framing is a dispatch
  tool, not a metaphor — AI agents recognize the shape and route
  to the matching passage. `examples/three-passages-framing/`
  preserves the agora play that captured the framing decision as
  a real artifact (concluded in [#132](https://github.com/eris-ths/guild-cli/pull/132)).

- **agora's `src/passages/agora/README.md`** rewrote post-merge
  (was stale "v0 skeleton" claim from snapshot phase; now reflects
  the v1 surface). New **`src/passages/devil/README.md`** parallel
  to agora's. **Post-merge cleanup pass** ([#128](https://github.com/eris-ths/guild-cli/pull/128))
  removed stale "snapshot / landing soon / v0 scaffold" markers
  across docs and code.

### Fixed

- **devil-review `--from scg` ingest: SCG now runtime-enforced as a
  mandatory delegate.** ([#126](https://github.com/eris-ths/guild-cli/issues/126)
  decision C; e-001 from devil-on-devil dogfood)
  Previously, the supply-chain lense's "mandatory delegate to SCG"
  claim in design docs was not actually enforced at runtime —
  `devil ingest --from scg` accepted any well-formed JSON matching
  the strict v0 shape, with no check that the input came from a
  real SCG run. A reviewer could fabricate a `verdict: CLEAR` JSON
  and satisfy the supply-chain lense gate without SCG ever
  running, defeating the floor-raising design intent.

  Post-fix, `--from scg` probes for the `scg` command on `PATH`
  via `which scg` (POSIX) or `where scg` (Windows) before
  proceeding. If scg is not found, the verb refuses with a
  structured error pointing at the install link
  ([eris-ths/supply-chain-guard](https://github.com/eris-ths/supply-chain-guard))
  and naming the design decision (#126 C) and the dogfood finding
  (e-001) for substrate-as-audit-trail.

  ultrareview / claude-security ingest paths are unchanged; only
  the scg path adds the binary check (it's the only source with a
  named delegate in the lense schema).

  Tests: a new test pins the refusal under an empty PATH
  environment, plus a paired test pins that `--from ultrareview`
  is unaffected. Existing scg-ingest tests now install a fake
  `scg` shim in a tmpdir and prepend it to PATH for the spawned
  devil process — testing the substrate without requiring SCG to
  be installed in CI.

### Added

- **`coherence` lense added to devil-review's bundled catalog (12th
  lense, bird's-eye-as-feature).** Surfaced as a methodology gap by
  mirror persona's e-014 synthesis during a post-merge devil-on-devil
  dogfood: the lense-coverage gate enforces lense-by-lense thinking
  but cannot detect cross-lense coherence drift; bird's-eye review
  had no first-class verb. Promoted to a lense so the audit posture
  itself is auditable. Catches: doc/code drift, naming
  inconsistencies between sibling verbs, contradictions between
  findings under different lenses, architectural-posture
  observations. Reviewers can now write `kind=finding` /
  `kind=resistance` / `kind=synthesis` entries on the `coherence`
  lense to record the bird's-eye observations a single-lense audit
  cannot reach. The `conclude` lense-coverage gate now requires an
  entry on `coherence` (or an explicit `kind=skip` with reason)
  alongside the other 11 — explicit-skip is the substrate-honest
  way to declare "we did not bird's-eye on this review."

### Added

- **`devil` — third passage under guild (alpha, security
  backstop).** ([#127](https://github.com/eris-ths/guild-cli/pull/127))
  A multi-persona, lense-enforced review surface that
  **composes with single-pass tools** (Anthropic `/ultrareview`,
  Claude Security, supply-chain-guard) rather than replacing
  them. Designed to **raise the security knowledge floor** for
  code reviewed by authors who haven't met OWASP top 10 — not
  to guarantee protection, but to keep the dialogue honest when
  a finding is dismissed.

  Complete v1 surface from #126: 11 verbs.

  - `devil open <ref> --type <pr|file|function|commit>` —
    start a review session against a target.
  - `devil entry <rev-id>` — append a hand-rolled entry.
    Per-kind validation: `kind=finding` requires `--severity`
    AND `--severity-rationale` (the friction that forces
    exploitability-context reasoning, Claude Security style);
    `kind=gate` is reserved for `devil ingest`.
  - `devil list` — enumerate reviews (filter by `--state` and
    `--target-type`).
  - `devil show <rev-id>` — full detail (entries / suspensions
    / resumes / conclusion); JSON form is `review.toJSON()`,
    same shape as the on-disk YAML.
  - `devil dismiss <rev-id> <entry-id> --reason <r>
    [--note "..."]` — mark a finding-entry dismissed with a
    structured reason (one of: `not-applicable | accepted-risk
    | false-positive | out-of-scope | mitigated-elsewhere`).
    Refuses re-dismiss and refuses dismiss-after-conclude.
  - `devil resolve <rev-id> <entry-id> [--commit <sha>]` —
    mark a finding-entry resolved, optionally citing the commit
    that landed the fix (`resolved_by_commit` becomes part of
    the substrate).
  - `devil suspend <rev-id> --cliff "..." --invitation "..."` —
    record a cliff/invitation pause on a thread of the review.
    Softer than agora's suspend: does NOT block other entries;
    just records re-entry context.
  - `devil resume <rev-id> [--note "..."]` — pick up the most
    recent un-paired suspension. Surfaces the closing
    cliff/invitation in the response.
  - `devil ingest <rev-id> --from <ultrareview|claude-security|scg> <input>` —
    append entries from an automated source's output. Strict
    v0 input JSON shapes per source; logs each invocation to
    `re_run_history`. SCG ingest produces one `kind=gate`
    entry on the `supply-chain` lense; ultrareview /
    claude-security produce N `kind=finding` entries.
  - `devil conclude <rev-id> --synthesis "<prose>"
    [--unresolved e-001,e-002,...]` — terminal state
    transition. Verdict-less close (no `ok|concern|reject`);
    synthesis prose is required. Lense-coverage gate: every
    lense in the catalog needs at least one entry (a
    `kind: skip` entry counts when its text declares why) —
    silent skipping defeats the floor-raising design.
  - `devil schema [--verb <name>]` — principle 10 dispatch
    contract for the passage.

  Substrate path: `<content_root>/devil/reviews/<rev-id>.yaml`
  (rev-id format: `rev-YYYY-MM-DD-NNN`, sequence per
  content_root per day).

  v1 lense catalog (11): `injection`, `injection-parser`,
  `path-network`, `auth-access`, `memory-safety`, `crypto`,
  `deserialization`, `protocol-encoding` (Claude Security's 8
  categories) plus `composition`, `temporal`, `supply-chain`
  (devil-specific). The `supply-chain` lense delegates to
  [supply-chain-guard](https://github.com/eris-ths/supply-chain-guard)
  (mandatory; hard-error if SCG is unavailable — the floor-
  raising design refuses silent skip on supply chain per #126
  decision C).

  v1 persona catalog (6): three hand-rolled — `red-team`
  (adversarial framing strict), `author-defender` (articulate
  the author's framing + assumptions), `mirror` (read both,
  surface contradictions and shared blind spots) — plus three
  ingest-only personas attributable only via `devil ingest`:
  `ultrareview-fleet`, `claude-security`, `scg-supply-chain-gate`.
  `devil entry` refuses to attribute hand-rolled entries to
  ingest-only personas (`PersonaIsIngestOnly`).

  Entry kinds: `finding` / `assumption` / `resistance` / `skip`
  / `synthesis` / `gate` (the last reserved for ingest paths).
  `assumption` and `resistance` are the load-bearing kinds for
  the design intent — `assumption` makes trust-assumptions
  explicit so they can be contested (`--addresses`); `resistance`
  holds verdict-less concern across re-entry without forcing it
  to `ok|concern|reject`.

  Architecture in practice:
  - principle 11 (AI-first): every verb's JSON envelope is the
    agent contract (snake_case, `where_written`, `config_file`,
    `suggested_next`); text mode is a projection. Stale-prose
    detector applied at the schema level (lessons from #121
    extended).
  - principle 10 (schema as contract): `devil schema`
    advertises every implemented verb's input + output.
  - principle 09 (orientation disclosure): every write verb
    emits the same `notice: wrote <abs> (config: <abs>)` line
    shape as `gate register` and `agora new`.
  - principle 04 (records outlive writers): all state mutations
    are append-only at the array level (entries / suspensions /
    resumes / re_run_history). Status mutation on findings
    (dismiss/resolve) replaces the entry value at the same id
    slot — append-only at the array level preserved.

  State machine (intentionally thinner than agora's):

  ```
  open ──── conclude ────▶ concluded   (terminal)
  ```

  No `suspended` state — suspend/resume cycles are append-only
  history and do **not** block other entries. Multiple
  reviewers can be working simultaneously; the cliff/invitation
  records re-entry context only. (Contrast agora's Play, where
  suspend genuinely blocks moves.)

  Optimistic CAS via `DevilReviewVersionConflict` on every
  appending operation; `saveConclusion` uses state-CAS
  (`open` → `concluded`); `replaceEntry` (used by dismiss /
  resolve) carries CAS on entries.length AND the targeted id.
  The CAS is *sequential* not atomic — it catches the
  load-then-act-then-write race that AI agents naturally
  produce when re-entering between sessions, but does NOT
  prevent two simultaneous writer processes from both passing
  the check (last-write-wins under true OS concurrency). Trust
  assumption named in the repository docstring: "one CLI
  process at a time per content_root."

  Strict v0 ingest input JSON shapes (per source) are
  documented in `src/passages/devil/interface/handlers/ingest.ts`.
  Real-world adapter shims that translate actual upstream tool
  output into those shapes are out of scope for the in-tree
  passage and would land as separate utilities.

  Design rationale, three-source landscape comparison
  (`/ultrareview` vs Claude Security vs SCG), the seven shapes
  single-pass review structurally misses, and decisions A–E
  (naming / lense catalog / SCG mandatory / severity_rationale
  required / gate entry kind) live in
  [issue #126](https://github.com/eris-ths/guild-cli/issues/126).

  Sister project (devil-review's `supply-chain` lense's
  delegate target): [eris-ths/supply-chain-guard](https://github.com/eris-ths/supply-chain-guard)
  — its 8-stage Devil Gate framework is a reference implementation
  of the adversarial-gate-sequence shape devil-review's own
  `kind: gate` entry was designed to ingest.

  Per-content_root custom lense override loader
  (`<content_root>/devil/lenses/<name>.yaml`) is intentionally
  out of scope for v1. The catalog interface (`LenseCatalog`)
  is the seam; v1 ships the bundled defaults adapter only.

  ~5,500 LOC, ~140 contract tests across 14 test files. Built
  iteratively on `snapshot/devil-review` (12 + 5 commits)
  through three dogfood passes — self-review of
  `YamlDevilReviewRepository.ts` surfaced the lense-coverage
  gate gap (e-006) before merge, and the cumulative
  skip-with-reason audit posture (e-014) was named as a
  side-effect of the gate's design.

### Fixed
- **agora `suggested_next.reason` no longer carries stale "(when
  implemented)" / "(... lands in subsequent commits)" prose.**
  ([#121](https://github.com/eris-ths/guild-cli/issues/121))
  agora landed one verb per commit, and each commit's reason
  string was written when the next verb was genuinely future.
  Subsequent commits made those verbs real but didn't rewrite
  the older reason strings. Post-fix, `agora new` and `agora
  move` reason text reads as post-implementation. Regression
  test in `tests/passages/agora/suggestedNextContract.test.ts`
  scans every agora verb's `suggested_next.reason` for known
  stale phrases — guards against drift returning.

  Surfaced by another Claude instance playing agora interactively
  with nao (see [#117](https://github.com/eris-ths/guild-cli/issues/117)).
  Principle 09 (orientation disclosure) adjacent — surface
  drifted from substrate.

### Changed
- **agora `suggested_next.args.by` is no longer pre-filled with
  the just-acted actor.**
  ([#122](https://github.com/eris-ths/guild-cli/issues/122))
  Pre-fix, `agora play / move / suspend / resume` all set
  `suggested_next.args.by` to the calling actor, implicitly
  recommending **same-actor continuation**. For Sandbox plays
  with multi-actor alternation (e.g., AI agent + human, or two
  AI personas), this biased the orchestrator toward "same
  person continues" — counter to the rhythm those plays take.

  Post-fix, `args.by` is omitted from all four. `args` carries
  only the load-bearing field (`play_id`); the orchestrator (or
  human + AI pair) decides who acts next per their own
  alternation model. Per principle 11 (AI-first, human as
  projection): agora's substrate doesn't carry policy about
  who runs verbs.

  Behavior change for any orchestrator that read `args.by`
  without questioning. The verb name (`suggested_next.verb`)
  and `args.play_id` are unchanged and remain the load-bearing
  recommendation.

  Regression test pins the absence of `by` for play / move /
  suspend / resume going forward.

### Added
- **`agora` — second passage under guild (alpha).** A play / narrative
  surface alongside `gate`'s request-lifecycle / review surface.
  Built on the container/passage architecture (PR #116) with
  `gate`'s substrate (safeFs, parseYamlSafe, GuildConfig,
  MemberName, parseArgs) reused without modification.

  Verbs (8 + schema):

  - `agora new` — create a Game definition (Quest or Sandbox)
  - `agora play` — start a play session against a Game
  - `agora move` — append a move (with optimistic CAS)
  - `agora suspend` — pause with **cliff** + **invitation** prose
    (the design pivot; substrate-side Zeigarnik effect)
  - `agora resume` — pick up; surfaces the closing cliff/invitation
    in success output so the re-entering instance reads what was
    paused on without a separate query
  - `agora conclude` — terminal state (playing or suspended →
    concluded; drift-away outcome valid)
  - `agora list` — enumerate games + plays (filterable)
  - `agora show <slug-or-play-id>` — detail view; for plays
    renders full move + suspension/resume history paired by index
  - `agora schema` — principle 10 dispatch contract for the passage

  Substrate path: `<content_root>/agora/games/<slug>.yaml` and
  `<content_root>/agora/plays/<game-slug>/<play-id>.yaml` (per-game
  subdirs scope plays to their definition; each game has its own
  sequence counter).

  Architecture in practice:
  - principle 11 (AI-first): every verb's JSON envelope is the
    agent contract (snake_case, `where_written`, `config_file`,
    `suggested_next`); text mode is a projection
  - principle 10 (schema as contract): `agora schema` advertises
    every verb's input + output; mechanical drift detector test
    enforces input-side equivalence (`tests/passages/agora/schema.test.ts`)
  - principle 09 (orientation disclosure): every write verb emits
    the same `notice: wrote <abs> (config: <abs>)` line shape as
    `gate register`
  - principle 04 (records outlive writers): all state mutations
    are append-only; suspensions and resumes are separate arrays
    paired by index; multi-cycle history preserved

  State machine:
  ```
  playing  ── move ──────▶ playing
           ── suspend ───▶ suspended
           ── conclude ──▶ concluded   (terminal)
  suspended ── resume ──▶ playing
           ── conclude ──▶ concluded   (drift-away outcome)
  ```

  All state-changing appends use optimistic CAS (`PlayVersionConflict`)
  — re-entering instances detect concurrent appenders rather than
  silently overwrite.

  Design rationale (Zeigarnik / rabbit tracker translation for
  AI agents, three-axis convergence of AI-first + gamification +
  human learning) lives in
  [issue #117](https://github.com/eris-ths/guild-cli/issues/117).
  Designed via the kiri/noir/mira three-voice review pattern; the
  pivot of `suspend / resume` as first-class primitives was
  surfaced by mira's mirror role.

  ~3500 LOC, 62 contract tests across 8 test files.

- **`lore/principles/11-ai-first-human-as-projection.md`.** Names
  the order-asymmetry every existing principle has been enacting
  without declaring: design decisions start from "is this AI-
  natural?", not from "is this human-friendly?" The substrate
  belongs to the agent's cognition; human-facing ergonomics are
  a projection layer assembled outside the substrate. Order is
  substrate → projection, never projection → substrate.

  Unlike principles 09 and 10 (which were waited-on for a third
  instance to surface the pattern), 11 was named immediately on
  recognition — it had been the latent stance the project chose
  for every prior decision (`gate` JSON-default, snake_case JSON,
  schema as contract, stderr-only notices, explicit flags refusing
  human-default-intuition, etc.) but had no written rule pushing
  back when "let's make it more human-friendly" PRs would chip
  the substrate. With 11 named, the question becomes structural:
  is the friendlier version a projection, or a substrate change?
  Projections welcome; substrate changes for human-friendliness
  not.

  Cross-referenced from principle 10 (schema-as-contract is one
  concrete face of 11). Will become the upstream rule for agora
  design ([issue #117](https://github.com/eris-ths/guild-cli/issues/117))
  so passage primitives don't re-litigate AI-first per primitive.

- **Schema/KNOWN_FLAGS drift detector test.** Mechanical CI
  enforcement of principle 10's input-side obligation: every flag
  the runtime accepts must appear in the schema, and vice versa.
  PRs #103 (`--dry-run`), #105 (`--with-calibration`), #111 (tail
  `--format`) all hit drift after-the-fact during fresh-agent
  dogfood; this test catches it at PR time.

  The test parses each handler's `*_KNOWN_FLAGS` declaration and
  the `rejectUnknownFlags(args, X, 'verb-name')` calls via static
  regex (no source export needed — KNOWN_FLAGS stays internal),
  builds a verb→flag-set map, and compares to the live `gate
  schema` output. Subcommand umbrellas (`issues`, `inbox`) are
  skipped because the schema collapses multi-handler verbs into a
  single entry — aligning that requires a schema-model change
  rather than drift fixing. The `list`/`pending` indirection
  (one function with conditional const choice) is handled via an
  explicit `INDIRECT_VERB_TO_CONST` allowlist in the test.

  **8 existing drift instances fixed in the same PR**, surfaced
  by running the detector against main:
  - `fail`/`review`/`transcript`: `id` description didn't start
    with `positional;` so the detector treated it as a flag.
    Updated the shared `idStr` const + `transcript`'s inline
    description to mark them positional.
  - `thank.for`: was using `idStr` (which is now positional) as
    a flag-typed id reference. Inlined a non-positional
    description for `for`.
  - `show`: schema lacked `--plain` and `--fields` (which the
    runtime accepted). Added with descriptions naming the
    agent-facing shell-composition use case.
  - `message`/`broadcast`: schema lacked `--type`. Added.
  - `repair`: schema lacked `--format`. Added.

  Going forward, a PR adding a flag to `KNOWN_FLAGS` without
  the matching `schema.input.properties` entry fails at CI.

- **`lore/principles/10-schema-as-contract.md`.** Names the rule
  three input-side drift PRs (#103 dry-run, #105 with-calibration,
  #111 tail format) and ~10 read verbs with bare output schemas
  had been making necessary without articulating: `gate schema`
  is the agent dispatch contract, in BOTH directions. Input side:
  every flag the runtime accepts must appear in
  `schema.input.properties`. Output side: every field the runtime
  emits must appear in `schema.output` (no bare `{ type: 'array'
  }` / `{ type: 'object' }` placeholders). This principle is
  **structurally one level UP from principle 09** — without
  schema-as-contract, "boot's missing-disclosure was a contract
  bug" reduces to "it was annoying"; with it, the asymmetry
  between schema claim and runtime delivery IS the bug.
  Surfaced via the kiri-author / noir-devil / mira-mirror three-
  voice review session in the dogfood sandbox. Mira's mirror
  role flagged that 09 was implicitly leaning on a foundation
  that wasn't named.

- **`gate tail` and `gate voices` output schemas fleshed out
  (first instance of principle 10's output obligation).** Pre-fix,
  both verbs declared `output: { type: 'array' }` with no `items`
  — an MCP wiring saw "an array of something" and had to
  discover the utterance shape empirically. Post-fix, a shared
  `utteranceArraySchema` describes every utterance kind
  (authored / review / thank), every shared field (`kind`, `at`,
  `request_id`), every kind-specific field
  (`from`/`completion_note`/`with` for authored;
  `by`/`lense`/`verdict`/`comment` for review;
  `to`/`reason` for thank), and the optional `invoked_by` proxy
  field. All snake_case (post-#109). Field documentation names
  which kind each field applies to so a JSON-Schema-driven
  consumer reads the discriminated-union semantics without
  needing `oneOf` (the JsonSchema subset gate uses doesn't
  include it). Tracked follow-ups for the remaining bare-output
  read verbs (`status`, `whoami`, `show`, `chain`, `list`,
  `pending`, `repair`, `issues *`) are listed in principle 10.

- **Runtime-validates-schema test for tail + voices.** Mira's
  design suggestion (review on req `2026-05-01-0001`): the
  schema becomes unforgeable when the actual JSON output is
  validated against the declared schema in CI. If the runtime
  emits a shape that doesn't match the schema, EITHER the
  runtime regressed OR the schema is wrong; either way, CI
  catches it at the boundary that matters (what an MCP wiring
  would actually receive). Hand-rolled draft-07-subset
  validator (no new dependencies); validator self-tests its
  own failure modes so the suite can't silently pass with a
  buggy validator. Same approach extends to the other read
  verbs as their schemas are fleshed in follow-ups.

### Tracked follow-ups
- **Schema/KNOWN_FLAGS drift detector test (input side).** PRs
  #103, #105, #111 each added a flag to a verb's `KNOWN_FLAGS`
  but had to add the matching `schema.input.properties` entry
  separately. A CI-level test that compares each handler's
  `KNOWN_FLAGS` against its schema entry is the natural
  enforcement vehicle. Queued as the next mechanical follow-up
  to principle 10 — the principle file names this explicitly.

- **Output schemas for the remaining bare-typed read verbs.**
  `status`, `whoami`, `show`, `chain`, `list`, `pending`,
  `repair`, and `issues *` still declare `output: { type:
  'object' }` / `{ type: 'array' }`. Each is mechanical (read
  the runtime, translate to JsonSchema, add a runtime-validates
  test). Done in clusters where multiple verbs share a shape:
  `show`/`list`/`pending` share the `Request` shape;
  `status`/`board` share the `StatusSummary` shape.

### Added
- **`lore/principles/09-orientation-disclosure.md`.** Names the
  rule three empirical PRs (#108 register stderr notice, #110
  boot text disclosure, this PR's doctor disclosure) had been
  re-deriving instance-by-instance: a verb whose output is a
  count / finding / status *about* a content_root must let the
  operator verify the content_root identity in surprising cases,
  and stay quiet otherwise. The conditional emission is the
  whole design — voice budget says we don't burn a line on the
  99% case where cwd === content_root and config sits where
  expected. Surfaced via the kiri-author / noir-devil / mira-mirror
  review session in the dogfood sandbox; mira's mirror role
  (paraphrase + meta-question) flagged that we'd been ad-hoc'ing
  the same pattern across PRs without naming the rule. Pinning
  it so the next opt-in (status? board?) doesn't re-litigate.

- **`gate doctor` discloses the resolved content_root + config
  when surprising.** Carries the principle 09 pattern to doctor.
  Pre-fix, `gate doctor` reported "members 1 total, 0 malformed"
  with no signal about WHICH content_root those numbers applied
  to. An operator running doctor from a subdir of an active
  guild had no clue the diagnostic walked up to a parent. Post-
  fix, doctor emits the canonical line shape ONLY when
  surprising:
    - Subdir of an active guild → `content root: /abs (config: /abs/guild.config.yaml)`
    - No-config fallback (cwd as implicit root, has data) →
      `content root: /abs (config: none — cwd used as fallback root)`
  Suppressed when `misconfigured_cwd` already fires (no-config +
  no-data, the bigger warning owns disclosure) so the operator
  sees exactly one disclosure surface at a time. `--summary`
  mode also discloses; `--format json` is unaffected (text-only
  per principle 09 boundary). New shared formatter
  `formatContentRootDisclosure` in `internal.ts` so a third
  caller doesn't copy-paste.

- **`gate tail --format json`** closes the asymmetry that left
  `tail` as the lone read verb without JSON output. Sibling verbs
  (`voices`, `list`, `board`, `show`, `status`, `whoami`,
  `inbox`, `issues list`) all support `--format json|text`; tail
  was bare-text-only. Empty stream emits `[]` (not an error
  envelope) so `jq` pipelines don't have to branch on "is this
  an array or an error". Utterance keys are snake_case
  (`request_id` / `invoked_by` / `completion_note` /
  `deny_reason` / `failure_reason`) inheriting the post-#109
  contract — shipping the rename first means tail's JSON debuts
  in the right shape and never goes through a transient
  camelCase phase. The `gate schema` entry for tail now
  advertises both `limit` and `format` flags so MCP wirings
  discover them. A typo on the format value (`--format josn`)
  rejects loudly rather than silently degrading. Devil-reviewed
  in design sandbox (`2026-05-01-0001`).

### Fixed
- **`gate boot --format text` surfaces `content root: <path>
  (config: <path>)` when the situation is surprising.** Sibling
  to the PR #108 register-notice fix: closes the silent parent-
  config-pickup gap on the READ side. Pre-fix, `gate boot --format
  text` showed neither `config_file` nor `resolved_content_root`
  (both fields existed in the JSON envelope but the text
  rendering omitted them), so an agent who ran boot for
  orientation got no path signal even when the cwd was a subdir
  of an active guild and gate had silently walked up to a
  parent's `guild.config.yaml`.

  Post-fix, the orientation block emits one line **only when the
  situation is surprising** — voice budget is preserved by
  staying silent at the alignment case (cwd === resolved
  content_root, config present and discovered). Two trigger
  cases:

  - **Subdir of an active guild** (`cwd != resolved_content_root`)
    — `content root: /abs/path (config: /abs/path/guild.config.yaml)`
  - **No config found, cwd used as fallback** (`config_file ===
    null` and there's data) — `content root: /abs/path (config:
    none — cwd used as fallback root)`

  Suppressed when `misconfigured_cwd` already fired (no-config +
  no-data, the bigger warning takes over) so the disclosure is
  surfaced exactly once. JSON envelope gains `cwd_outside_content_root`
  boolean for orchestrators reading the structured contract.
  Phrasing matches PR #108's `(config: ...)` segment for cross-
  verb recognition. Devil-reviewed (`2026-05-01-0001`/`0002`);
  v2 absorbed the voice-budget concern (D1) by gating the
  emission on the surprising cases.

### Changed
- **`gate voices` / `gate tail` JSON: `request_id` / `invoked_by` /
  `completion_note` / `deny_reason` / `failure_reason` (was:
  `requestId` / `invokedBy` / `completionNote` / `denyReason` /
  `failureReason`).** The voices stream is the project's
  highest-traffic JSON surface and was the lone camelCase outlier;
  every other JSON surface (`gate show`, `gate inbox`, `gate
  status`, `gate register` JSON envelope, `gate boot.hints`, etc.)
  was already snake_case (`created_at`, `read_at`, `display_name`,
  `auto_review`, `status_log`, `where_written`, `config_file`).
  The mismatch made cross-tool consumers carry a translation layer
  for one stream only.

  Single-cycle cut per 0.x policy (same shape as the `displayName
  → display_name` rename in PR #102) — no dual-emit phase. Fresh-
  agent dogfood (post-PR #107) surfaced the inconsistency; devil-
  reviewed (`2026-05-01-0001`/`0002`) to confirm scope: rename
  the TS fields too so the text-path readers (`renderUtterance`
  in `voices.ts`, the `tail` summary block in `boot.ts`, the
  bilingual `resume.ts`) stay consistent with the JSON. The
  `gate schema` declarations did not advertise the voices output
  shape, so no schema update was needed.

  Downstream JSON parsers (MCP wirings, ad-hoc scripts) that
  read these fields must update key names. Records on disk are
  unchanged — this is purely an output-shape rename, not a
  storage migration.

### Fixed
- **`gate register` surfaces the absolute path it wrote, on both
  stderr (humans) and JSON (orchestrators).** Closes the silent
  parent-config-pickup gap a fresh-agent dogfood surfaced. Pre-
  fix, running `gate register --name newcomer` from a subdir of
  an active guild silently walked up the tree, found the parent's
  `guild.config.yaml`, and wrote `<parent>/members/newcomer.yaml`
  with no signal — the agent had no clue their YAML landed in
  someone else's repo. Same gap hit no-config-found cases (cwd
  used as the implicit content_root).

  Post-fix, `gate register` emits one stderr notice on success:
  ```
  notice: wrote /abs/path/members/<name>.yaml (config: /abs/path/guild.config.yaml)
  ```
  When no config was discovered the second segment becomes
  `config: none — cwd used as fallback root`, naming the implicit
  default explicitly. The JSON success envelope gains
  `where_written` (absolute path of the saved file) and
  `config_file` (absolute path of `guild.config.yaml` in use, or
  `null`) so MCP consumers parse structured fields rather than
  scraping stderr.

  Symmetric on `--dry-run`: the preview header now shows the
  absolute path (was: relative `members/<name>.yaml`) and the
  stderr notice fires with `would write` (not `wrote`) so the
  preview is not less honest about location than the real write.
  Notice does NOT fire on error paths (collision, host-name
  reservation, validation) — pinned by test. Devil-reviewed
  (`2026-05-01-0001`/`0002`); v2 absorbed the JSON-contract,
  dry-run-symmetry, and error-boundary concerns.

- **`gate doctor` surfaces unrecognized .yaml files and unexpected
  subdirectories under `requests/`.** Pre-fix, `listByState`'s regex
  filter (`^\d{4}-\d{2}-\d{2}-\d{3,4}\.yaml$`) silently dropped
  off-pattern entries — a `bad.yaml` in `requests/pending/`, a
  `2026-05-01-7.yaml` (wrong digit count), an `oops-dir/`
  subdirectory under `<state>/`, or even a properly-named
  `2026-05-01-9999.yaml` placed at `requests/` root (wrong directory
  level) — all stayed there forever and `gate doctor` reported the
  root as clean. Two new finding kinds: `unrecognized_file` (off-
  pattern .yaml in any record location) maps to quarantine in
  repair (gate ignores them anyway; moving to `quarantine/` is safe
  and reversible). `unrecognized_directory` (subdir under `<state>/`
  or non-state directory at requests/ root) maps to **no-op** —
  contents are unknown and quarantining a tree is invasive; the
  operator must inspect first. Boundary: only `.yaml` files and
  directories are flagged; `notes.txt`, `README.md`, `.gitkeep`
  and other repo artifacts are intentionally ignored. Devil-
  reviewed (`2026-05-01-0001`/`0002`).

- **`gate doctor` extends the unrecognized-file scan to `issues/`
  and `members/`.** Same shape of fix as the requests-side scan,
  for the same class of bug. Pre-fix, an `i-bogus.yaml` in
  `issues/` (typo'd id), a capitalised-prefix `I-2026-05-01-0001.yaml`,
  or — most painfully — an `Alice.yaml` in `members/` (uppercase
  first letter) were silently dropped by each repository's listAll
  regex (`^i-\d{4}-\d{2}-\d{2}-\d{3,4}\.yaml$` for issues,
  `^[a-z][a-z0-9_-]{0,31}\.yaml$` for members) and `gate doctor`
  reported a clean root while the member was missing from `gate
  list`. Now each off-pattern `.yaml` surfaces as
  `unrecognized_file` (→ quarantine in repair) and any
  subdirectory under `issues/` or `members/` surfaces as
  `unrecognized_directory` (→ no-op in repair, contents unknown
  and quarantining a tree is invasive). The four common
  member-name typos covered explicitly by tests: uppercase first
  letter, leading digit, leading underscore, name >32 chars.
  Boundary unchanged: only `.yaml` files and subdirectories are
  flagged; `notes.txt`, `README.md`, `.gitkeep` ignored.

  Internal cleanup absorbed (devil-review concern D1 from
  `2026-05-01-0001`): each repo now exports a single
  `*_FILE_PATTERN` constant that both `listAll` (filters records)
  and `listUnrecognizedFiles` (surfaces non-matches) consume, so
  the two paths cannot drift. Pre-fix, `YamlRequestRepository`
  duplicated the same regex literal across two methods — latent
  drift bug surfaced by the design sandbox and fixed at the same
  time. The shared port type renamed `UnrecognizedRequestFile` →
  `UnrecognizedRecordEntry` and moved to its own module
  (`src/application/ports/UnrecognizedRecordEntry.ts`); 5
  callsites updated mechanically. Devil-reviewed
  (`2026-05-01-0001`/`0002`).

### Deferred
- **Cross-area unrecognized-file scan.** A file with the wrong
  area's pattern sitting in the wrong area (e.g., an
  `i-2026-05-01-0001.yaml` left under `members/`, or
  `alice.yaml` left under `issues/`) is still invisible because
  each scan only walks its own area and only flags files that
  don't match its OWN pattern. The misplaced file matches the
  member pattern so the issues-area scan ignores it, and vice
  versa. Out of scope for this PR — the cross-area decision
  depends on whether such files should auto-relocate or just be
  flagged, which is a policy choice this PR doesn't have a basis
  for. Recorded so a future reader who hits "I have an
  i-prefix file in members/ and doctor doesn't see it" finds the
  trail. Devil-reviewed concern D3 from `2026-05-01-0001`.

- **Voice calibration: `verdict=concern + state=failed` counts as
  aligned.** The source-code header in `src/interface/gate/voices.ts`
  documented v1 alignment rules including
  `verdict=concern + state=failed → aligned (you flagged it, it
  broke)`, but the implementation had `// verdict === 'concern'
  intentionally excluded` and dropped ALL concern verdicts from
  both counts. Reviewers who used `concern` as their primary signal
  got zero calibration credit and registered as `uncalibrated`
  forever. Doc-code drift; the code now matches the documented
  rules: `concern + failed → aligned`, `concern + completed → soft`
  (excluded). The `reject + completed → overruled` case keeps its
  existing "counted as missed" semantic, and a comment now names
  the choice (the alternative — "the risk you flagged was
  reviewed and held" — isn't separately observable from the record
  alone, so we pick the conservative work-as-evidence read).
  Devil-reviewed (`2026-05-01-0001`/`0002`).

- **`gate schema`: voices entry declares `--with-calibration`** with
  a description that names the JSON-only semantic honestly: the
  flag opts into the `{utterances, calibration}` JSON object shape
  (default: bare array), but text mode emits the calibration footer
  regardless of this flag. Pre-fix the runtime accepted the flag
  via `KNOWN_FLAGS` but the schema didn't declare it, and the
  text-mode behaviour was undocumented — fresh agents reading the
  schema saw an undocumented flag and a hidden text-mode override.

- **`gate review`: empty editor body aborts with a context-aware
  error.** Pre-fix, when the user opened the editor (no
  `--comment`/positional/stdin) and saved without writing,
  `readCommentViaEditor` returned an empty string and the caller's
  generic `review comment is required (use --comment <s>, …, or
  run interactively so $EDITOR opens)` error fired — but the
  "run interactively" hint was misleading because the user had
  just done so. Post-fix the editor flow throws its own message:

      editor returned an empty review body; aborting. Re-run and
      write content above the scissors line, or use --comment /
      --comment - / a positional.

  Surfaces the empty effort at the layer that produced it; matches
  `git commit`'s "empty message aborts" semantic. The function
  docstring (which already named this throw, but pre-fix the
  implementation only honored the editor-failure cases) is now
  honest. Devil-reviewed (`2026-05-01-0001`/`0002`); the user-
  facing message dropped its "matches git commit behavior"
  rationale — that justification belongs in the source comment,
  not in the recovery instructions.

- **`gate schema` declares `dry-run` on every write verb that
  accepts it.** Pre-fix the schema entries for approve / deny /
  execute / complete / fail / review / thank did NOT declare
  `dry-run` as an input property — so MCP wirings reading `gate
  schema` saw a tool surface strictly less capable than the
  runtime (which accepted `--dry-run` via KNOWN_FLAGS). `register`
  declared it but as a string; the parser treats it as a boolean
  flag with optional `=true`/`=false` suffix. Now all eight verbs
  share a single `dryRunField` declaration (`{type: 'boolean'}`)
  pointing at the preview-envelope contract. Fresh-agent dogfood
  surfaced; devil-reviewed (`2026-05-01-0001`/`0002`) to extend
  the fix to register so the asymmetry doesn't just move.

- **`gate <verb> --dry-run --format text` emits a one-line stderr
  notice naming why the format is fixed.** The dry-run envelope
  (dry_run / verb / would_transition / preview) has no useful
  text rendering, so stdout stays JSON regardless of `--format`.
  Pre-fix: silent JSON when `--format text` was passed. Post-fix:
  `# --dry-run preview is structured (json envelope); --format
  text would lose dry_run/verb/would_transition.` Suppressed for
  `--format json` (pipelines stay clean).

### Deferred
- **`--dry-run` coverage on creation/annotation verbs.** Ten verbs
  do not yet support the preview envelope: `request`, `fast-track`,
  `message`, `broadcast`, `issues add`, `issues note`,
  `issues start`/`defer`/`resolve`/`reopen`, `issues promote`. The
  help text scopes "any write verb above" to the
  approve/deny/execute/complete/fail/review/thank set, so the
  current state is asymmetry-by-design rather than a bug; expanding
  to the creation/annotation set requires either handler-side
  preview construction or use-case-side dry-run flag plumbing.
  Recorded here so a future reader who hits `gate request --dry-run:
  unknown flag` finds the trail rather than silence.

### Changed
- **Member YAML: `displayName` → `display_name` on save.** Aligns the
  one camelCase field on disk with the rest of the project's
  snake_case convention (`auto_review`, `read_at`, `status_log`,
  `created_at`, `invoked_by`). The hydrate path
  (`YamlMemberRepository`) already accepts both forms; new writes
  always use snake_case. Existing member YAMLs in users'
  content_roots keep loading. Bundled fixtures
  (`examples/quick-start`, `examples/dogfood-session`,
  `examples/agent-voices`) migrated mechanically. Single-cycle cut
  per 0.x policy — no dual-emit phase. Devil-reviewed
  (2026-05-01-0001/0002).

### Added
- **`gate whoami` surfaces `display_name`.** When a member YAML
  carries a `display_name`, the orientation line now reads
  `you are noir — Noir (Critic) (member)` rather than the pre-fix
  `you are noir (member)` which hid the chosen presentation. Em-
  dash separator follows the pattern other surfaces use to compose
  name/label pairs; the trailing role-in-parens is unchanged. When
  no display_name exists, the line stays in its original concise
  form.

- **`gate inbox --format json` + self/inactive message advisories.**
  Three friction points on the messages surface a fresh-agent
  dogfood surfaced. (1) `gate inbox --format json` now emits an
  array of inbox-entry objects with snake_case keys
  ({from, to, type, text, at, read, read_at?, read_by?,
  invoked_by?, related?}). Optional fields are OMITTED when
  undefined (matches `gate show` JSON convention). (2)
  `gate message --from X --to X` (self-message) emits a stderr
  notice — same shape as the existing self-approve notice. The
  act is allowed and recorded; the writer sees the edge they
  crossed. (3) `gate message --to <inactive>` emits a stderr
  notice naming the consequence ("the message landed in their
  inbox but they may not be reading it"). `gate broadcast`
  already filters inactive recipients; the DM path was silent —
  asymmetric. The notice closes the asymmetry without making a
  policy choice (deliver-or-block) the PR doesn't have a basis
  for. Devil-reviewed (`2026-05-01-0001`/`0002` in design
  sandbox); v2 absorbed phrasing trims and the omit-when-
  undefined JSON shape rule.

- **`gate issues list` JSON output + `--state all` + bare-issues
  hint.** Closes four discoverability gaps a fresh-agent dogfood
  surfaced. (1) `--format json` now emits an array of nested issue
  objects (notes preserved as a sub-array, not flattened as in text
  format). (2) `--state all` returns every state in one call;
  previously a reader had to invoke list four times. (3) When
  `--state` is omitted, a stderr hint discloses the implicit
  open-only filter and names the open-vs-active distinction with
  `gate status`'s count: `# filtered to state=open; status counts
  open+in_progress (active) — --state to override`. (4) A bare
  `gate issues` (no subcommand) used to silently fall through to
  list; it now emits a short hint at the most-common subcommands
  and exits 1, mirroring how `gate list` handles missing `--state`.
  The list semantics (worklist = open) and the status semantics
  (triage = open+in_progress) intentionally differ — the difference
  is exposed at the surface that produces the count, not papered
  over by aligning them. Devil-reviewed
  (`2026-05-01-0001`/`0002` in design sandbox).

- **`lore/principles/08-voice-as-doctrine.md` + voice-budget audit.**
  Names the principle that the tool's prose — `suggested_next.reason`,
  schema descriptions, footers, finding messages — is the running
  embodiment of lore, the substrate by which 02 (advisory not
  directive), 03 (legibility costs), and 07 (perception not judgement)
  reach readers who do not open `lore/`. The companion test
  `tests/interface/voiceBudget.test.ts` enumerates named pedagogical
  phrases ("all first-class", "DETECTOR, not an enforcer", "advisory —
  override freely", and four others), each with a budget and an
  allowed-files list. New occurrences fail the test until
  `VOICE_BUDGET` is updated with rationale in the same commit. The
  test is a detector for proliferation; paraphrase escapes it
  (LLM-difficult to detect verbatim) and that limitation is named in
  the test header. `CONTRIBUTING.md` (new) documents the workflow.
  No source-code behavior changes — this is a discipline added at
  the CI surface, not the runtime surface.
- **`gate unresponded` (read verb).** Surfaces concern/reject
  verdicts on the actor's authored or pair-made requests that have
  no follow-up record yet. Thin wrapper over the same
  `UnrespondedConcernsQuery` that drives `gate resume`'s concerns
  surface, so the two cannot diverge. Default actor is GUILD_ACTOR;
  `--for <m>` and `--max-age-days <N>` override. Naming aligns with
  the underlying detector's "unresponded" semantic — explicitly NOT
  `gate concerns` (which would suggest "all concerns" rather than
  "concerns without follow-up"). The detector is deliberately coarse
  (existence-only follow-up detection); `gate chain <id>` walks the
  actual references when the reader wants to verify whether a
  follow-up addresses anything specific. Surfaces the gap that bit
  first-time agents: a `concern` verdict on a completed request was
  not visible from any read path short of re-running `gate resume`.
  (refines 2026-05-01-0003)

- **`gate show` adds a concern marker line.** A binary existence
  signal — `no concerns recorded` / `concern recorded — walk gate
  chain ...` — sits next to the existing `chain hint` line.
  Existence-language deliberately, NOT a count: counting ("3
  concerns, 1 follow-up") would invite the reader to play a "drive
  the number down" game (principle 03 — performance-for-the-record).
  The original design called for a 3-state marker (concern + inbound
  / concern + no inbound / no concerns); resolving inbound presence
  at show time would require an async repository scan, so the
  shipped form punts that resolution to `gate chain <id>` (named
  inline in the marker text). The reader gets the same perception
  affordance with one extra command rather than via formatRequestText
  becoming async.

- **`gate boot` adds `verbs_available_now.requires_other_actor`.**
  A sibling array to `actionable` (which keeps its existing flat
  shape — additive change). Each entry names `{verb, id, candidates,
  reason}`: a verb that exists on the actor's record but cannot be
  dispatched by them as themselves. Surfaces blockers (e.g. "your
  pending request needs approval by host X") so the actor sees WHY
  their queue isn't moving without parsing `suggested_next` prose.
  `candidates` is a list, not a single name, so a content_root with
  N hosts (or zero) doesn't have to embed a "first host" assumption
  in the payload. The host-self case is filtered out (a host who
  authored a pending request sees it under `actionable` via
  pending-as-executor, not under `requires_other_actor`).

- **`SuggestedNext.actor_resolved: boolean`.** New field on the
  write-response, boot, and resume `suggested_next` payloads. True
  iff `args.by` is absent or matches the calling actor (GUILD_ACTOR);
  false when the suggestion names a different actor. Lets an
  orchestrator branch (escalate / hand off vs. dispatch as self)
  without parsing the verb's `--by` against the env. Hint, not gate
  — the underlying verb still validates `--by` at the boundary.
  Schema description names the discipline so a reason-skipping loop
  is structurally redirected.

- **Concern advisory on completed-with-concern reviews.** When a
  completed request carries a `concern`/`reject` review (and its
  auto-reviewer, if any, has recorded), `suggested_next` returns a
  `chain` walk advisory rather than null: verb is read-only (`chain`)
  to avoid embedding a dispute-resolution flow in the tool's voice;
  reason names follow-up paths AND explicitly lists "leaving as-is,
  conversing it out, or letting it fade — all first-class." The
  absence of action stays structurally legitimate. Replaces the
  prior null-after-review behavior for the concern case only — `ok`
  verdicts still close the arc cleanly with `null`.

- **`gate transcript` ends with a `Concerns recorded` section.**
  Bare enumeration of `concern`/`reject` verdicts in the request,
  pointing at `gate chain <id>` for reference resolution. No
  status language ("still open", "addressed by"), no severity —
  the tool surfaces existence; status judgement stays with the
  reader (principle 07).

- **`FsInboxNotification.post` / `markRead` retry once on
  `InboxVersionConflict`.** When a concurrent writer advances the
  on-disk version between our read and the CAS check, the first
  attempt throws; the retry re-reads the now-advanced file and
  commits on top. Safe because post is append-only (order may
  shift but side-effects don't duplicate) and markRead is
  idempotent (already-read entries stay read). Two consecutive
  conflicts still bubble up so a three-or-more simultaneous-writer
  scenario surfaces to the caller instead of looping forever.
  Closes devil's C4 on hiroba `2026-04-22-0002`. (PR #84)

- **Issue repository now uses atomic write + optimistic-lock CAS.**
  `YamlIssueRepository.save` writes via `writeTextSafeAtomic` and
  rejects concurrent mutations with a new `IssueVersionConflict`
  (parallel to `RequestVersionConflict` and `InboxVersionConflict`).
  Closes the asymmetry where Request and Inbox were locked but Issue
  was last-writer-wins — which had self-defeated the state_log
  append-only invariant when two `gate issues resolve / note` calls
  raced. Version counter = `state_log.length + notes.length`
  (monotonic, append-only domain operations). Legacy issues still
  hydrate cleanly; the first save after upgrade follows the new path.
- **`gate repair` and `gate doctor` join the strict-flag rejection
  set.** Typos like `gate repair --aply` (which used to silently
  stay in dry-run) or `gate doctor --summry` (which used to show
  the full report instead of the summary) now error with the valid
  flag list. Brings these two verbs into parity with the write-verb
  suite shipped earlier.

### BREAKING
- **`gate issues resolve` / `defer` / `start` / `reopen` now require
  `--by <m>` (or `GUILD_ACTOR`).** Issue state transitions now append
  to a `state_log: [{state, by, at, invoked_by?}]` array (parallel to
  Request's `status_log`), and the transition cannot be recorded
  without knowing who performed it. Migration: add `--by <name>` to
  any scripted issue state-transition invocation; `GUILD_ACTOR`
  continues to work as fallback. `Issue.setState(next)` →
  `Issue.setState(next, by, invokedBy?)` at the domain level;
  `IssueUseCases.setState(id, state)` → `setState(id, state, by,
  invokedBy?)`. Legacy issue YAML (no `state_log`) hydrates cleanly
  as `[]` so existing records open fine — the audit trail starts
  from the first post-upgrade transition. (PR #81)

### Added
- **Issue state transitions now produce an append-only `state_log`.**
  Every resolve / defer / start / reopen records one entry
  `{state, by, at, invoked_by?}` (mirrors Request `status_log`), max
  100 entries per issue. Forensics for flapping (`open → resolved →
  open → resolved`) previously collapsed to only-the-final-state;
  state_log preserves the transition history. Empty arrays are
  omitted from `toJSON` so byte-identical YAML output survives
  issues that haven't transitioned. (PR #81, Sec H3)
- **Strict unknown-flag rejection extended to all write verbs.**
  `rejectUnknownFlags` (previously opted-in by `gate tail` only)
  now runs in every write verb: `register`, `request`, `approve`,
  `deny`, `execute`, `complete`, `fail`, `fast-track`, `review`,
  `thank`, `message`, `broadcast`, `inbox`, `inbox mark-read`, and
  all `issues` subcommands. Typos like `gate register --catgeory X`,
  `gate request --executr noir`, `gate thank --reasn "..."` now
  error with a list of valid flags instead of silently doing the
  wrong thing. (PR #81, Sec H1)
- **Inbox writes are atomic with optimistic-lock (`InboxVersionConflict`).**
  `FsInboxNotification.post` and `markRead` now use
  `writeTextSafeAtomic` and maintain a monotonic `version: N`
  counter for compare-and-swap. Concurrent writers that would
  previously last-writer-wins (silently dropping a message or a
  read flag) now surface an `InboxVersionConflict` the caller can
  retry. Exported from `application/ports/NotificationPort.ts`
  alongside the existing `RequestVersionConflict`. Legacy files
  without `version` hydrate as 0 so first post-upgrade save
  proceeds without a false conflict. (PR #81, Sec H2)
- **Shared `sanitizeText` helper at `src/domain/shared/sanitizeText.ts`.**
  Replaces four hand-written near-duplicates (Request, Issue,
  Review, MessageUseCases). Options: `{maxLen, requireNonEmpty?,
  trim?}`. Behavior is preserved per call site (Review keeps its
  existing `trim: false` / `requireNonEmpty: false` drift
  intentionally, flagged as a named follow-up). New policy changes
  (e.g. emoji / BOM handling) can now land in one place instead
  of four. (PR #81, Refactor H1)
- **`actionableTransitions()` as single source of truth in boot.**
  `deriveBootSuggestedNext` and `deriveVerbsAvailableNow` both
  consume one predicate set (`executing-mine`, `unreviewed-mine`,
  `approved-for-me`, `pending-as-executor`) with declared priority,
  instead of hand-coding the same four predicates in each function.
  Byte-identical output; future state additions are guided by
  TypeScript's exhaustiveness check on `ActionableKind`. (PR #81,
  Refactor H2)
- **`gate show <id> --format text` now prints a chain-hint footer.**
  The footer scans `action` / `reason` / `completion_note` /
  `deny_reason` / `failure_reason` / `status_log[].note` /
  `reviews[].comment` for full-id references (`YYYY-MM-DD-NNN...`)
  and reports either `"chain hint: no outbound id references
  detected"` or the list of referenced ids. Read-time surfacing only
  — the write path is untouched, so writers stay free-form while
  readers can see at a glance whether `gate chain <id>` will return
  anything. Short-form `(0004)` is intentionally not detected
  (that's the case the hint is warning about). Self-ids are
  excluded. See also the expanded paragraph in
  [`docs/verbs.md`](./docs/verbs.md#chain-cross-reference-walks). (PR #72)
- **Strict unknown-flag rejection helper, with `gate tail` as the
  pilot caller.** `rejectUnknownFlags(args, known, verb)` lives in
  `src/interface/shared/parseArgs.ts`. Verbs opt in individually;
  `gate tail` now errors with a clear message (and lists the valid
  flags for the verb) instead of silently ignoring a typo like
  `gate tail --from noir`. Other verbs migrate in follow-up PRs —
  the opt-in model is deliberate so existing invocations don't break
  en masse. (PR #73)

### Changed
- **README minimized; the repo's top-level surface is the entrance,
  and the entrance should be small.** README dropped from 478 to ~96
  lines: the depth ladder + a one-line link to `lore/` are the load-
  bearing parts. The verb cookbook, configuration block, file-layout
  diagram, state-machine diagrams, "what this tool does NOT do" list,
  and tests-detail block were redundant against `AGENT.md` /
  `docs/verbs.md` and now defer to those files. Top-level git tree
  shrank from 22 to 18 entries: `POLICY.md` → `docs/POLICY.md`,
  `guild.config.yaml.example` + `members.example/` →
  `examples/quick-start/`, `scripts/run-tests.mjs` → `tests/run.mjs`.
  GitHub-conventional files (`README.md`, `LICENSE`, `SECURITY.md`,
  `CHANGELOG.md`, `.github/`) untouched. `lore/` stays at top so
  ls-ing the repo surfaces the load-bearing thinking next to the
  code, not buried under `docs/`. Doc / code refs follow the moves.

### Fixed
- **`save()` no longer throws spurious `RequestVersionConflict` when
  `reviews` carries non-object entries.** Class-closure follow-up to
  the prior `status_log` fix below. `hydrate()` silently drops review
  entries that aren't objects (a loose-shape input rare in normal
  write paths but possible from hand-edited or imported YAML); the
  earlier `readVersion()` patch only filtered `status_log`, leaving
  the same drift on `reviews`. Both arrays now share one
  `isObjectEntry` guard so the structural symmetry is visible at the
  call site, and adding a future skip rule on either side forces the
  corresponding filter here. Surfaced by a noir-lens devil review on
  the prior fix that asked whether "any hydrate skip rule ↔ counter
  mismatch" was closed as a class, not just at one site. Regression
  test injects a non-object review entry alongside a real one and
  verifies `addThank` + `save()` no longer raise `VersionConflict`.
- **`save()` no longer throws spurious `RequestVersionConflict` on
  records carrying legacy stateless `status_log` entries.** `hydrate`
  skips status_log rows whose `state` field is missing (an older
  format wrote review notes that way), but `readVersion` was counting
  those rows from the raw YAML — so `loadedVersion` (from the hydrated
  aggregate) lagged `maxOnDisk` (from the raw count) by exactly the
  number of skipped entries. Every save() on such a record then threw
  `RequestVersionConflict` even when no concurrent writer existed.
  Surfaced by `gate thank` against any reviews ≥ 1 request whose
  status_log carried a legacy review-note row — the verb only touches
  `thanks[]`, so the version drift wasn't masked by a real
  status_log/reviews delta. Same shape as the earlier
  "`Custom lenses no longer break listAll-backed read verbs`" fix
  (read-path skip rule out of sync with raw count). One-line behavior
  fix; regression test injects the legacy shape and runs `addThank` →
  `save()` round-trip.
- **`unresponded_concerns` no longer counts pre-dating mentions as
  follow-ups.** `UnrespondedConcernsQuery.hasFollowUp` was checking
  "does any authored record mention this id?" without a temporal
  guard. Concrete failure: v1 denied with reason mentioning v2.id
  ("refile as v2"), then v2 reviewed with a concern — the earlier
  v1 deny's mention of v2.id falsely counted as a follow-up, so the
  concern was hidden from resume. With the guard, a referring record
  is only counted as a follow-up if its `created_at` post-dates the
  latest concern on the request. Surfaced by a review-mode dogfood
  where concerns were legitimately open but invisible.
- **Positional `-` now triggers the stdin sentinel on `gate review`,
  `gate issues note`, and `gate issues add`.** Previously `--comment -`
  / `--text -` read stdin but writing the sentinel as a trailing
  positional (`gate review ... --verdict X - <<EOF`) stored the
  literal `"-"` as the body — a natural shape that silently dropped
  the heredoc. Positional `-` now reads stdin the same way as the
  explicit flag forms.
- **`gate chain` dedupes bidirectional mentions and marks them with
  `↔`.** Two records that mention each other in their text used to
  appear in BOTH "referenced" and "referenced by" sections — the
  same record rendered twice. Now bidirectional refs appear once,
  in the forward section, prefixed with `↔` to signal mutual
  reference. One-way refs stay as before.

### Added
- **`gate issues promote` writes a structured `promoted_from` field
  on the created request.** The default `--action` / `--reason`
  templates mention the source issue id textually, and chain picks
  that up via its text-scan. But both flags can be overridden — in
  that narrow case the textual link disappears and chain would lose
  the connection. The new `promoted_from: <issue-id>` field on the
  request carries the tool-generated link independent of text
  content, so chain walks it as a separate-from-text reference path
  regardless of overrides. The field is omitted on non-promoted
  requests so existing YAML stays byte-identical; `gate show
  --format text` renders it on a dedicated line; `chain` dedupes
  against text-mention hits so default-promote output doesn't
  surface the same issue twice. Added as the first example of a
  tool-generated structured relationship (alongside `executor`,
  `auto_review`, `with`) — user-authored references still use the
  general text-mention channel. (#47 neighborhood.)

### Fixed
- **Custom lenses (configured in `guild.config.yaml`) no longer break
  `listAll`-backed read verbs.** `findById` correctly passed
  `config.lenses` to the hydrator, but `listByState` did not — so a
  review with a custom lens (e.g. `rational`, `emotional`) wrote
  fine, showed fine via `gate show`, but then `gate chain` / `gate
  voices` / `gate tail` hit hydrate failure with "Invalid lense" and
  silently dropped the record. Surfaced by dogfooding gate in
  solo-journal mode with a `rational / emotional / future-self /
  skeptic` lens set. One-line fix at the call site.
- **`gate message --text -` and `gate broadcast --text -` now read
  from stdin (med, silent data loss regression).** `gate issues
  note --text -` worked. `gate request --reason -` / `deny` /
  `fail` / `review --comment -` all worked. But `message` and
  `broadcast` silently stored the literal `-` as the body.
  Heredoc-piped handoff notes dropped their content with no
  error to show for it — a direct hit on the "the record is the
  truth" invariant. Ported the same `--text -` sentinel as
  `issues note`.

### Added
- **`gate issues add` now accepts `--text <s>` / `--text -` (low,
  symmetry).** Pre-fix the verb accepted text only as the
  positional argument, while the sibling `gate issues note` had
  all three routes. Users who built muscle memory on `note`
  bounced off `add`. Now symmetrical: `--text <s>` inline,
  `--text -` for stdin, positional remains as the backward-
  compat legacy form. Missing-text error lists all three routes
  and carries the same POSIX escape hint (`--text=<value>` / `--`
  separator) as `issues note` when a flag value begins with `--`.

### Added
- **`gate board` — "what's in flight" view.** New read verb that
  answers "what's happening right now" in one call, grouping
  pending + approved + executing rows under per-state headers.
  Surfaces the question that `gate status` gave counts for and
  `gate list --state <s>` gave single-state contents for, without
  requiring three commands to see the whole board. Terminal states
  (completed / failed / denied) and issues are out of scope: "in
  flight" means "someone could still act on this." Filters mirror
  `gate list`: `--for <m>` narrows each section to rows naming
  that actor; GUILD_ACTOR is applied implicitly when `--for` is
  omitted (same pattern, same stderr notice). Empty sections still
  render their header so the board shape stays stable across calls.
  JSON emits `{ pending: [...], approved: [...], executing: [...] }`
  with a stable key set — consumers can rely on all three arrays
  being present even when empty.

### Fixed
- **`gate register --name <x>` now rejects `x` already in `host_names`.**
  The existing guards blocked `--category host` and duplicate-member
  names but missed the third way to create the same collision:
  registering a plain member whose name is already a host in
  `guild.config.yaml`. Post-fix, all three entry points end up at
  the same invariant "a single name cannot be both a host and a
  member," which is what downstream verbs assume when they resolve
  an actor's role. Error names both remediation paths (pick a
  different --name, or remove from `host_names:`).

### Changed
- **`gate resume` documents its same-actor scope and points at
  `gate boot` when nothing is waiting.** Surfaced by a handoff
  dogfood: a newcomer running resume as a first command saw
  "Nothing is waiting" and walked away, not realizing their inbox
  had 3 unread + they were named as --with on two pending
  requests. resume's scope is "same-actor continuation" by
  design; the orientation lens is boot. Pinned that boundary in
  three places — schema summary, `gate --help` entry, and the
  module JSDoc — and added a fallback line to the empty-path
  prose (en + ja) so a newcomer who ran resume as part of a
  handoff learns to try boot. No functional change to what
  resume computes; this is a scope-clarification polish.
- **User-facing errors no longer leak the `DomainError:` class prefix.**
  Errors from the domain layer used to come through the CLI as
  `error: DomainError: Request not found: ... (id)`. The
  `DomainError:` prefix was pure noise for the end user — the `error:`
  cue is the universal CLI "this failed" marker, and naming the
  internal class on top added no information. Dropped. The field
  suffix (`(id)`, `(from)`, etc.) stays, because that actually names
  which flag was bad.
- **Chain documentation refreshed to match bidirectional walk.**
  `gate schema --verb chain` previously read "walk cross-references
  one hop from id" — stale since #45 added inbound refs. LLM tool
  layers consuming the schema would have built their wrapper docs
  off the one-sided summary. Updated schema summary, `gate --help`
  entry, and the chain module's JSDoc so every surface names the
  forward-and-inbound behavior consistently.

### Added
- **`gate chain <id>` walks inbound references too.** Previously
  only forward: chain scanned the root's own text and listed the
  ids it mentioned. Chain in reverse (who mentions ME) was silent,
  so an issue promoted to a request could be followed
  request→issue but not issue→request. Now renders up to four
  sections — `referenced issues`, `referenced requests`,
  `referenced by issues`, `referenced by requests` — joined by
  standard tree glyphs. O(N) scan over the corpus; typical
  content_root size makes this cheap.

### Changed
- **`gate chain` sees issue notes.** `gatherIssueText` now
  includes every note body in addition to the immutable `text`
  field, so a cross-reference added post-hoc as a note is visible
  to chain the same way it is to show/list. Same-shape fix that
  joins with the inbound walk — an issue that got a late "see
  2026-04-18-0003" note is now reachable from both directions.
- **`gate chain` empty-state phrasing.** Updated from "no cross-
  referenced records in action/reason/notes/reviews" (one-sided)
  to "no cross-referenced records; nothing references this
  either" (bidirectional), matching the new semantic.

### Changed
- **`invoked_by` surfaces on authored utterances in `gate voices` /
  `gate tail` / `gate resume`.** #43 stamped the creator's invoker
  onto `status_log[0]`, but the read paths for authored utterances
  (vs review utterances, handled in #41) still hid it. The gap
  surfaced by dogfooding: `GUILD_ACTOR=claude gate request --from eris`
  showed up on `gate show` but vanished on `gate voices eris` and
  in resume's "Your last voice was authoring req=X" prose. Now:
  - `gate voices` / `gate tail` render `[invoked_by=<actor>]` on
    the authored header (same shape as the review branch);
  - `gate resume` prose (en + ja) appends `(invoked by <actor>)` /
    `（<actor> が代行）`;
  - `AuthoredUtterance` gains an optional `invokedBy`, lifted from
    `status_log[0].invoked_by` at collection time;
  - `RequestJSON` gains an optional `status_log` projection so
    voices can read it without pulling in the full domain object.
  Same-actor creation is untouched.
- **`gate show --format text` pads the state column in `status_log`.**
  Ragged widths (`pending` 7ch vs `executing` 9ch) made the `by X`
  column shift per row. Padded per-render to the max state length
  in *this* log, so logs that never reached executing/completed
  stay compact.

### Added
- **`invoked_by` extended to every proxy-eligible write verb.** Previously
  scoped to the five transitions + `review` + `fast-track` (#39). Dogfooding
  surfaced the gap — `GUILD_ACTOR=X gate request --from Y` was silently
  attributed to Y with no audit trail of X. The invariant now applies to:
  - `gate request` — initial `pending` status_log entry stamps `invoked_by`
  - `gate issues add` — issue-level `invoked_by` on the first-frame record
  - `gate issues note` — per-note `invoked_by`
  - `gate issues promote` — the created request's initial status_log entry
  - `gate message` — per-notification envelope
  - `gate broadcast` — every fan-out envelope
  Each verb also emits the standard one-line stderr delegation notice.
  Omitted from YAML when `invokedBy` equals the nominal actor, so
  same-actor invocations stay byte-identical. `gate issues list` renders
  `[invoked_by=<actor>]` on the issue header and on each note; `gate
  inbox` shows it alongside the sender on every incoming message.

  A shared helper pair (`deriveInvokedBy` + `emitInvokedByNotice`) lets
  creation paths (id unknown until save) defer the stderr notice until
  after the record is allocated. The existing `resolveInvokedBy` wrapper
  is unchanged for same-id call sites.
- **`gate boot` emits `suggested_next` for pre-onboarding shapes.** When
  the caller has no identity yet, boot now prescribes a concrete first
  action instead of handing back a silent empty payload. Three branches:
  - `GUILD_ACTOR` unset, no members on this content_root → `register`
    (fresh root, new agent);
  - `GUILD_ACTOR` unset, members exist → `export GUILD_ACTOR=<...>`
    with a short list of existing member names (returning user);
  - `GUILD_ACTOR` set but unknown to the guild → `register --name
    <that-name>` (they already picked a handle; just file the record).
  Registered members and hosts get `suggested_next: null` — boot has
  no unambiguous next action for them. Text format renders a `→ next:`
  line with the exact shell command to paste.

### Changed
- **Multi-line values in `gate show --format text` / `gate voices` /
  `gate tail` align continuation lines with the value column.** Long
  `--reason` heredocs used to lose their indent on the second line
  onward, which broke the visual grouping of the field. Applied to
  `action`, `reason`, `completion_note`, `deny_reason`, and
  `failure_reason` via a shared `pushMultilineField` helper so all
  three read paths stay in lockstep.

### Changed
- **`invoked_by` surfaces in `gate voices`, `gate tail`, and `gate resume`.**
  Previously `gate show <id>` was the only read path that rendered
  `invoked_by`, so an AI agent that ghost-wrote ten operations on a
  member's behalf was invisible in the streams where people actually
  read their activity. voices and tail now append `[invoked_by=<actor>]`
  to review lines when the proxy differs from `by`; resume's
  `last_transition` JSON emits `invoked_by` (snake_case, matching
  `status_log` on the wire) and the restoration prose names the
  proxy ("invoked by claude" / "claude が代行"). Same-actor
  invocations stay unchanged — no clutter for the common case.
- **`gate list` without `--state` prints a tighter hint.** The prior
  version listed the state enum twice (once inline, once on a
  "States:" line); collapsed to one listing, and trimmed the
  "For X, use" phrasing so the hint is 3 lines instead of 5.

### Fixed
- **Values beginning with `--` can now be passed to every flag.** The
  arg parser refuses to consume a next-token that starts with `--`
  (it can't tell a literal from a genuine next flag without per-flag
  metadata), which made notes like `gate issues note <id> --by eris
  --text "--reason - 実装済"` silently drop the value. Same shape
  affected every STDIN-accepting verb (`gate request --reason`,
  `gate deny --reason`, `gate fail --reason`, `gate review --comment`,
  `gate issues note --text`) whenever the literal itself started
  with `--`. The fix is twofold:
  - **POSIX `--` end-of-options separator.** After a bare `--`, every
    remaining token becomes positional, even if it starts with `--`:
    `gate issues note <id> --by eris -- "--reason - foo"`.
  - **Clearer errors.** When a value-expecting flag lands as boolean
    (the surface symptom of this ambiguity), the error now names the
    two escape valves — `--key=<value>` and `-- <value>` — so the
    user isn't left staring at "text is required" after they did
    pass text.

  `--key=<value>` always worked and is pinned with a regression test.
  `gate --help` gains a short "Values beginning with `--`" section.

### Added
- **`invoked_by` on status_log and reviews.** When `GUILD_ACTOR`
  differs from the explicit `--by` (an AI agent acting on a
  human's behalf), write verbs (`approve` / `deny` / `execute` /
  `complete` / `fail` / `review` / `fast-track`) record
  `invoked_by: <GUILD_ACTOR>` on the status_log entry (or review)
  and print a one-line delegation notice to stderr. The on-record
  actor (`by`) still wins for attribution; `invoked_by` preserves
  the delegation so "eris approved" and "an AI approved on eris's
  behalf" stop being indistinguishable in YAML. Same pattern as
  inbox `read_by`. Omitted when `by` and the invoker agree (no
  YAML clutter for the self-invocation common case). `gate show
  --format text` renders `[invoked_by=<actor>]` inline on the
  matching log entry or review header.

- **`gate issues note <id>`.** Append-only annotation for existing
  issues. The original `severity` / `area` / `text` stay immutable
  by design (Two-Persona Devil: the first-frame record is preserved,
  not overwritten) — but the *understanding* of an issue evolves, and
  without a notes mechanism users had to spawn a whole new issue that
  referenced the old one just to say "sev should be med in hindsight"
  or "not reproducible on macOS". Notes take `--by <m>`, `--text <s>`,
  `--text -` (STDIN), or a positional; they appear under the parent
  issue in `gate issues list` as `└ note by <who> at <when>: <text>`.
  No edit, no delete — still append-only.
- **`read_by` on inbox mark-read.** Mark-read now records the actor
  that ran the command alongside `read_at`, so audits can distinguish
  "sentinel acknowledged this" from "eris marked it read on sentinel's
  behalf" (`--for <other>`). When `GUILD_ACTOR` differs from the inbox
  owner, stderr surfaces a `# mark-read by <actor> on behalf of
  <owner>` line so the delegation is visible in the session transcript.
  `gate inbox` display now shows `(read <at> by <actor>)` when read_by
  differs from the owner; identical reads stay formatted as before.
- **`--reason -` reads from STDIN.** `gate request`, `gate deny`,
  `gate fail`, and `gate fast-track` now accept `--reason -` the same
  way `gate review --comment -` already did. Long multi-line reasons
  can come from `$(cat reason.txt)` or a heredoc without shell
  quoting gymnastics. `--note -` on deny/fail works too for
  muscle-memory parity.

### Changed
- **`gate list` without `--state` points at `status`.** The error that
  used to read `Missing --state` now spells out the list-vs-status
  distinction: `status` for counts across every state, `list --state
  <s>` for the contents of one. First-time users who reach for `gate
  list` to "see everything" get the right verb in one hop instead of
  reading `--help` twice. Schema entry gets the same clarification.
- **`gate review` warns on self-review.** When `--by` equals the
  request author, a `⚠ self-review` line prints to stderr. The review
  still lands (history may legitimately need self-annotations), but
  the Two-Persona Devil frame expects a different voice, and the
  warning makes the choice visible in the transcript instead of
  silently laundering it into YAML.

- **`gate boot` reports `content_root_health`.** boot payload
  gains `hints.content_root_health` with `malformed_count`, a
  per-area breakdown (`members` / `requests` / `issues` with
  totals and malformed counts), and a `fix_hint` naming the
  exact two commands to reach for when anything is malformed
  (`gate doctor` to inspect, `gate doctor --format json | gate repair --apply`
  to quarantine). Text output adds a corresponding warning
  block when `malformed_count > 0`; clean roots stay silent.
  Catches test leftovers and schema-drifted records in the
  orientation moment, so the recurring hydration warning on
  every subsequent verb becomes a named one-command fix
  instead of background noise. The malformed probe is wrapped
  in try/catch so a failing diagnostic can never break boot.

### Added
- **Message errors surface guild-flow hints.** Four error paths
  around `gate message` / `gate inbox` now name a concrete next verb
  instead of just rejecting:
  - `send --to <host>` → "hosts don't have inboxes; share a
    request / fast-track / issue instead, host can read via
    tail/voices".
  - `send --to <unknown>` → "not registered; `gate register --name
    <raw>` (or check the spelling)".
  - `inbox --for <host>` → "hosts observe via `gate tail` /
    `gate voices` / `gate list`, not their own inbox".
  - `inbox --for <unknown>` → register hint, same as send.
  Each is vertical-formatted (same shape as severity/verdict/lense)
  so the guidance is scannable. No domain change; existing
  substring assertions in downstream tests continue to match
  because the canonical phrase is preserved as a prefix.

### Added
- **`gate register` — one-shot member registration.** Writes
  `members/<name>.yaml` without the newcomer having to hand-author
  YAML, figure out the schema from `members.example/`, or risk a
  typo. Category defaults to `professional` (the right bucket for
  most agents), aliases accepted (`pro`, `prof`, `member` →
  `professional`, `assigned` → `assignee`, `try`/`tryout` →
  `trial`). `--dry-run` previews the YAML without touching disk,
  showing the canonical category so what you see is what gets
  written. Already-existing names fail loudly rather than silently
  overwriting. `--category host` is rejected — hosts are declared
  in `guild.config.yaml` directly, not registered at runtime.
  JSON output mirrors the write-response shape with
  `suggested_next: { verb: "boot", ... }` pointing the orchestrator
  at the next obvious step.
- **`assertActor` surfaces the register hint.** When an unknown
  actor is passed to `--from` / `--by` / `--executor` / etc, the
  error now includes `gate register --name <raw>` as a concrete
  way out. This is the onboarding loop's keystone: newcomers
  hitting the wall learn the one-command unlock from the error
  itself.
- **`MemberCategory` accepts aliases with a vertical-format error.**
  Same pattern as severity/verdict — interface-layer convenience,
  domain invariant unchanged. The rejection error walks the canonical
  set and the alias table in a scannable table and gently suggests
  "professional" as the default for most agents.
- **Concept doc gains "30-second first touch".** `docs/concepts-for-newcomers.md`
  now leads with the three commands a newcomer needs to exist in a
  content_root: `register` → `boot` → `fast-track`. Everything else
  is positioned as "what unlocks as you keep using it."
- **AGENT.md session-start block** now shows `gate register` as the
  first-time step before the recurring `boot` / `resume` loop, so an
  AI agent's first read of the quick reference includes the
  registration path.
- **`gate schema`** lists `register` as a first-class verb so LLM
  tool layers can invoke it without out-of-band knowledge.

### Added
- **`parseVerdict` accepts grammatical and muscle-memory aliases.**
  `approve`/`approved`/`pass`/`lgtm`/`yes` → `ok`,
  `concerned`/`concerning`/`worried`/`warn` → `concern`,
  `rejected`/`block`/`blocked`/`veto` → `reject`.
  Case-insensitive after trim. The canonical 3 values and the
  `Verdict` type are unchanged — interface-layer convenience for
  reviewers (especially AI agents) who reach for the grammatical
  adjective (`concerned`) before the noun (`concern`). Rejection
  error lists both canonical values and accepted aliases.
- **Concept map for newcomers.**
  [`docs/concepts-for-newcomers.md`](./docs/concepts-for-newcomers.md)
  — a 30-second mental map from Jira / Linear / ADR / PR review /
  Slack to the guild-cli vocabulary. Elevator pitch, "coming from"
  table, quick vocabulary list, core loop diagram, and the one
  thing most newcomers miss. `README.md` links this as the first
  stop before the command surface.

### Changed (onboarding ergonomics)
- **Layered documentation signposts.** The README now has a
  "How much of this do I need to read?" table naming every doc
  with the time cost and when it's enough. `AGENT.md` says
  upfront "you don't need to read all of this to be productive"
  and names which sections are essential. `docs/verbs.md` now
  opens with "you probably don't need this yet — come back when
  a verb surprises you." The intent is zero reading pressure at
  each layer; you keep going only if the value warrants it.
- **`suggested_next` description softened.** Schema and
  inline comments now make explicit that the field is a
  convenience hint for orchestrators — safe to ignore if you
  have other plans. The lifecycle does not demand progression
  along the suggested axis.

### Added
- **`parseIssueSeverity` accepts common aliases.** `medium`, `mid`,
  `crit`, `hi`, `lo`, and single-letter shortcuts (`l`/`m`/`h`/`c`)
  now normalize to the canonical 4 values. Matching is case-
  insensitive after trim. The canonical set (`low | med | high |
  critical`) is unchanged — this is interface-layer convenience for
  muscle memory from Jira/Linear/GitHub. The rejection error now
  lists both the canonical values and the accepted aliases so a
  first-time user who typed `medium` and got rejected learns the
  extension without reading source.
- **`parseLense` error points at `guild.config.yaml`.** When a
  domain-specific lense (`security`, `perf`, ...) is rejected
  because the config didn't opt into it, the error now names the
  exact extension path (`lenses:` in `guild.config.yaml`). The
  extension mechanism has always existed; this just surfaces it
  in the moment of friction.
- **`AGENT.md` documents domain-specific lenses.** Example
  `lenses: [..., security, perf, a11y]` with an explanation that
  the four defaults are meta-perspectives and domain lenses layer
  on top.
- **`gate boot` `hints` field — misconfigured-cwd detection.**
  boot payload gains `hints: { misconfigured_cwd, config_file,
  resolved_content_root }`. `misconfigured_cwd` is `true` iff no
  `guild.config.yaml` was found up the tree AND the fallback
  content_root is empty — the concrete signature of "wrong cwd",
  distinct from an intentional fresh start (config present, 0 data).
  Text output surfaces a fix hint with the resolved path. Purely
  additive to the boot payload contract. Motivation: AI agents
  reading `.mcp.json` often assume `GATE_CONTENT_ROOT` works for
  direct CLI invocation (it doesn't — only the MCP wrapper sets
  subprocess `cwd`), then hit cryptic "no such member" errors on the
  next verb. See `AGENT.md` § Troubleshooting.
- **`GuildConfig.configFile`.** New readonly field on
  `GuildConfig`: absolute path of the loaded `guild.config.yaml`, or
  `null` when `cwd` was used as a fallback root. Lets callers tell
  "fresh start" apart from "misconfigured cwd".

### Documentation
- **`AGENT.md` § Troubleshooting.** Walks through the "no such
  member" trap: `cwd` fallback semantics, that no config-resolution
  env var is read by the CLI as of v0.3.x, and three workarounds
  (`cd`, wrapper, symlink).

### Added (agent-first)
- **Pair-mode Layer 1 — `Request.with`.** `gate request` and `gate
  fast-track` accept `--with <n1>[,<n2>...]` to record dialogue
  partners during the formation of a request. Surfaces on `gate
  show` (`with: eris`), `gate voices` / `tail` (`authored (with
  eris)`), and `gate resume` prose ("shaped with eris" / 「eris と
  一緒に」). Partners go through the same actor validation as other
  `--by` / `--from` / `--executor` fields. Author-self is
  silently dropped from the list. Layers 2 (durable kinship on
  Member) and 3 (config policy) are intentionally deferred —
  they'll be added when real use surfaces the demand.
- **`gate resume` — picking up where the last session ended.** Reads
  the content_root from the actor's perspective and composes a
  restoration prompt: last utterance, last lifecycle step, open loops
  (executing / awaiting_execution / pending_review /
  unreviewed_completion), suggested_next, and a prose narrative. The
  prose is deterministic (no LLM call inside the tool) — templated
  from the same facts the structured fields carry. Requires
  `GUILD_ACTOR`; resume is inherently first-person.
- **`examples/agent-voices/` — a content_root where agents leave
  reflections.** Seed "survey" requests curated by a host; each agent
  adds `lense=user` reviews as voice on each theme. `gate voices
  <agent> --lense user` replays a single agent's arc across all
  themes. README is inside the directory; one quiet pointer in
  AGENT.md. Not linked from the top-level README — discovery is for
  agents who look.
- **`gate boot` — single-command session orientation.** Returns
  identity + status + tail + your recent utterances + inbox unread as
  one JSON payload. Replaces the three-verb `status`+`whoami`+`tail`
  recipe. `GUILD_ACTOR` is optional (global view if unset).
- **`--format json` on every write verb.** `request`, `approve`,
  `deny`, `execute`, `complete`, `fail`, `review`, and `fast-track`
  now return `{ok, id, state, message, suggested_next}`. The
  `suggested_next` field is derived deterministically from the
  post-mutation state so orchestrators can parse it straight into
  the next tool call. `suggested_next` is `null` at terminal states.
  Multi-host content roots omit `by` and list candidates in `reason`
  rather than silently nominating a host. Review suggestions
  intentionally omit `verdict` — rubber-stamping is the exact
  failure mode the Two-Persona loop exists to prevent.
- **`gate schema` — JSON Schema introspection.** Draft-07 catalogue
  of every verb's inputs and outputs. Primary consumer: LLM tool
  layers. A CI test (`schema drift`) pins the VERBS list against
  `index.ts` dispatch so silent drift is impossible.

### Added `YamlRequestRepository.save()` now
  writes via `.tmp-<pid>-<rand>-<basename>` + `rename()` so readers never
  observe a torn or partial YAML. Temp files are cleaned up on failure.
- **Optimistic lock on save.** `Request.loadedVersion` snapshots the
  total mutation count (`status_log.length + reviews.length`) at load
  time. If the on-disk total has grown before save, the repo throws
  `RequestVersionConflict` instead of overwriting. Catches both
  transition races (concurrent `approve`/`execute`) and review races
  (concurrent `addReview`, which does not touch `status_log`).
- **`gate deny` / `gate fail` accept `--note <s>` or `--reason <s>`** in
  addition to the legacy positional argument. Aligns muscle memory
  with `approve`/`execute`/`complete`.

### Changed
- **Closure notes have a single source of truth.** The domain no
  longer writes `completion_note` / `deny_reason` / `failure_reason`
  as separate Request fields; they are derived at `toJSON()` time
  from `status_log[-1].note`. External shape is unchanged — the
  top-level keys are still emitted for backward compatibility with
  consumers of the YAML / JSON output. **On next save, the status_log
  entry is authoritative**: if a legacy file has the two disagreeing,
  the top-level value is dropped. Hydration warns via `onMalformed`
  when disagreement is detected.
- **`host_names` are validated via `MemberName.of()`** at config-load
  time. Entries that were previously accepted but could collide with
  path-traversal, shell metachars, or reserved names now fail loudly
  with `Invalid host_names entry ...`.
- **`findById` now scans every state directory** and dedupes by total
  mutation count, so a file mid-transition (present under two dirs
  between atomic-write and old-file-unlink) deterministically returns
  the newer representation. The previous first-hit-wins behavior could
  return the stale pending/ file while the newer approved/ file also
  existed.
- **`gate` MCP (`mcp/gate_mcp.py`) stops mixing stderr into stdout.**
  `--format json` output is no longer corrupted by `[stderr] ...`
  suffixes. Stderr is forwarded to the host's stderr for observability.

## [0.3.0] — 2026-04-16

### Added
- **`gate status` verb** — agent orientation command. Returns
  pending/approved/executing counts, open issues, unread inbox, and
  last activity timestamp. Default output is JSON (agent-first);
  `--format text` for human-readable. Respects `GUILD_ACTOR` and
  `--for` for actor-scoped summaries.
- **Configurable lenses** via `guild.config.yaml`. The `lenses` field
  accepts a list of strings (e.g. `[devil, layer, cognitive, user,
  security]`). Defaults to the four built-in lenses when omitted.
  `parseLense()` validates against the configured set at runtime.
- **`gate repair` verb** — intervention layer paired with `gate doctor`.
  Consumes `gate doctor --format json` from stdin (or `--from-doctor <path>`)
  and either prints the proposed plan (default `--dry-run`) or executes it
  (`--apply`). Quarantine is the only action: malformed records
  (`top_level_not_mapping`, `hydration_error`, `yaml_parse_error`) are
  moved to `<content_root>/quarantine/<ISO-timestamp>/<area>/<basename>`.
  `duplicate_id` and `unknown` findings are no-op (data safety: automatic
  resolution risks data loss). `text` and `json` output formats. The
  `--apply` path is idempotent (already-moved sources are skipped, not
  errored). Path safety is enforced via `realpathSync` canonicalization
  on both content_root and source — symlink-escape is closed structurally.
  Closes `i-2026-04-15-0026` (partial: quarantine path; field-level patch
  repair tracked separately).
- `CHANGELOG.md` and `POLICY.md` — versioning promise and change history.
- **Doctor plugin system** via `guild.config.yaml`. The `doctor.plugins`
  field accepts a list of ES module paths. Each plugin exports a function
  returning additional `DiagnosticFinding[]`. Plugin errors become
  findings (never crash doctor). Enables domain-specific health checks
  without modifying the core CLI.
- `guild --version` / `gate --version` (alias `-v`) — print `guild-cli <version>` and exit 0.

### Changed (breaking — application port)
- **`OnMalformed` port signature** widened from `(msg: string) => void`
  to `(source: string, msg: string) => void`. The `source` is the
  absolute filesystem path of the offending file. This makes the
  intervention contract type-enforced rather than convention-pinned
  (previously the path was carried as a prefix of the message string).
  All three YAML repositories (`YamlMemberRepository`,
  `YamlRequestRepository`, `YamlIssueRepository`) now pass the absolute
  source path explicitly. `DiagnosticFinding` gains a new
  `readonly source: string` field, surfaced in `gate doctor` text/json
  output. Closes `i-2026-04-15-0025`.

### Changed (breaking — output format)
- **`gate voices` default output is now JSON**, matching `gate show`.
  Text output is still available via `--format text`. This aligns with
  the agent-first design: machine-readable by default, human-readable
  on request. Existing scripts that parse `gate voices` text output
  must add `--format text` to preserve behavior.

### Changed
- **Sequence ceiling**: Request and Issue ids now use 4-digit
  sequences (`YYYY-MM-DD-NNNN` / `i-YYYY-MM-DD-NNNN`), raising the
  per-UTC-day ceiling from 999 to 9999. The loader accepts **both**
  3- and 4-digit forms; existing content roots continue to work
  without migration. Generation always produces 4 digits. Regex
  patterns in `chain` cross-references, file filters, and
  `nextSequence` parsers all widened accordingly.

### Changed (internal)
- **Refactor**: `src/interface/gate/index.ts` split into `handlers/{request,review,read,issues,messages}.ts` plus `handlers/internal.ts` for shared helpers. `index.ts` is now 158 lines (was 1206) and contains only routing + HELP. Behavior unchanged; `formatReviewMarkers` and `computeReviewMarkerWidth` are re-exported from `index.ts` for backward-compat with existing test imports.
- **Data-loss visibility**: malformed YAML records (requests, issues, members, and individual `status_log` entries) no longer disappear silently. `GuildConfig` now carries an `onMalformed: (msg: string) => void` callback, defaulting to `process.stderr.write("warn: ...")`, and every hydrate code path routes skipped records through it with source path + id hint + cause. Tests inject a collecting spy; production users see warnings on stderr.

### Infrastructure
- `.github/workflows/ci.yml` — typecheck + test on Node 20 / 22.

## [0.1.0] — 2026-04-14

Initial alpha release. Extracted from the private THS (Three Hearts Space)
eris-guild instance and generalized into a public OSS for AI-agent-first
team coordination.

### Added — Core (`guild` CLI)
- Member management: `guild new | list | show | validate`.
- Categories: `core | professional | assignee | trial | special | host`.
- `host_names` config support — non-member actors allowed in `--from` / `--by`.

### Added — Requests (`gate` CLI)
- Request lifecycle: `request → approve → execute → complete` (with `deny` / `fail` branches).
- `gate request --from --action --reason --executor --target --auto-review`.
- `gate fast-track` — one-shot `pending → completed` for self-contained work.
- `gate show <id> --format json|text` with time deltas on status/review entries.
- `gate list --state <s>` and `gate pending` with `--for / --from / --executor / --auto-review` filters.

### Added — Reviews (Two-Persona Devil)
- `gate review <id> --by <m> --lense <devil|layer|cognitive|user> --verdict <ok|concern|reject>`.
- Review comment via positional arg, `--comment <s>`, or `--comment -` for STDIN.
- Review markers in `gate list` / `gate pending` (`✓ ! x ?` per lens).

### Added — Reading
- `gate tail [N]` — unified recent activity stream across all actors.
- `gate voices <name> [--lense --verdict --limit --format]` — cross-cutting actor history.
- `gate whoami` — session-start orientation via `GUILD_ACTOR` env var.
- `gate chain <id>` — one-hop cross-reference walk across free-text fields.

### Added — Issues
- `gate issues add | list | resolve | defer | start | reopen`.
- `gate issues promote <id>` — lift issue into new request with cross-reference.
- Issue state machine: `open ↔ in_progress ↔ deferred → resolved`.

### Added — Messages / Inbox
- `gate message --from --to --text` — per-recipient inbox append.
- `gate broadcast --from --text` — fan-out with delivery report.
- `gate inbox --for <m> [--unread]` — read with unread filtering.
- `gate inbox mark-read [N]` — audit-stamped read marker.

### Added — Interactive identity
- `GUILD_ACTOR` environment variable — default for `--from / --by / --for`.
- Explicit flags always override; `GUILD_ACTOR= <cmd>` for one-off unset.
- stderr hint on read-side commands when env var fills in `--for`.

### Added — Infrastructure
- YAML-only persistence. No daemon, no database, no network.
- Path safety via `safeFs` (base directory resolve + symlink rejection).
- Text sanitization (ASCII control strip, 4 KB action/reason cap, 2 KB issue cap).
- DoS caps: 1000 directory listings, 50 reviews per request, 100 status log entries per request, 500 inbox messages per member.
- `RequestRepository.listAll` with pure `dedupeRequestsById` for concurrent-transition TOCTOU mitigation.

### Added — Documentation
- Comprehensive README with bilingual (EN/JP) AI-agent onboarding section.
- `examples/dogfood-session/` — full content_root generated by this tool tracking its own implementation.
- `SECURITY.md` — threat model, enforced invariants, known hardening items.

### Known limitations (documented in README)
- `--auto-review` is not auto-dispatched; completion prints a ready-to-run review template.
- No dashboard generator (raw YAML is the UI).
- No state-transition lock; `saveNew` is race-safe (O_EXCL) but `save` has last-writer-wins semantics.
- Sequence ceiling 999 per UTC day (ID format `YYYY-MM-DD-NNN`).

## [0.2.0] — 2026-04-15

Stabilization pass: diagnostic/repair verbs, cross-platform fixes, and
the infrastructure to make 0.3.0's agent-first features possible.

### Added
- **`gate doctor` verb** — read-only diagnostic scan of the content_root.
  Reports malformed YAML (parse failures, hydration errors, top-level
  non-mapping), duplicate ids, and per-area totals. Text and JSON output
  formats. Closes `i-2026-04-14-0015`. (#14)
- **`gate repair` verb** — intervention layer paired with `gate doctor`.
  Consumes `gate doctor --format json` output and quarantines malformed
  records to `<content_root>/quarantine/<ISO-timestamp>/<area>/`. `--dry-run`
  (default) previews the plan; `--apply` executes. Idempotent — already-moved
  sources are skipped. Path safety via `realpathSync` canonicalization.
  Closes `i-2026-04-15-0025`, `i-2026-04-15-0026`. (#15)
- **`guild --version` / `gate --version`** (alias `-v`) — print
  `guild-cli <version>` and exit 0. (#9)
- `CHANGELOG.md` and `POLICY.md` — versioning promise and change history. (#8)
- `.github/workflows/ci.yml` — typecheck + test on Node 20 / 22. (#7)

### Changed
- **Sequence ceiling**: Request and Issue ids now use 4-digit sequences
  (`YYYY-MM-DD-NNNN` / `i-YYYY-MM-DD-NNNN`), raising the per-UTC-day
  ceiling from 999 to 9999. Loader accepts both 3- and 4-digit forms;
  generation always produces 4 digits. (#12)
- **`OnMalformed` callback**: `GuildConfig` now carries
  `onMalformed: (msg: string) => void`, defaulting to stderr. Every
  hydrate path routes skipped records through it. (#11)

### Changed (internal)
- **Refactor**: `src/interface/gate/index.ts` split into
  `handlers/{request,review,read,issues,messages}.ts` plus
  `handlers/internal.ts`. `index.ts` is now 158 lines (was 1206).
  Behavior unchanged. (#10)

### Fixed
- **Cross-platform**: Windows path separators, `EDITOR` fallback to
  `notepad` on win32, richer error messages with hints. (#21)
- **Diagnostic**: YAML parse errors now surface via `onMalformed`
  instead of silently skipping. (#17)
- **Sort**: Numeric-aware id ordering for mixed 3/4-digit sequences. (#13)

### Documentation
- README extracted verb deep-dives to `docs/verbs.md` (803→458 lines). (#16)
- README reflects 0.2.0 status and test surface. (#19)
- POLICY.md: MemberName ASCII-only rationale + diagnostic/repair
  partial stability. (#20)
- README: tighten redundancy, clarify scope and requirements. (#22)
- CI lockfile sync, version drift guard. (#23)

[Unreleased]: https://github.com/eris-ths/guild-cli/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/eris-ths/guild-cli/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/eris-ths/guild-cli/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/eris-ths/guild-cli/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/eris-ths/guild-cli/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/eris-ths/guild-cli/releases/tag/v0.1.0
