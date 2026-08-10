// `gate rom` — the `RomPlugin` report envelope
// (`docs/design/rom-plugin.md`): validate it, and record it.
//
// No subcommand list is enumerated in this comment. The switch in
// `romCmd` is the list, and its default branch prints it — a summary
// here would be one more hand-written restatement beside the table it
// describes, which is the trap this file's own domain module exists to
// check for on the wire.
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
// point landed together. The recording path then landed on top rather
// than as a fifth top-level verb, because the verb surface is already
// 50 wide with 33 hidden by default.
//
// ## Where a recorded envelope lands
//
// In `observations/`, its own substrate kind — not inline on the
// request record, and not referenced by digest. The reasoning belongs
// to the domain and lives there
// (`src/domain/observation/Observation.ts`): observations are
// append-only machine facts with no state machine, so a store built
// around transitions is the wrong home for them, and a separate store
// makes the machine/human discriminator *structural* instead of a
// prefix match some projection has to hand-maintain.

import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { readFile } from 'node:fs/promises';
import { C, readStdin, normalizeActor } from './internal.js';
import { resolveGuildActor } from '../../shared/resolveGuildActor.js';
import { parseFormat } from '../../shared/parseFormat.js';
import { parseRomEnvelope, ROM_ENVELOPE_VERSION } from '../../../domain/rom/RomEnvelope.js';
import {
  Observation,
  ObservationId,
  extractRomExtra,
} from '../../../domain/observation/Observation.js';
import { ObservationIdCollision } from '../../../application/ports/ObservationRepository.js';
import { MemberName } from '../../../domain/member/MemberName.js';
import { RequestId } from '../../../domain/request/RequestId.js';

const ROM_VERIFY_KNOWN_FLAGS: ReadonlySet<string> = new Set(['format']);
const ROM_RECORD_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'format',
  'by',
  'for',
  'source',
]);
const ROM_LIST_KNOWN_FLAGS: ReadonlySet<string> = new Set(['format', 'for']);
const ROM_SHOW_KNOWN_FLAGS: ReadonlySet<string> = new Set(['format']);

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
  switch (sub) {
    case 'verify':
      return await romVerify(args);
    case 'record':
      return await romRecord(c, args);
    case 'list':
      return await romList(c, args);
    case 'show':
      return await romShow(c, args);
    default:
      process.stderr.write(
        'gate rom needs a subcommand:\n' +
          '  gate rom verify <file|->              # validate an envelope, record nothing\n' +
          '  gate rom record <file|-> [--for <id>] # validate AND append an observation\n' +
          '  gate rom list [--for <id>]            # observations, oldest first\n' +
          '  gate rom show <o-id>                  # one observation in full\n' +
          `  (contract: docs/design/rom-plugin.md, v${ROM_ENVELOPE_VERSION})\n`,
      );
      return 1;
  }
}

async function romVerify(args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, ROM_VERIFY_KNOWN_FLAGS, 'rom verify');
  const format = parseFormat(args);

  const input = args.positional[1];
  if (input === undefined) {
    process.stderr.write(
      'gate rom verify needs a path (or `-` for stdin):\n' +
        '  gate rom verify report.json\n' +
        '  <engine> | gate rom verify -\n',
    );
    return 1;
  }

  // Both of these throw; the top-level handler turns them into the
  // shared error envelope, so `--format json` failures stay structured.
  const { envelope } = await loadEnvelope(input);

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify({ ok: true, input, envelope }, null, 2) + '\n',
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
  return 0;
}

/**
 * Shared by verify and record — one read path, one validation path.
 * Returns the validated contract view AND the raw document, because
 * `record` must persist keys the contract does not describe (see
 * ObservationBody.extra).
 */
async function loadEnvelope(input: string) {
  const raw = input === '-' ? await readStdin() : await readFile(input, 'utf8');
  const doc = extractEnvelope(raw);
  return { envelope: parseRomEnvelope(doc), doc };
}

/**
 * `gate rom record` — validate, then append an Observation.
 *
 * Validation is not optional on this path. An unverified envelope in
 * the store would be worse than none: the whole value of recording it
 * is that a later reader can treat `declared ⊇ used` as established
 * rather than claimed.
 */
