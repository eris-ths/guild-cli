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
  VoiceSchemaOverride,
  VoiceTemplate,
  VoiceWhen,
} from '../../application/plugin/VoicePlugin.js';

const VALID_WHEN: ReadonlySet<VoiceWhen> = new Set([
  'default',
  'cliff_present',
  'cliff_absent',
  'with_note',
  'without_note',
  'verdict_ok',
  'verdict_concern',
  'verdict_reject',
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
  // schema overrides (#345 cluster #5) — optional, sparse, augment-only.
  // Validated strictly here so a malformed `schema` block fails the
  // whole plugin rather than silently dropping overrides at render time.
  let schema: VoicePlugin['schema'] | undefined;
  if (obj['schema'] !== undefined) {
    if (obj['schema'] === null || typeof obj['schema'] !== 'object') {
      return { ok: false, reason: 'schema must be an object when present' };
    }
    const schemaObj = obj['schema'] as Record<string, unknown>;
    const schemaVerbsRaw = schemaObj['verbs'];
    if (schemaVerbsRaw !== undefined) {
      if (schemaVerbsRaw === null || typeof schemaVerbsRaw !== 'object') {
        return { ok: false, reason: 'schema.verbs must be an object keyed by verb name' };
      }
      const schemaVerbs: Record<string, VoiceSchemaOverride> = {};
      for (const [verbName, override] of Object.entries(schemaVerbsRaw)) {
        if (override === null || typeof override !== 'object') {
          return { ok: false, reason: `schema.verbs.${verbName} must be an object` };
        }
        const ov = override as Record<string, unknown>;
        const out: { summary?: string; input?: Record<string, string> } = {};
        if (ov['summary'] !== undefined) {
          if (typeof ov['summary'] !== 'string') {
            return { ok: false, reason: `schema.verbs.${verbName}.summary must be a string` };
          }
          out.summary = ov['summary'];
        }
        if (ov['input'] !== undefined) {
          if (ov['input'] === null || typeof ov['input'] !== 'object') {
            return { ok: false, reason: `schema.verbs.${verbName}.input must be an object` };
          }
          const inputRaw = ov['input'] as Record<string, unknown>;
          const inputOut: Record<string, string> = {};
          for (const [flag, desc] of Object.entries(inputRaw)) {
            if (typeof desc !== 'string') {
              return { ok: false, reason: `schema.verbs.${verbName}.input.${flag} must be a string` };
            }
            inputOut[flag] = desc;
          }
          out.input = inputOut;
        }
        schemaVerbs[verbName] = out;
      }
      schema = { verbs: schemaVerbs };
    } else {
      schema = {};
    }
  }
  // essentials section (#345 cluster mode-switch follow-up).
  let essentials: VoicePlugin['essentials'] | undefined;
  if (obj['essentials'] !== undefined) {
    if (obj['essentials'] === null || typeof obj['essentials'] !== 'object') {
      return { ok: false, reason: 'essentials must be an object when present' };
    }
    const eo = obj['essentials'] as Record<string, unknown>;
    if (!Array.isArray(eo['verbs'])) {
      return { ok: false, reason: 'essentials.verbs must be an array of verb names' };
    }
    const verbNames: string[] = [];
    for (let i = 0; i < eo['verbs'].length; i++) {
      const v = eo['verbs'][i];
      if (typeof v !== 'string' || v.length === 0) {
        return { ok: false, reason: `essentials.verbs[${i}] must be a non-empty string` };
      }
      verbNames.push(v);
    }
    const ess: { verbs: string[]; note?: string } = { verbs: verbNames };
    if (eo['note'] !== undefined) {
      if (typeof eo['note'] !== 'string') {
        return { ok: false, reason: 'essentials.note must be a string when present' };
      }
      ess.note = eo['note'];
    }
    essentials = ess;
  }
  // read.past_cliffs (#345 cluster Zeigarnik refinement). Optional
  // header + entry templates for boot's past_cliffs section.
  let read: VoicePlugin['read'] | undefined;
  if (obj['read'] !== undefined) {
    if (obj['read'] === null || typeof obj['read'] !== 'object') {
      return { ok: false, reason: 'read must be an object when present' };
    }
    const ro = obj['read'] as Record<string, unknown>;
    const pcRaw = ro['past_cliffs'];
    if (pcRaw !== undefined) {
      if (pcRaw === null || typeof pcRaw !== 'object') {
        return { ok: false, reason: 'read.past_cliffs must be an object when present' };
      }
      const pc = pcRaw as Record<string, unknown>;
      const out: { header?: string; entry?: string } = {};
      if (pc['header'] !== undefined) {
        if (typeof pc['header'] !== 'string' || pc['header'].length === 0) {
          return { ok: false, reason: 'read.past_cliffs.header must be a non-empty string' };
        }
        out.header = pc['header'];
      }
      if (pc['entry'] !== undefined) {
        if (typeof pc['entry'] !== 'string' || pc['entry'].length === 0) {
          return { ok: false, reason: 'read.past_cliffs.entry must be a non-empty string' };
        }
        out.entry = pc['entry'];
      }
      read = { past_cliffs: out };
    } else {
      read = {};
    }
  }
  const out: { name: string; verbs: typeof verbs; schema?: typeof schema; essentials?: typeof essentials; read?: typeof read } = {
    name: obj['name'] as string,
    verbs,
  };
  if (schema !== undefined) out.schema = schema;
  if (essentials !== undefined) out.essentials = essentials;
  if (read !== undefined) out.read = read;
  return { ok: true, plugin: out as VoicePlugin };
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
