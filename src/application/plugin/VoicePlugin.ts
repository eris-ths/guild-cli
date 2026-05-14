// Voice plugin contract (#345 — second dogfood validation of
// principle 15 plugins-default-extension, surface: ornamental-voice
// layer).
//
// Voice plugin lets a deployment attach an OPTIONAL ornamental
// narration to write-verb response envelopes — separate from the
// DOCTRINAL voice held in handlers (principle 08, "voice is held in
// handlers, not in plugins"). The two layers coexist:
//
//   Doctrinal voice  — suggested_next.reason / schema descriptions /
//                      finding messages. Lives in src/interface/**.
//                      Carries lore. Untouchable by plugins.
//
//   Ornamental voice — _meta.voice field on the JSON envelope. Lives
//                      in deployment-local YAML / .mjs files. Carries
//                      personality. Augments the structured payload,
//                      never replaces it.
//
// The plugin's default export carries per-verb template arrays. Each
// entry has a `when` predicate (substrate state) and a `template`
// string with `{var}` interpolation. First matching entry wins.
//
// v1 scope: terminal write verbs only (complete). fail/deny/etc.
// follow in a sibling PR once the plumbing proves out.

/**
 * Predicate keys evaluated against the post-mutation Request +
 * (for `review`) the just-appended review. Set is intentionally
 * small + explicit so the contract is auditable; new keys are
 * additive within 0.x per `docs/POLICY.md` § "Plugin stability".
 *
 *   default          — always matches; intended as the last entry in
 *                      a verb's array.
 *
 *   # close-note dimension (status_log[-1].cliff / .note)
 *   cliff_present    — terminal status_log entry has a non-empty cliff
 *                      (the closer left a forward-pointing hint).
 *                      Meaningful on `complete` only — other terminals
 *                      don't accept --cliff in v1.
 *   cliff_absent     — terminal status_log entry has no cliff.
 *   with_note        — status_log[-1].note is non-empty.
 *   without_note     — status_log[-1].note is empty.
 *
 *   # review-verdict dimension (reviews[-1].verdict on `review` verb)
 *   verdict_ok       — most-recent review's verdict is "ok".
 *   verdict_concern  — most-recent review's verdict is "concern".
 *   verdict_reject   — most-recent review's verdict is "reject".
 */
export type VoiceWhen =
  | 'default'
  | 'cliff_present'
  | 'cliff_absent'
  | 'with_note'
  | 'without_note'
  | 'verdict_ok'
  | 'verdict_concern'
  | 'verdict_reject';

/**
 * One narration template, gated by its `when` predicate.
 *
 * `template` supports `{var}` interpolation; supported variables:
 *   {id}       — req.id.value
 *   {action}   — req.action
 *   {by}       — for terminal transitions, status_log[-1].by; for
 *                `review`, the just-appended review's `by`. Empty
 *                string when neither is present.
 *   {note}     — status_log[-1].note. Used by approve / execute /
 *                deny / fail / complete to surface the actor's
 *                free-form prose. Empty when absent.
 *   {cliff}    — status_log[-1].cliff. Meaningful on `complete` only;
 *                empty elsewhere.
 *   {verdict}  — reviews[-1].verdict on `review` verb; empty
 *                elsewhere.
 *   {lense}    — reviews[-1].lense on `review` verb; empty elsewhere.
 *   {comment}  — reviews[-1].comment on `review` verb; empty elsewhere.
 *
 * Variables that are not in the supported set render as the literal
 * `{varname}` text so a typo in the voice file fails loudly at the
 * surface rather than silently producing empty output.
 */
export interface VoiceTemplate {
  readonly when: VoiceWhen;
  readonly template: string;
}

