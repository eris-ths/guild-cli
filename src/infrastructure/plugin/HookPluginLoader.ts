// Hook plugin loader (issue #36 Phase 1 step 5).
//
// Reads paths from `guild.config.yaml`'s `plugins.hooks` (already
// trust-gated by GuildConfig — see `plugins.trusted: true`) and
// dynamically imports each as an ES module. Validates the export
// shape, resolves multi-event subscriptions, and collects errors
// per path. Mirrors the verb plugin loader pattern.
//
// Output shape: `subscriptions: Map<HookEvent, HookFn[]>` — one
// entry per (plugin, event) pair, ordered by plugin path then
// (when a single plugin subscribes to multiple events) by the
// `on:` array order.

import { pathToFileURL } from 'node:url';
import {
  HookPlugin,
  HookFn,
  HookEvent,
  ALL_HOOK_EVENTS,
  HookPluginLoadError,
  HookPluginLoadResult,
} from '../../application/plugin/HookPlugin.js';

const VALID_EVENTS: ReadonlySet<string> = new Set<string>(ALL_HOOK_EVENTS);

function validateHookShape(raw: unknown): { ok: true; plugin: HookPlugin } | { ok: false; reason: string } {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, reason: 'default export is not an object' };
  }
  const obj = raw as Record<string, unknown>;
  const onRaw = obj['on'];
  // `on` is required and may be a single event string or a non-empty
  // array of event strings. Empty arrays are rejected — a hook that
  // subscribes to nothing is dead code, surfacing as an explicit
  // configuration error is more useful than silently ignoring it.
  let events: readonly string[];
  if (typeof onRaw === 'string') {
    events = [onRaw];
  } else if (Array.isArray(onRaw)) {
    if (onRaw.length === 0) {
      return { ok: false, reason: '`on` must name at least one event' };
    }
    if (!onRaw.every((e) => typeof e === 'string')) {
      return { ok: false, reason: '`on` array must contain only strings' };
    }
    events = onRaw;
  } else {
    return { ok: false, reason: '`on` must be an event name or an array of event names' };
  }
  for (const e of events) {
    if (!VALID_EVENTS.has(e)) {
      return {
        ok: false,
        reason: `unknown event "${e}"; valid: ${ALL_HOOK_EVENTS.join(', ')}`,
      };
    }
  }
  if (typeof obj['run'] !== 'function') {
    return { ok: false, reason: 'run must be a function' };
  }
  return { ok: true, plugin: obj as unknown as HookPlugin };
}

export async function loadHookPlugins(
  pluginPaths: readonly string[],
): Promise<HookPluginLoadResult> {
  const subscriptions = new Map<HookEvent, HookFn[]>();
  const errors: HookPluginLoadError[] = [];
  const pluginsLoaded: Array<{ path: string; status: 'loaded' | 'error' }> = [];

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
    const result = validateHookShape(exportRoot);
    if (!result.ok) {
      errors.push({ path: pluginPath, reason: result.reason });
      pluginsLoaded.push({ path: pluginPath, status: 'error' });
      continue;
    }
    const plugin = result.plugin;
    const events: readonly HookEvent[] = Array.isArray(plugin.on)
      ? (plugin.on as readonly HookEvent[])
      : [plugin.on as HookEvent];
    for (const ev of events) {
      const arr = subscriptions.get(ev);
      if (arr) arr.push(plugin.run);
      else subscriptions.set(ev, [plugin.run]);
    }
    pluginsLoaded.push({ path: pluginPath, status: 'loaded' });
  }
  return { subscriptions, errors, pluginsLoaded };
}
