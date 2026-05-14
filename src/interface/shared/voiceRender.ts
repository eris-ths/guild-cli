// Ornamental-voice rendering (#345 — second dogfood validation of
// principle 15 plugins-default-extension).
//
// Two-layer model:
//   Doctrinal voice  — handler-held prose, carries lore (principle 08).
//   Ornamental voice — plugin-attached personality, augments envelopes.
//
// This module is the ornamental side. It evaluates a VoicePlugin's
// per-verb template array against a Request post-mutation snapshot,
// returns the first matching string, or null when nothing applies.
//
// Activation: `GUILD_VOICE=<name>` env var picks one loaded plugin by
// name. Unset → null. Set but no matching plugin → null. Set and the
// plugin has no entry for the verb → null. First matching `when` in
// the array wins.
//
// Pure synchronous — no I/O — so handlers can call inline before
// emitWriteResponse without growing the await surface.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Request } from '../../domain/request/Request.js';
import type { VoicePlugin, VoiceWhen } from '../../application/plugin/VoicePlugin.js';
import type { GuildConfig } from '../../infrastructure/config/GuildConfig.js';

/**
 * Filename of the per-deployment voice mode marker (#345 mode-switch
 * cluster). Lives at `<content_root>/.guild-voice`. One-line file:
 * the voice name to activate. Written by `gate voice <name>`, cleared
 * by `gate voice off`. Trimmed before use; empty file is treated as
 * "no mode set" (falls through to env / config / null).
 *
 * Centralised here so the verb handler + resolver agree on the path.
 */
export const VOICE_MODE_FILE = '.guild-voice';

/**
 * Source layer that resolved the active voice. Surfaced so callers
 * (e.g. `gate voice` introspection) can explain WHERE the current
 * mode came from. Mirrors `BootPayload.session_id_source`.
 *
 *   env    — GUILD_VOICE environment variable
 *   file   — <content_root>/.guild-voice
 *   config — voice.default in guild.config.yaml
 *
 * Per-invocation `--voice` flags (e.g. `gate schema --voice eris`)
 * are resolved at the handler boundary, not here — so the source
 * shown via this helper is the SESSION-level resolution.
 */
export type VoiceSource = 'env' | 'file' | 'config';

export interface ResolvedVoiceName {
  readonly name: string;
  readonly source: VoiceSource;
}

/**
 * Resolve the active voice NAME across the 4-layer priority order
 * (most specific → least specific):
 *   1. `--voice <name>` flag                 (per-invocation; resolved upstream)
 *   2. GUILD_VOICE env                       — this function, source='env'
 *   3. <content_root>/.guild-voice file      — source='file'
 *   4. voice.default in guild.config.yaml    — source='config'
 *
 * Returns null when no layer carries a value. Pure-ish: reads env
 * + filesystem but does not mutate. The file read is a hot path
 * (every write verb fires voice), so we existsSync first to avoid
 * raising ENOENT on the no-mode common case.
 */
export function resolveActiveVoiceName(
  config: Pick<GuildConfig, 'contentRoot' | 'voiceDefault'>,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedVoiceName | null {
  const fromEnv = env['GUILD_VOICE'];
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    return { name: fromEnv, source: 'env' };
  }
  const filePath = join(config.contentRoot, VOICE_MODE_FILE);
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, 'utf8').trim();
      if (raw.length > 0) {
        return { name: raw, source: 'file' };
      }
    } catch {
      // Read failure is non-fatal — voice resolution falls through
      // to the next layer. The verb handler will surface real read
      // errors when explicitly invoked.
    }
  }
  if (config.voiceDefault !== null && config.voiceDefault.length > 0) {
    return { name: config.voiceDefault, source: 'config' };
  }
  return null;
}

/**
 * Resolve the active voice plugin via the 4-layer name resolution +
 * plugin lookup. Public so handlers can short-circuit when no voice
 * is active (avoid touching the Request just to ask "is voice on?").
 *
 * Back-compat overload: when called with just `voicePlugins`, falls
 * back to the legacy env-only resolution. The 2-arg form (plugins +
 * config) honours the full 4-layer order. Existing call sites that
 * only have plugins keep working; new sites pass config too.
 */