/**
 * Schema-description overrides keyed by verb name (#345 cluster #5).
 * `gate schema --voice <name>` overlays these strings onto the base
 * schema's `description` fields before emitting. Augment-not-replace:
 * any field a voice does NOT override falls through to the doctrinal
 * description held in handlers (principle 08 unchanged).
 *
 *   summary       — replaces the verb's top-level `summary` field
 *   input.<flag>  — replaces the verb's input property `description`
 *                   for the named flag (e.g. `cliff`, `note`, `by`)
 *
 * Both maps are sparse — only the keys the voice cares about appear.
 * Missing entries cleanly fall through to upstream-neutral prose.
 */
export interface VoiceSchemaOverride {
  readonly summary?: string;
  readonly input?: Readonly<Record<string, string>>;
}

/**
 * Read-side voice rendering hooks (#345 cluster Zeigarnik refinement).
 *
 * Where `verbs` carries ornamental narration for WRITE envelopes
 * (one template per state-change moment), `read.<surface>` carries
 * narration for READ surfaces that loop the operator back to their
 * past selves — currently just `past_cliffs` on boot.
 *
 * `past_cliffs` re-rendering structure:
 *   header — emitted once when the section opens; carries `{count}`
 *   entry  — emitted per cliff; carries
 *            {id} / {action} / {cliff} / {closed_by} / {closed_at}
 *
 * Both fields are optional. A plugin may carry only a header (one
 * line per session start) or only an entry template (skip the
 * structured row format, just show the voiced lines). Missing
 * read section / surface / field → falls back to the doctrinal
 * dry render in handlers (principle 08 carries forward — voice
 * augments, never replaces).
 */
export interface VoiceReadSurfaces {
  readonly past_cliffs?: {
    readonly header?: string;
    readonly entry?: string;
  };
}

/**
 * Curated "Essentials" verb list (#345 cluster mode-switch follow-up).
 * The set of verbs this voice considers load-bearing for daily work
 * — the verbs eris (or whoever the voice belongs to) actually reaches
 * for. Surfaced by `gate --help --essentials`, orthogonal to the
 * profile-driven BASE / COORDINATION / EXTRA tiering.
 *
 * Per-mode curation: `gate voice devil` activates devil-mode's
 * essentials (review/deny/fail emphasis); `gate voice ship` swaps to
 * ship-mode's (boot/next/complete emphasis). The mode-switch ritual
 * IS the curation switch — eris's "手の伸びる verb" tracks her cognitive
 * mode in one keystroke.
 *
 * `note` is optional prose surfaced alongside the list — a chance
 * for the voice to explain its curation logic in a sentence.
 */
export interface VoiceEssentials {
  readonly verbs: readonly string[];
  readonly note?: string;
}

/**
 * Plugin module's default export.
 *
 * Sections are all sparse — a plugin may carry any subset:
 *   `verbs`       — ornamental templates for write envelopes
 *   `schema`      — description overrides for `gate schema --voice`
 *   `essentials`  — curated verb list for `gate --help --essentials`
 */
export interface VoicePlugin {
  readonly name: string;
  readonly verbs: Readonly<Record<string, readonly VoiceTemplate[]>>;
  readonly schema?: {
    readonly verbs?: Readonly<Record<string, VoiceSchemaOverride>>;
  };
  readonly essentials?: VoiceEssentials;
  readonly read?: VoiceReadSurfaces;
}

/**
 * One per failed plugin path. Surfaced via `gate doctor` so the
 * operator sees broken voice plugins instead of silently losing the
 * narration. Mirrors VerbPluginLoadError shape.
 */
export interface VoicePluginLoadError {
  readonly path: string;
  readonly reason: string;
}

/**
 * Result of a single load pass. Plugins and errors are disjoint —
 * a path either contributes to `plugins` or to `errors`, never both.
 */
export interface VoicePluginLoadResult {
  readonly plugins: readonly VoicePlugin[];
  readonly errors: readonly VoicePluginLoadError[];
  readonly pluginsLoaded: ReadonlyArray<{ path: string; status: 'loaded' | 'error' }>;
}
