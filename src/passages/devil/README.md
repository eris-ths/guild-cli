# devil-review — third passage (alpha, v1)

Third passage under `guild`, after `gate` and `agora`. Where
gate is the **判断** (judgment-shaped) surface and agora is the
**探索** (exploration-shaped) surface, devil-review is the
**守備** (defense-shaped) surface — multi-persona, lense-enforced,
time-extended review designed to **raise the security knowledge
floor** for code reviewed by authors who haven't met OWASP top 10.

The shape: `devil` holds work that **could harm a third party
if it lands without scrutiny**. Reviewers commit to a `persona`
(red-team adversarial, author-defender articulate, mirror
contradiction-watching), touch a per-content_root `lense` catalog
(12 axes covering injection / auth / supply-chain / coherence /
etc), and conclude with synthesis prose rather than a verdict.
The friction (lense-coverage gate, severity-rationale required,
mandatory SCG delegate for supply-chain) is the feature — it's
how the substrate raises the floor.

If your work is decision-shaped, use `gate`. If it's
exploration-shaped (open-ended thinking), use `agora`. If it's
defense-shaped, devil.

## Lore upstream

- [`lore/principles/11-ai-first-human-as-projection.md`](../../../lore/principles/11-ai-first-human-as-projection.md)
  — the substrate is AI-natural; humans get a projection layer.
- [`lore/principles/10-schema-as-contract.md`](../../../lore/principles/10-schema-as-contract.md)
  — the schema agents read is the dispatch contract; `devil schema`
  advertises every implemented verb.
- [`lore/principles/04-records-outlive-writers.md`](../../../lore/principles/04-records-outlive-writers.md)
  — the substrate persists across sessions; devil reuses gate's
  YAML file substrate.
- [`lore/principles/09-orientation-disclosure.md`](../../../lore/principles/09-orientation-disclosure.md)
  — every devil write verb emits the same `notice:` line shape as
  `gate register`.

## Design issue

