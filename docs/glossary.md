# Glossary

Authoritative reference for project-specific terms. Where a term has a deeper write-up, the entry links to it; this file stays short on each, long on coverage.

If you are reading the codebase for the first time, the [`Quick vocabulary`](./concepts-for-newcomers.md#quick-vocabulary) section in `concepts-for-newcomers.md` is the 5-minute primer; this file is the full reference.

## Structure

- **passage** — one of four shapes of work the substrate carries: `gate` (judgment), `agora` (exploration), `devil` (defense), `ctx` (fact). Each passage has its own CLI entrypoint (`bin/<passage>.mjs`) and writes under `<content_root>/<passage>/`. See [`playbook.md`](./playbook.md) § "Dispatch in one breath".
- **substrate** — the file-based coordination layer: YAML records on disk under `<content_root>/`. Distinct from *surface* (CLI verbs, JSON output) which renders / mutates the substrate.
- **surface** — externally-visible faces of the substrate: verbs, `gate schema`, `gate --help` text, prose docs. Per [principle 11](../lore/principles/11-ai-first-human-as-projection.md), `gate schema --format json` is the authoritative AI-agent contract; help text and prose docs are projections.
- **record** — one YAML file on disk (a request, an issue, an inbox entry, an agora play, a devil review, …). Append-only in spirit per [principle 04](../lore/principles/04-records-outlive-writers.md).
- **wave** — a `gate request` record. Carries one or more executors. Single-executor and multi-executor waves share the same shape (per #230).
- **slice** — a single executor's portion of a multi-executor wave. First-class on the substrate post-#294: `executors[]` carries per-slice `status` / `completed_at` / `note`. `gate complete --by <X>` closes one slice; the wave reaches `completed` when all slices close.
- **content_root** — the YAML directory `gate` reads from. Contains `members/`, `requests/`, `issues/`, `inbox/`, `agora/`, `devil/`, `ctx/`, and `guild.config.yaml`. Git it for history. See [`AGENT.md`](../AGENT.md) § "File layout".
- **profile** — `standard` (solo default) or `swarm` (multi-executor). Set in `guild.config.yaml`. Drives `self_approve: allowed / forbidden`, `worktree_required_for_parallel`, and the default tier of `gate --help`. See [`docs/swarm.md`](./swarm.md) and [`docs/POLICY.md`](./POLICY.md).

## Roles / actors

- **actor** — anything with a `members/<name>.yaml` file: human, AI agent, or composite (a `mirror` persona of an AI, a session_id-stamped body, …). Lowercase ASCII identifier (`MemberName`).
- **host** — a config-level actor declared under `host_names:` in `guild.config.yaml`. Not a member file; the privileges differ (e.g. can `--from` any member for delegation flows).
- **mirror** — a second registered `--by` name used by the same actor to play the reviewer role on their own work. Pins the Two-Persona Devil discipline ([principle 02](../lore/principles/02-advisory-not-directive.md) + [principle 08](../lore/principles/08-voice-as-doctrine.md)) inside a solo flow. See [`playbook.md`](./playbook.md) § "S1: Mirror Persona Loop".
- **director / orchestrator** — informal role: the actor who designs / monitors / closes waves rather than executing them. `gate decisions` and `gate self-pattern` are director-axis read verbs (#336).
- **session_id** — cross-session attribution stamp (`opened_by_session`, `claimed_by_session`, `witness_sessions[<actor>]`). Format: `^[a-z0-9][a-z0-9_:.-]{0,63}$`. Set via `GUILD_SESSION_ID` env or `gate boot --session-id`. See `docs/verbs.md` § "Sessions (#249)".

## Lore / thinking

- **lore** — `lore/principles/` (numbered axioms) + `lore/traps/` (operational patterns not yet principle-grade). The "thinking around the code" — not the code itself, not user docs.
- **principle** — numbered, named, load-bearing axiom. 14 ship as of 2026-05-12. Promotion bar: *felt-not-just-read*, two independent dogfood observations. See [`lore/README.md`](../lore/README.md).
- **trap** — a reusable operational pattern flagged for future review. Lives at `lore/traps/<trap_name>.md` with `relevant_until: <date> | indefinite` frontmatter. Quarantined (not deleted) when expired via `gate doctor sweep-traps`. See [`lore/traps/README.md`](../lore/traps/README.md).
- **felt-not-just-read** — the graduation bar from trap to principle: the pattern is named consistently from independent observations, not just read from someone else's notes.
- **advisory** — a record field that downstream consumers MAY read to alter behaviour, but enforcement is not built into the substrate. Pinned by [principle 02](../lore/principles/02-advisory-not-directive.md). Examples: `Request.depth` (consumed by `gate review-context` #310), issue `severity`, `auto_review`. The "stamped but unread" audit lives at [#344](https://github.com/eris-ths/guild-cli/issues/344).
- **applies_to** — optional YAML frontmatter on `lore/principles/*.md` declaring audience scope. Values: `all` (default), `swarm`, `passage:<gate|agora|devil|ctx>`. Filter via `tools/lore-scope.sh`. See [`lore/README.md`](../lore/README.md) § "`applies_to:` frontmatter convention".

## Review / judgment

- **lense** — the angle a reviewer is taking. **Spelled with a trailing `e` throughout this project** — the value object, the CLI flag, and prose all align. Default gate lenses: `devil | layer | cognitive | user`. Devil-side catalog (12, v1): `injection / injection-parser / path-network / auth-access / memory-safety / crypto / deserialization / protocol-encoding / supply-chain / composition / temporal / coherence`.
- **verdict** — review outcome: `ok` (landed cleanly), `concern` (lives with the decision but you want it named), `reject` (don't do this). The word is deliberately soft — `concern` is usable, not a veto.
- **claim** — exclusive stake on a wave: "I'm working on this." `gate claim <id> --by <m>` is refused if another actor holds the claim. Auto-released on terminal transition. See #226.
- **witness** — non-exclusive observation: "I'm watching this." Multiple actors can witness one wave. `gate witness <id> --by <m>` is idempotent (same-actor re-witness no-op unless note/session differs). See #244 / #246.
- **depth** — reviewer-depth advisory on a wave: `shallow | standard | deep`. Stamped at `gate request --depth <v>`. Consumed by `gate review-context` (#310) to recommend a lense set. See #221.
- **strict_lenses** — opt-in `guild.config.yaml` setting that flips `gate review`'s allowed-lense set from the team-chosen `lenses:` list to the bundled devil catalog. Default `false`. See `docs/verbs.md` § "Strict lense vocabulary".

## Cross-passage / time

- **cliff / invitation** — the two prose halves of an `agora suspend`: cliff = "what was happening when I stopped," invitation = "what the next opener should attempt." Carries the Zeigarnik substrate that lets a different instance pick up the play. See #117.
- **from-agora** — `gate request --from-agora <play-id>` lifts a suspended play's cliff/invitation into the new request: `action ← invitation`, `reason ← cliff`. The request's `source_agora_play` field stamps the play_id for back-links. See #232 and [`playbook.md`](./playbook.md) § "S3: Agora-to-Gate Lift".
- **source_agora_play** — record field on a `gate request` set by `--from-agora`, pointing back to the agora play the request was lifted from. Cannot be hand-overridden — the structural link is preserved even when `--action` / `--reason` override the lift.
- **axis** — multi-PR coordinated effort. Examples: the *Solo/Swarm coexistence* proposal (5 axes: boot text / help tier / docs split / lore frontmatter / trap retirement, #323-#327), the *#294 slice closure* (3 axes: design lock A1 / migration A2 / followup B). An axis is the unit of coordinated landing, not a record on disk.

## Doc organization

- **combo** — situational recipe in `docs/playbook.md` (C1-C6). When a specific situation arises (bug-killing flow, ordering N items, bundle PR), reach for the matching combo. See `docs/playbook.md` § "Combos (multi-passage workflows)".
- **synergy** — exploratory verb pairing in `docs/playbook.md` (S1-S4). Where combos are *recipes for situations*, synergies are *verb pairings that pin a substrate principle in one arc*. Each ships with a runnable E2E test under `tests/e2e/synergy_*.test.ts`.
- **tier** — `AGENT.md`'s reading hierarchy: **Common** (solo-usable) / **Coordination** (swarm) / **Boundary** (agora / devil / ctx) / **Diagnostic** (doctor / config / troubleshooting). Sections are ordered by topic, not tier; the [Tier index](../AGENT.md#tier-index) lets readers skip-jump.
- **audience** — design priority axis pinned by [principle 11](../lore/principles/11-ai-first-human-as-projection.md): **AI-agent first; humans as projection.** When a surface choice has to favour one over the other, the AI-agent-readable shape wins; the human-readable version is layered on top. Decides which surfaces grow first when capacity is finite.

## Extension surfaces

- **VerbPlugin** — add a new `gate <verb>` without forking the core dispatcher. Schema declared in the plugin module; loaded from paths in `guild.config.yaml`. See [`docs/plugin-schema.md`](./plugin-schema.md) and [`examples/plugins/verbs/`](../examples/plugins/).
- **HookPlugin** — subscribe to the 18 lifecycle events (`before:` / `after:` × approve / deny / execute / complete / fail / review / rest / wake / farewell). Plugin can observe or veto. Sandbox model: in-process, full Node capabilities, no sandbox — load only what you trust (`plugins.trusted: true`). See `SECURITY.md` § "Plugin trust model".

## Operational vocabulary

- **dogfood** — using the tool on its own development. `requests/` in the repo carries the project's own gate records as the canonical example.
- **ship** — merge a PR to `main`.
- **silent fallback** — an anti-pattern named in [`lore/traps/trap_silent_fallback_loses_signal.md`](../lore/traps/trap_silent_fallback_loses_signal.md): catching an error, returning a default, and producing output indistinguishable from the success path. The substrate's preferred form is `principle 09 orientation-disclosure` — surface the fallback.

---

## Where else does vocabulary live?

This file is the **authoritative** reference. Other docs that introduce the same terms:

- [`docs/concepts-for-newcomers.md`](./concepts-for-newcomers.md) § "Quick vocabulary" — a 10-line primer for newcomers; pointers in to here.
- [`docs/verbs.md`](./verbs.md) — per-verb examples and design notes.
- [`lore/README.md`](../lore/README.md) — principle / trap conventions.
- [`docs/playbook.md`](./playbook.md) — combo / synergy / tier vocabulary in context.
- [`docs/swarm.md`](./swarm.md) — swarm / slice / session_id vocabulary in context.

A term's authoritative definition lives here. If a definition in another doc drifts from this one, the other doc is wrong — patches welcome via [#344](https://github.com/eris-ths/guild-cli/issues/344)'s advisory audit pattern.
