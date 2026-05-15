// gate voice — set / read / clear the deployment-local voice mode.
//
// The mode-switch lever for the 4-layer voice resolution introduced
// alongside the voice-plugin landing (#345 cluster). The single
// short verb lets eris flip "今この気分" in one keystroke instead of
// re-exporting `GUILD_VOICE` or editing `guild.config.yaml`.
//
// Surface:
//   gate voice                  → introspect (which voice is active, from which layer)
//   gate voice <name>           → write <content_root>/.guild-voice = <name>
//   gate voice off              → delete <content_root>/.guild-voice
//
// Resolution (least → most specific):
//   config.voice.default < .guild-voice file < GUILD_VOICE env < per-invocation --voice
// Higher-precedence layers MASK lower ones in introspection output, so
// `gate voice` reflects what an actual write verb would pick up. Per-
// invocation flags aren't visible here — they live per command.
//
// Validation:
//   <name> must match the same pattern as a plugin name
//   (`[a-z][a-z0-9-]*`) so the env/file/config layers stay swappable.
//   We do NOT verify the name corresponds to a LOADED plugin — an
//   operator may set the mode for a plugin that will be installed
//   later, or check what they previously asked for after removing
//   the plugin. Silent miss on an unknown name is the established
//   ornamental-voice contract; the verb stays consistent with it.

import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { C } from './internal.js';
import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { maybeEmitExplain } from '../../shared/explain.js';
import { parseFormat } from '../../shared/parseFormat.js';
import {
  VOICE_MODE_FILE,
  resolveActiveVoiceName,
} from '../../shared/voiceRender.js';

const VOICE_NAME_RE = /^[a-z][a-z0-9-]*$/;
const VOICE_KNOWN_FLAGS: ReadonlySet<string> = new Set(['format']);

export async function voiceCmd(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, VOICE_KNOWN_FLAGS, 'voice');
  maybeEmitExplain(args, 'voice');
  const format = parseFormat(args);

  const arg = args.positional[0];
  const filePath = join(c.config.contentRoot, VOICE_MODE_FILE);

  // === introspect: `gate voice` (no positional) ===
  if (arg === undefined) {
    const resolved = resolveActiveVoiceName(c.config);
    if (format === 'json') {
      process.stdout.write(JSON.stringify({
        active: resolved?.name ?? null,
        source: resolved?.source ?? null,
        file_path: filePath,
      }, null, 2) + '\n');
    } else if (resolved === null) {
      process.stdout.write('voice: off\n');
      process.stdout.write(`  next: gate voice <name>  (writes ${VOICE_MODE_FILE})\n`);
    } else {
      process.stdout.write(`voice: ${resolved.name} (source: ${resolved.source})\n`);
      // Mask-detection: only fires when a HIGHER-priority layer is
      // winning over a (potentially expected) lower layer. Source
      // priority: env > file > config. So the hint applies ONLY when
      // source === 'env' (env can mask file + config); source === 'file'
      // can mask config but the operator just SET that file via this
      // verb, so the hint is noise. source === 'config' is the bottom
      // — nothing to mask. The pre-fix code fired the hint on every
      // non-file source, which surfaced misleading "higher-priority
      // layer" text on a config-only resolution.
      if (resolved.source === 'env') {
        process.stdout.write(
          `  hint: GUILD_VOICE env is masking lower layers. unset to let .guild-voice / config win.\n` +
            '        $ unset GUILD_VOICE\n',
        );
      }
    }
    return 0;
  }

  // === clear: `gate voice off` ===
  if (arg === 'off') {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      if (format === 'json') {
        process.stdout.write(JSON.stringify({ ok: true, action: 'cleared', file_path: filePath }, null, 2) + '\n');
      } else {
        process.stdout.write(`voice: cleared (.guild-voice removed)\n`);
      }
    } else {
      // Already off — idempotent. Surfacing this honestly rather than
      // pretending we deleted something.
      if (format === 'json') {
        process.stdout.write(JSON.stringify({ ok: true, action: 'noop', file_path: filePath }, null, 2) + '\n');
      } else {
        process.stdout.write(`voice: already off (no ${VOICE_MODE_FILE})\n`);
      }
    }
    return 0;
  }

  // === set: `gate voice <name>` ===
  if (!VOICE_NAME_RE.test(arg)) {
    throw new Error(
      `voice name "${arg}" is not valid: must match [a-z][a-z0-9-]*.\n` +
        '  next: use a name matching a voice plugin\'s `name` field (or any name you plan to install — set is permissive on intent).',
    );
  }
  writeFileSync(filePath, arg + '\n', 'utf8');
  if (format === 'json') {
    process.stdout.write(JSON.stringify({
      ok: true,
      action: 'set',
      name: arg,
      file_path: filePath,
    }, null, 2) + '\n');
  } else {
    process.stdout.write(`voice: ${arg} (.guild-voice written)\n`);
    // Heads-up if a higher-priority layer would still mask this.
    const envOverride = process.env['GUILD_VOICE'];
    if (typeof envOverride === 'string' && envOverride.length > 0 && envOverride !== arg) {
      process.stdout.write(
        `  notice: GUILD_VOICE=${envOverride} is set; it will mask .guild-voice until unset.\n`,
      );
    }
    // Also surface if the named voice isn't currently loaded — a
    // silent miss is the established contract but a one-line nudge
    // here costs voice budget once and saves a "why isn't it working"
    // troubleshoot.
    const loaded = c.voicePlugins.some((p) => p.name === arg);
    if (!loaded) {
      process.stdout.write(
        `  notice: voice "${arg}" is not currently loaded — set will take effect when the plugin is installed.\n`,
      );
    }
  }
  return 0;
}
