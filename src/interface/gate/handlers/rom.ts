// `gate rom` — reader for the `RomPlugin` report envelope
// (`docs/design/rom-plugin.md`).
//
// One read subverb today:
//   - `gate rom verify <file|-> [--format text|json]`
//
// ## Why a verb, given the verb surface is already wide
//
// The design document argues that standardizing the envelope is worth
// it because "a `v` field with a specified meaning can be violated
// loudly instead of silently." That sentence was, until this handler,
// unimplemented: the contract lived in prose, and prose cannot fail.
// A validator with no caller would have been worse than none — this
// repository shipped a test helper that threw on its first call for
// however long nobody called it — so the domain check and its entry
// point land together.
//
// The verb is read-only and carries no substrate write. Where a
// verified envelope should be *recorded* is deliberately still open
// (`docs/design/rom-plugin.md` § How a wave records it): that choice
// sets a storage precedent the design document wants settled by
// dogfood observation rather than in advance.

import {
  ParsedArgs,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { readFile } from 'node:fs/promises';
import { C, readStdin } from './internal.js';
import { parseFormat } from '../../shared/parseFormat.js';
import { parseRomEnvelope, ROM_ENVELOPE_VERSION } from '../../../domain/rom/RomEnvelope.js';

const ROM_VERIFY_KNOWN_FLAGS: ReadonlySet<string> = new Set(['format']);

/**
 * Pull an envelope out of raw input.
 *
 * Whole-document JSON is the plain case. Engines also emit the
 * envelope as one line inside a larger run log, usually behind a
 * prefix of their own; rather than hard-code any engine's prefix
 * (which would couple the substrate to one implementation — the exact
 * thing `docs/design/rom-plugin.md` refuses to do), scan lines for the
 * last one whose first `{` begins a JSON object carrying a `v` key.
 */
function extractEnvelope(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error('rom verify: input is empty');
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to the line scan
  }
  let found: unknown;
  for (const line of trimmed.split('\n')) {
    const brace = line.indexOf('{');
    if (brace === -1) continue;
    let candidate: unknown;
    try {
      candidate = JSON.parse(line.slice(brace));
    } catch {
      continue;
    }
    if (
      candidate !== null &&
      typeof candidate === 'object' &&
      !Array.isArray(candidate) &&
      'v' in (candidate as Record<string, unknown>)
    ) {
      found = candidate;
    }
  }
  if (found === undefined) {
    throw new Error(
      'rom verify: no envelope found — input is neither a JSON object nor a ' +
        'log containing one line with a JSON object carrying a "v" key',
    );
  }
  return found;
}

export async function romCmd(c: C, args: ParsedArgs): Promise<number> {
  const sub = args.positional[0];
  if (sub === undefined || sub !== 'verify') {
    process.stderr.write(
      'gate rom needs a subcommand:\n' +
        '  gate rom verify <file>    # validate a v1 ROM report envelope\n' +
        '  gate rom verify -         # ... reading it from stdin\n' +
        `  (contract: docs/design/rom-plugin.md, v${ROM_ENVELOPE_VERSION})\n`,
    );
    return 1;
  }
  rejectUnknownFlags(args, ROM_VERIFY_KNOWN_FLAGS, 'rom verify');
  const format = parseFormat(args);

  const source = args.positional[1];
  if (source === undefined) {
    process.stderr.write(
      'gate rom verify needs a path (or `-` for stdin):\n' +
        '  gate rom verify report.json\n' +
        '  <engine> | gate rom verify -\n',
    );
    return 1;
  }

  const raw = source === '-' ? await readStdin() : await readFile(source, 'utf8');
  // Both of these throw; the top-level handler turns them into the
  // shared error envelope, so `--format json` failures stay structured.
  const envelope = parseRomEnvelope(extractEnvelope(raw));

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify({ ok: true, source, envelope }, null, 2) + '\n',
    );
    return 0;
  }

  const used = envelope.capabilities.used_names
    .map((u) => `${u.name}×${u.count}`)
    .join(' ');
  process.stdout.write(
    `✓ rom envelope v${envelope.v} — contract satisfied\n` +
      `  cost      instrs=${envelope.cost.instrs} hostcalls=${envelope.cost.hostcalls} ` +
      `mempeak=${envelope.cost.mempeak_pages}p mode=${envelope.cost.mode}\n` +
      `  io        bytes=${envelope.io.out_bytes} fnv1a=${envelope.io.out_fnv1a}\n` +
      `  windows   declared=${envelope.capabilities.declared} ` +
      `used=${envelope.capabilities.used}` +
      (used.length > 0 ? ` (${used})` : '') +
      '\n',
  );
  // `used ⊆ declared` is an invariant of the parse above, not a thing
  // the reader has to check by eye — it is stated here so the text
  // surface says what was actually established, not just what was seen.
  process.stdout.write('  used ⊆ declared, verified by name\n');
  void c;
  return 0;
}