[Issue #126](https://github.com/eris-ths/guild-cli/issues/126)
captures the design conversation: the three-source landscape
(`/ultrareview` vs Claude Security vs supply-chain-guard), the
seven shapes single-pass review structurally misses, the five
A–E decisions (naming / lense catalog / SCG mandatory delegate /
severity_rationale required / gate entry kind), and the
non-developer-as-app-author / end-user-harm motivation behind
the "knowledge floor" framing.

The bird's-eye `coherence` lense was added in v1 (post-merge fix)
to close a methodology gap surfaced in dogfood: lense-by-lense
audit cannot detect cross-lense coherence drift, so coherence
joined the catalog as a 12th lense.

## Layout

```
src/passages/devil/
  domain/
    Lense.ts / defaultLenses.ts        # 12 v1 lenses
    Persona.ts / defaultPersonas.ts    # 3 hand-rolled + 3 ingest-only
    Entry.ts                           # 6 kinds with per-kind validation
    DevilReview.ts                     # aggregate (state: open → concluded)
  application/
    DevilReviewRepository.ts           # port (CAS on every append)
    LenseCatalog.ts / PersonaCatalog.ts # ports
  infrastructure/
    YamlDevilReviewRepository.ts       # adapter (atomic write, CAS)
    BundledLenseCatalog.ts             # 12 v1 defaults
    BundledPersonaCatalog.ts           # 6 v1 defaults (3 + 3)
  interface/
    index.ts                           # CLI dispatcher
    handlers/                          # one handler per verb
  README.md                            # this file

bin/devil.mjs                          # passage binary
tests/passages/devil/                  # contract tests (~140 tests)
```

## Substrate sharing with gate / agora

devil reuses the container's substrate without modification —
`safeFs`, `parseYamlSafe`, `GuildConfig`, `MemberName`, `parseArgs`.

devil-specific records live under `<content_root>/devil/`:

```
<content_root>/
  members/                            # shared with gate / agora
  guild.config.yaml                   # shared
  devil/
    reviews/<rev-id>.yaml             # one file per review session
                                      # rev-id format: rev-YYYY-MM-DD-NNN
                                      # (sequence per content_root per day)
```

## Verbs (v1, complete — 11 verbs)

- `devil open <ref>` — start a review session against a target
  (`--type pr|file|function|commit`)
- `devil entry <rev-id>` — append a hand-rolled entry. `kind=finding`
  requires `--severity` AND `--severity-rationale` (the friction
  forces exploitability-context reasoning). Persona must be
  hand-rolled (red-team / author-defender / mirror); ingest-only
  personas refuse via `PersonaIsIngestOnly`.
- `devil ingest --from <source> <input>` — append entries from
  an automated source (ultrareview / claude-security / scg).
  Strict v0 input JSON shape per source. SCG ingest **runtime-
  checks** for `scg` on PATH (mandatory delegate per #126 C).
- `devil dismiss <rev-id> <entry-id>` — mark a finding-entry
  dismissed with one of 5 structured reasons.
- `devil resolve <rev-id> <entry-id>` — mark a finding-entry
  resolved, optionally citing the commit that landed the fix.
- `devil suspend <rev-id>` — record a cliff/invitation pause on
  a thread. **Softer than agora's suspend** — does NOT block other
  entries; just records re-entry context.
- `devil resume <rev-id>` — pick up the most recent un-paired
  suspension; surfaces the closing cliff/invitation in success
  output.
- `devil list` — enumerate reviews (`--state` / `--target-type`
  filters).
- `devil show <rev-id>` — full detail (entries / suspensions /
  resumes / conclusion).
- `devil conclude <rev-id>` — terminal state transition.
  **Verdict-less**: `--synthesis` prose required, no
  ok|concern|reject. **Lense-coverage gate**: every lense in
  the catalog needs at least one entry (a `kind=skip` entry
  with declared reason counts) before this accepts the close.
- `devil schema` — agent dispatch contract per principle 10.

## Lense catalog (v1, 12 lenses)

The first 8 mirror Claude Security's detection categories
(`injection` / `injection-parser` / `path-network` / `auth-access`
/ `memory-safety` / `crypto` / `deserialization` /
`protocol-encoding`) so ingested findings map 1:1.

Four devil-specific lenses extend the catalog:

- `composition` — multi-file/function effect; diff review tends
  to miss this.
- `temporal` — TOCTOU / race / retry / idempotency.
- `supply-chain` — **mandatory delegate to SCG**; runtime-checks
  for `scg` on PATH and refuses if absent (#126 decision C, e-001
  fix from devil-on-devil dogfood).
- `coherence` — bird's-eye / cross-lense / cross-target. Doc/code
  drift, naming inconsistency, contradictions between findings
  under different lenses, architectural-posture observations.
  Surfaced as a methodology gap and promoted to a first-class
  lense so the audit posture itself is auditable.

## Persona catalog (v1, 6 personas)

Three hand-rolled (a reviewer can pick by hand):

- `red-team` — adversarial framing strict
- `author-defender` — articulate the author's framing + assumptions
- `mirror` — read both, surface contradictions and shared blind spots

Three ingest-only (attributable only via `devil ingest`;
`PersonaIsIngestOnly` if `devil entry` tries):

- `ultrareview-fleet` — Anthropic `/ultrareview` fleet output
- `claude-security` — Anthropic Claude Security agentic scanner
- `scg-supply-chain-gate` — supply-chain-guard 8-stage gate

## State machine (v1, intentionally thinner than agora's)

```
open ──── conclude ────▶ concluded   (terminal)
```

No `suspended` state — suspend/resume cycles are append-only
history and do **not** block other entries. Multiple reviewers
can keep working while a thread is paused. (Contrast agora's
Play, where suspend genuinely blocks moves.)

## CAS semantics

Optimistic CAS via `DevilReviewVersionConflict` on every
appending operation; `saveConclusion` uses state-CAS
(`open` → `concluded`); `replaceEntry` (used by dismiss /
resolve) carries CAS on entries.length AND the targeted id.

The CAS is **sequential** not atomic — it catches the
load-then-act-then-write race that AI agents naturally produce
when re-entering between sessions, but does NOT prevent two
simultaneous writer processes from both passing the check
(last-write-wins under true OS-level concurrency). Trust
assumption named in the repository docstring: "one CLI process
at a time per content_root."

## Sister project

Devil-review's `supply-chain` lense delegates to
[eris-ths/supply-chain-guard](https://github.com/eris-ths/supply-chain-guard)
— SCG's 8-stage Devil Gate framework is a reference
implementation of the adversarial-gate-sequence shape devil's
own `kind: gate` entry was designed to ingest. The naming
(`devil` here, `Devil Gate framework` there) is sister-
relationship intentional, not coincidental.
