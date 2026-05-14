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

import type { Request } from '../../domain/request/Request.js';
import type { VoicePlugin, VoiceWhen } from '../../application/plugin/VoicePlugin.js';

/**
 * Resolve the active voice plugin from env + loaded set. Public so
 * the handler can short-circuit when no voice is active (avoid
 * touching the Request just to ask "is voice on?").
 */
export function resolveActiveVoice(
  voicePlugins: ReadonlyArray<VoicePlugin>,
  env: NodeJS.ProcessEnv = process.env,
): VoicePlugin | null {
  const name = env['GUILD_VOICE'];
  if (typeof name !== 'string' || name.length === 0) return null;
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
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const plugin = resolveActiveVoice(voicePlugins, env);
  if (plugin === null) return null;
  const templates = plugin.verbs[verb];
  if (!templates || templates.length === 0) return null;
  const vars = deriveVars(req, verb);
  for (const t of templates) {
    if (matchWhen(t.when, vars)) return interpolate(t.template, vars);
  }
  return null;
}
