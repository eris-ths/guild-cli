// Verb plugin contract (issue #36 Phase 1 step 4).
//
// A verb plugin is an ES module whose default export carries the same
// shape `VerbSchema` declares for built-in verbs PLUS a `run` function.
// The loader (`src/infrastructure/plugin/VerbPluginLoader.ts`) imports
// the module, validates the export shape, and adds the verb to the
// dispatch fall-through after every built-in case.
//
// Trust model: plugins run in-process with full Node capabilities.
// `guild.config.yaml` must declare `plugins.trusted: true` before any
// path under `plugins.verbs` is loaded. See `SECURITY.md` § "Plugin
// trust model".
//
// Stability: the export shape is part of the 0.x plugin contract
// (`docs/POLICY.md` § "Plugin stability"). Renaming or removing a
// field requires a minor bump + BREAKING marker; adding optional
// fields is allowed in any release.

import type { JsonSchema } from '../../interface/gate/handlers/schema.js';

// Re-export-ish type for plugin authors. Kept minimal so a plugin
// can construct it without importing internal infra.
export type VerbCategory = 'read' | 'write' | 'admin' | 'meta';

/**
 * Plugin module's default export shape.
 *
 * `run` receives the full Container `c` (same value built-in handlers
 * see) and the parsed args. Return value is the process exit code —
 * 0 for success, non-zero for failure. Throwing is acceptable; the
 * dispatcher's top-level catch turns it into an error envelope.
 */
export interface VerbPlugin {
  readonly name: string;
  readonly category: VerbCategory;
  readonly summary: string;
  readonly input: JsonSchema;
  readonly output: JsonSchema;
  // The runtime signature is held loose here because VerbPlugin lives
  // in the application layer and Container is an interface-layer
  // concept. The infrastructure loader narrows the type when it
  // wires plugins into dispatch.
  readonly run: (c: unknown, args: unknown) => Promise<number>;
}

/**
 * One per failed plugin path. Surfaced via `gate doctor` so the
 * operator sees broken plugins instead of silently losing a verb.
 * Mirrors the doctor-plugin precedent in `DiagnosticUseCases.ts`.
 */
export interface VerbPluginLoadError {
  readonly path: string;
  readonly reason: string;
}

/**
 * Result of a single load pass. Plugins and errors are disjoint —
 * a path either contributes to `plugins` or to `errors`, never both.
 * Built-in name collisions land in `errors` (the plugin is rejected).
 *
 * `pluginsLoaded` is the per-path loaded/error roll-up used by
 * `gate doctor` to surface "what ran" — mirrors the
 * `PluginLoadInfo[]` pattern doctor plugins already use, so the
 * doctor renderer can treat verb plugin paths the same shape.
 */
export interface VerbPluginLoadResult {
  readonly plugins: readonly VerbPlugin[];
  readonly errors: readonly VerbPluginLoadError[];
  readonly pluginsLoaded: ReadonlyArray<{ path: string; status: 'loaded' | 'error' }>;
}
