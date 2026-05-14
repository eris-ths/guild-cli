// Voice plugin loader (#345 second dogfood validation of principle 15).
//
// Reads paths from `guild.config.yaml`'s `plugins.voices` (trust-gated
// by GuildConfig — `plugins.trusted: true`) and dynamically imports
// each as an ES module. Validates the export shape; one broken plugin
// never takes the rest of the loader down. Mirrors the shape +
// invariants of VerbPluginLoader so doctor reporting + trust model
// stay uniform across plugin kinds.

import { pathToFileURL } from 'node:url';
import {
  VoicePlugin,
  VoicePluginLoadError,
  VoicePluginLoadResult,
  VoiceTemplate,
  VoiceWhen,
} from '../../application/plugin/VoicePlugin.js';

const VALID_WHEN: ReadonlySet<VoiceWhen> = new Set([
  'default',
  'cliff_present',
  'cliff_absent',
]);

function validateTemplates(raw: unknown): { ok: true; templates: VoiceTemplate[] } | { ok: false; reason: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, reason: 'verb entry must be an array of {when, template} objects' };
  }
  const out: VoiceTemplate[] = [];
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i];
    if (e === null || typeof e !== 'object') {
      return { ok: false, reason: `entry[${i}] is not an object` };
    }
    const obj = e as Record<string, unknown>;
    if (typeof obj['when'] !== 'string' || !VALID_WHEN.has(obj['when'] as VoiceWhen)) {
      return {
        ok: false,
        reason:
          `entry[${i}].when must be one of ${[...VALID_WHEN].join(' | ')}, got ${JSON.stringify(obj['when'])}`,
      };
    }
    if (typeof obj['template'] !== 'string' || obj['template'].length === 0) {
      return { ok: false, reason: `entry[${i}].template must be a non-empty string` };
    }
    out.push({ when: obj['when'] as VoiceWhen, template: obj['template'] });
  }
  return { ok: true, templates: out };
}

/**
 * Validate a freshly-imported module's default export against the
 * VoicePlugin shape. Pure — no I/O — so the loader's error branch
 * stays linear.
 */
function validatePluginShape(raw: unknown): { ok: true; plugin: VoicePlugin } | { ok: false; reason: string } {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, reason: 'default export is not an object' };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj['name'] !== 'string' || obj['name'].length === 0) {
    return { ok: false, reason: 'name must be a non-empty string' };
  }
  // Same name regex as VerbPlugin — `GUILD_VOICE=<name>` lookups are
  // case-sensitive and the name lands in shell env, so restrict to
  // shell-friendly characters.
  if (!/^[a-z][a-z0-9-]*$/.test(obj['name'])) {
    return {
      ok: false,
      reason: `name "${obj['name']}" is not valid (lowercase, digits, hyphens; must start with a letter)`,
    };
  }
  if (obj['verbs'] === null || typeof obj['verbs'] !== 'object') {
    return { ok: false, reason: 'verbs must be an object keyed by verb name' };
  }
  const verbsObj = obj['verbs'] as Record<string, unknown>;
  const verbs: Record<string, VoiceTemplate[]> = {};
  for (const [verbName, entries] of Object.entries(verbsObj)) {
    const r = validateTemplates(entries);
    if (!r.ok) {
      return { ok: false, reason: `verbs.${verbName}: ${r.reason}` };
    }
    verbs[verbName] = r.templates;
  }
  return {
    ok: true,
    plugin: { name: obj['name'] as string, verbs },
  };
}

/**
 * Load every path in `pluginPaths` as a voice plugin. Two plugins
 * claiming the same `name` in the same load pass: first wins,
 * the rest are rejected (mirrors VerbPluginLoader's collision rule).
 *
 * Order is the order of `plugins.voices` in `guild.config.yaml`.
 */
export async function loadVoicePlugins(
  pluginPaths: readonly string[],
): Promise<VoicePluginLoadResult> {
  const plugins: VoicePlugin[] = [];
  const errors: VoicePluginLoadError[] = [];
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
    const exportRoot = mod.default ?? mod;
    const result = validatePluginShape(exportRoot);
    if (!result.ok) {
      errors.push({ path: pluginPath, reason: result.reason });
      pluginsLoaded.push({ path: pluginPath, status: 'error' });
      continue;
    }
    const plugin = result.plugin;
    if (seenNames.has(plugin.name)) {
      errors.push({
        path: pluginPath,
        reason: `voice "${plugin.name}" is already registered by an earlier plugin in this load pass`,
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