async function romRecord(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, ROM_RECORD_KNOWN_FLAGS, 'rom record');
  const format = parseFormat(args);

  const input = args.positional[1];
  if (input === undefined) {
    process.stderr.write(
      'gate rom record needs a path (or `-` for stdin):\n' +
        '  gate rom record report.json --for 2026-08-10-0005\n' +
        '  <engine> | gate rom record - --source rom-stamp\n',
    );
    return 1;
  }

  const { envelope, doc } = await loadEnvelope(input);
  const extra = extractRomExtra(doc);
  const byRaw = optionalOption(args, 'by') ?? resolveGuildActor();
  if (byRaw === undefined || byRaw.length === 0) {
    process.stderr.write(
      'gate rom record needs an actor: pass --by <member> or set GUILD_ACTOR.\n',
    );
    return 1;
  }
  const by = MemberName.of(normalizeActor(byRaw));
  const subjectRaw = optionalOption(args, 'for');
  const emitter = optionalOption(args, 'source');

  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);

  // Sequence allocation retries on collision, same as issues/requests:
  // two writers can pick the same number, and the create-only write is
  // what actually arbitrates.
  let saved: Observation | undefined;
  for (let attempt = 0; attempt < 8; attempt++) {
    const seq = await c.observations.nextSequence(dateKey);
    const props: {
      id: ObservationId;
      by: MemberName;
      at: string;
      body: {
        kind: 'rom';
        envelope: typeof envelope;
        extra?: Readonly<Record<string, unknown>>;
      };
      subject?: RequestId;
      source?: string;
    } = {
      id: ObservationId.generate(now, seq),
      by,
      at: now.toISOString(),
      body: extra === undefined
        ? { kind: 'rom', envelope }
        : { kind: 'rom', envelope, extra },
    };
    if (subjectRaw !== undefined) props.subject = RequestId.of(subjectRaw);
    if (emitter !== undefined) props.source = emitter;
    const obs = Observation.create(props);
    try {
      await c.observations.saveNew(obs);
      saved = obs;
      break;
    } catch (e) {
      if (e instanceof ObservationIdCollision) continue;
      throw e;
    }
  }
  if (saved === undefined) {
    process.stderr.write(
      'gate rom record: could not allocate an observation id after 8 attempts ' +
        '(another writer is holding the sequence). Retry.\n',
    );
    return 1;
  }

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify({ ok: true, observation: saved.toJSON() }, null, 2) + '\n',
    );
    return 0;
  }
  process.stdout.write(
    `✓ observation: ${saved.id.value} (kind=rom` +
      (saved.subject ? ` for=${saved.subject.value}` : '') +
      `)\n` +
      `  instrs=${envelope.cost.instrs} declared=${envelope.capabilities.declared} ` +
      `used=${envelope.capabilities.used} out=${envelope.io.out_fnv1a}\n`,
  );
  return 0;
}

async function romList(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, ROM_LIST_KNOWN_FLAGS, 'rom list');
  const format = parseFormat(args);
  const forId = optionalOption(args, 'for');
  const all =
    forId === undefined
      ? await c.observations.listByKind('rom')
      : (await c.observations.listBySubject(forId)).filter(
          (o) => o.kind === 'rom',
        );

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        { count: all.length, observations: all.map((o) => o.toJSON()) },
        null,
        2,
      ) + '\n',
    );
    return 0;
  }
  if (all.length === 0) {
    process.stdout.write(
      forId === undefined
        ? 'no rom observations recorded yet.\n  gate rom record <file|->\n'
        : `no rom observations for ${forId}.\n`,
    );
    return 0;
  }
  for (const o of all) {
    if (o.body.kind !== 'rom') continue;
    const e = o.body.envelope;
    process.stdout.write(
      `${o.id.value}  ${o.at}  by=${o.by.value}` +
        (o.subject ? ` for=${o.subject.value}` : '') +
        (o.source ? ` src=${o.source}` : '') +
        `\n    instrs=${e.cost.instrs} declared=${e.capabilities.declared} ` +
        `used=${e.capabilities.used} out=${e.io.out_fnv1a}\n`,
    );
  }
  return 0;
}

async function romShow(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, ROM_SHOW_KNOWN_FLAGS, 'rom show');
  const format = parseFormat(args);
  const idRaw = args.positional[1];
  if (idRaw === undefined) {
    process.stderr.write(
      'gate rom show needs an observation id:\n  gate rom show o-2026-08-10-0001\n' +
        '  (list them with `gate rom list`)\n',
    );
    return 1;
  }
  const obs = await c.observations.findById(ObservationId.of(idRaw));
  if (obs === null) {
    process.stderr.write(
      `gate rom show: no observation ${idRaw}.\n  gate rom list\n`,
    );
    return 1;
  }
  if (format === 'json') {
    process.stdout.write(JSON.stringify(obs.toJSON(), null, 2) + '\n');
    return 0;
  }
  process.stdout.write(JSON.stringify(obs.toJSON(), null, 2) + '\n');
  return 0;
}