export function resolveActiveVoice(
  voicePlugins: ReadonlyArray<VoicePlugin>,
  config?: Pick<GuildConfig, 'contentRoot' | 'voiceDefault'>,
  env: NodeJS.ProcessEnv = process.env,
): VoicePlugin | null {
  let name: string | null = null;
  if (config !== undefined) {
    const resolved = resolveActiveVoiceName(config, env);
    name = resolved?.name ?? null;
  } else {
    const fromEnv = env['GUILD_VOICE'];
    if (typeof fromEnv === 'string' && fromEnv.length > 0) name = fromEnv;
  }
  if (name === null) return null;
  for (const p of voicePlugins) {
    if (p.name === name) return p;
  }
  return null;
}

/**
 * Variables an ornamental template may interpolate. Sourced from the
 * post-mutation Request snapshot (+ for `review`, the just-appended
 * review entry) — never from caller imagination. Voice cannot invent
 * facts; that's the principle 08 invariant the two-layer model
 * preserves.
 *
 * Fields that don't apply to the current verb render as the empty
 * string. E.g. `cliff` is empty on a `deny` envelope, `verdict` is
 * empty everywhere except `review`. Templates can branch via `when`
 * predicates to avoid surfacing the empty form.
 */
interface VoiceVars {
  readonly id: string;
  readonly action: string;
  readonly by: string;
  readonly note: string;
  readonly cliff: string;
  readonly verdict: string;
  readonly lense: string;
  readonly comment: string;
}

const SUPPORTED_VARS: ReadonlySet<keyof VoiceVars> = new Set([
  'id',
  'action',
  'by',
  'note',
  'cliff',
  'verdict',
  'lense',
  'comment',
]);

function deriveVars(req: Request, verb: string): VoiceVars {
  const last = req.statusLog[req.statusLog.length - 1];
  // For `review` the salient surface is the just-appended review; for
  // every other write verb it's the status_log entry. We pick the
  // appropriate source per verb so `{by}` resolves to "the reviewer"
  // on review and "the transition actor" elsewhere — same intuition
  // a human reader would have.
  const lastReview = verb === 'review'
    ? req.reviews[req.reviews.length - 1]
    : undefined;
  return {
    id: req.id.value,
    action: req.action,
    by: lastReview?.by.value ?? last?.by ?? '',
    note: last?.note ?? '',
    cliff: last?.cliff ?? '',
    verdict: lastReview?.verdict ?? '',
    lense: lastReview?.lense ?? '',
    comment: lastReview?.comment ?? '',
  };
}

function matchWhen(when: VoiceWhen, vars: VoiceVars): boolean {
  switch (when) {
    case 'default':
      return true;
    case 'cliff_present':
      return vars.cliff.length > 0;
    case 'cliff_absent':
      return vars.cliff.length === 0;
    case 'with_note':
      return vars.note.length > 0;
    case 'without_note':
      return vars.note.length === 0;
    case 'verdict_ok':
      return vars.verdict === 'ok';
    case 'verdict_concern':
      return vars.verdict === 'concern';
    case 'verdict_reject':
      return vars.verdict === 'reject';
  }
}

const VAR_RE = /\{([a-z_]+)\}/g;

function interpolate(template: string, vars: VoiceVars): string {
  return template.replace(VAR_RE, (_, key: string) => {
    if (SUPPORTED_VARS.has(key as keyof VoiceVars)) {
      return vars[key as keyof VoiceVars];
    }
    // Unknown var renders as the literal `{name}` so a typo in the
    // voice file fails loudly at the surface rather than silently
    // emitting empty output. Matches the "voice cannot invent facts"
    // invariant: a typo IS a missing fact, and the rendering
    // surfaces that instead of papering over it.
    return `{${key}}`;
  });
}

/**
 * Pick the first matching template for `verb` and render it. Returns
 * null when no voice is active, no entry exists for the verb, or no
 * `when` predicate matched. Callers attach the result to the JSON
 * envelope's `_meta.voice` field — null suppresses the field entirely.
 */
export function renderVoice(
  voicePlugins: ReadonlyArray<VoicePlugin>,
  verb: string,
  req: Request,
  config?: Pick<GuildConfig, 'contentRoot' | 'voiceDefault'>,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const plugin = resolveActiveVoice(voicePlugins, config, env);
  if (plugin === null) return null;
  const templates = plugin.verbs[verb];
  if (!templates || templates.length === 0) return null;
  const vars = deriveVars(req, verb);
  for (const t of templates) {
    if (matchWhen(t.when, vars)) return interpolate(t.template, vars);
  }
  return null;
}
