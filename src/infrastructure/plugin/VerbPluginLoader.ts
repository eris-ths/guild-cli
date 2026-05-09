// Verb plugin loader (issue #36 Phase 1 step 4).
//
// Reads paths from `guild.config.yaml`'s `plugins.verbs` (already
// trust-gated by GuildConfig — see `plugins.trusted: true`) and
// dynamically imports each as an ES module. Validates the export
// shape, rejects collisions with built-in verb names, and collects
// errors per path so a single broken plugin doesn't take the rest
// of the loader down with it.
//
// Mirrors the doctor-plugin loader in
// `src/application/diagnostic/DiagnosticUseCases.ts`:
//   - `pathToFileURL` for cross-platform absolute imports (Windows
//     ESM rejects bare `C:\...` paths)
//   - `default ?? mod` to accept both `export default {...}` and
//     `module.exports = {...}` shapes
//   - errors become structured records, never thrown

import { pathToFileURL } from 'node:url';
import {
  VerbPlugin,
  VerbPluginLoadError,
  VerbPluginLoadResult,
  VerbCategory,
} from '../../application/plugin/VerbPlugin.js';

const VALID_CATEGORIES: ReadonlySet<VerbCategory> = new Set([
  'read',
  'write',
  'admin',
  'meta',
]);

/**
 * Validate a freshly-imported module's default export against the
 * VerbPlugin shape. Returns the plugin when valid, or a reason string
 * when not. Pure — no side effects, no I/O — so the loader's error
 * branch can be reasoned about line-by-line.
 */
function validatePluginShape(raw: unknown): { ok: true; plugin: VerbPlugin } | { ok: false; reason: string } {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, reason: 'default export is not an object' };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj['name'] !== 'string' || obj['name'].length === 0) {
    return { ok: false, reason: 'name must be a non-empty string' };
  }
  if (!/^[a-z][a-z0-9-]*$/.test(obj['name'])) {
    // Match the dispatch table's verb naming convention so plugin
    // names land in shell-friendly territory and the same regex
    // KNOWN_COMMANDS / `nearestCommand` use can find them.
    return {
      ok: false,
      reason: `name "${obj['name']}" is not a valid verb (lowercase, digits, hyphens; must start with a letter)`,
    };
  }
  if (typeof obj['category'] !== 'string' || !VALID_CATEGORIES.has(obj['category'] as VerbCategory)) {
    return {
      ok: false,
      reason: `category must be one of ${Array.from(VALID_CATEGORIES).join(' | ')}, got: ${JSON.stringify(obj['category'])}`,
    };
  }
  if (typeof obj['summary'] !== 'string' || obj['summary'].length === 0) {
    return { ok: false, reason: 'summary must be a non-empty string' };
  }
  if (obj['input'] === null || typeof obj['input'] !== 'object') {
    return { ok: false, reason: 'input must be a JsonSchema object' };
  }
  if (obj['output'] === null || typeof obj['output'] !== 'object') {
    return { ok: false, reason: 'output must be a JsonSchema object' };
  }
  if (typeof obj['run'] !== 'function') {
    return { ok: false, reason: 'run must be a function (c, args) => Promise<number>' };
  }
  return { ok: true, plugin: obj as unknown as VerbPlugin };
}

/**
 * Load every path in `pluginPaths` as a verb plugin. Built-in verb
 * names in `reservedNames` reject the plugin (collision is treated
 * as an error, not a silent shadow — built-ins always win).
 *
 * Two plugins claiming the same name in the same load pass: the
 * first wins, the rest are rejected. Order is the order of the
 * `plugins.verbs` array in `guild.config.yaml`.
 */
export async function loadVerbPlugins(
  pluginPaths: readonly string[],
  reservedNames: ReadonlySet<string>,
): Promise<VerbPluginLoadResult> {
  const plugins: VerbPlugin[] = [];
  const errors: VerbPluginLoadError[] = [];
  const pluginsLoaded: Array<{ path: string; status: 'loaded' | 'error' }> = [];
  const seenNames = new Set<string>();

  for (const pluginPath of pluginPaths) {
    let mod: { default?: unknown } & Record<string, unknown>;
    try {
      mod = await import(pathToFileURL(pluginPath).href);
    } catch (e) {
      errors.push({
        path: pluginPath,
        reason: `import failed: ${e instanceof Error ? e.message : String(e)}`,
      });
      pluginsLoaded.push({ path: pluginPath, status: 'error' });
      continue;
    }
    // Accept both `export default { ... }` and `module.exports = { ... }`
    // forms — same tolerance the doctor-plugin loader uses.
    const exportRoot = mod.default ?? mod;
    const result = validatePluginShape(exportRoot);
    if (!result.ok) {
      errors.push({ path: pluginPath, reason: result.reason });
      pluginsLoaded.push({ path: pluginPath, status: 'error' });
      continue;
    }
    const plugin = result.plugin;
    if (reservedNames.has(plugin.name)) {
      errors.push({
        path: pluginPath,
        reason: `verb "${plugin.name}" collides with a built-in — built-ins always win, plugin rejected`,
      });
      pluginsLoaded.push({ path: pluginPath, status: 'error' });
      continue;
    }
    if (seenNames.has(plugin.name)) {
      errors.push({
        path: pluginPath,
        reason: `verb "${plugin.name}" is already registered by an earlier plugin in this load pass`,
      });
      pluginsLoaded.push({ path: pluginPath, status: 'error' });
      continue;
    }
    seenNames.add(plugin.name);
    plugins.push(plugin);
    pluginsLoaded.push({ path: pluginPath, status: 'loaded' });
  }
  return { plugins, errors, pluginsLoaded };
}
