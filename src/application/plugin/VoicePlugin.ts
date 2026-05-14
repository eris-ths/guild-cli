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
 * Predicate keys evaluated against the post-mutation Request. v1 set
 * is small + explicit so the contract is auditable; new keys are
 * additive within 0.x per `docs/POLICY.md` § "Plugin stability".
 *
 *   default          — always matches; intended as the last entry in
 *                      a verb's array.
 *   cliff_present    — terminal status_log entry has a non-empty cliff
 *                      (i.e. the closer left a forward-pointing hint).
 *   cliff_absent     — terminal status_log entry has no cliff.
 */
export type VoiceWhen = 'default' | 'cliff_present' | 'cliff_absent';

/**
 * One narration template, gated by its `when` predicate.
 *
 * `template` supports `{var}` interpolation; v1 variables:
 *   {id}       — req.id.value
 *   {action}   — req.action
 *   {by}       — terminal status_log entry's `by` (closing actor)
 *   {cliff}    — terminal cliff prose; empty string when absent
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
 * Plugin module's default export.
 *
 * `verbs` is a sparse map: only verbs the voice cares about appear.
 * v1 honours `complete` only; entries for other keys are tolerated
 * (forward-compatible) but unused.
 */
export interface VoicePlugin {
  readonly name: string;
  readonly verbs: Readonly<Record<string, readonly VoiceTemplate[]>>;
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
