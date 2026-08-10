import { DomainError } from '../shared/DomainError.js';

/**
 * `RomPlugin` report envelope, v1 — see `docs/design/rom-plugin.md`.
 *
 * A ROM report is a machine-readable account of one bounded run:
 * the capability surface the engine granted, the subset actually
 * touched, a deterministic cost, and a fingerprint of the output.
 *
 * `guild-cli` owns this contract and no engine. Any engine that emits
 * the envelope qualifies; the substrate's job is to say loudly when
 * what it received is not the thing the contract describes.
 *
 * ## Why this file exists at all
 *
 * The design document's central argument for standardizing the shape is
 * that "a `v` field with a specified meaning can be violated **loudly**
 * instead of silently." Until this module, that sentence had no
 * implementation: nothing in the repository could tell a conforming
 * envelope from a plausible-looking object. Prose cannot fail.
 *
 * ## What is actually checked
 *
 * Shape checking is the cheap half. The half that earns its keep is the
 * set of **internal consistency** invariants — the places where the
 * envelope restates the same fact twice and the two copies can drift:
 *
 * - `engine.names.length === engine.windows`
 * - `capabilities.declared === engine.windows`
 * - `capabilities.used === capabilities.used_names.length`
 * - every `used_names[].name` appears in `engine.names`
 *
 * That last one is the real `declared ⊇ used`. Comparing only the
 * *counts* would accept a run that touched three windows the engine
 * never declared, as long as it touched three of something — which is
 * exactly the claim the envelope exists to make checkable.
 *
 * The redundancy is the engine's, not ours, and it is useful precisely
 * because it is redundant: a self-report whose two halves disagree is
 * a self-report to distrust. This is
 * `lore/traps/trap_identity_string_written_by_hand_beside_its_table`
 * pointed at a wire format instead of at source code — a declared count
 * sitting beside the table it counts, checked generically rather than
 * against any constant of our own.
 */

export const ROM_ENVELOPE_VERSION = 1;

export interface RomUsedWindow {
  readonly name: string;
  readonly count: number;
}

export interface RomEnvelope {
  readonly v: number;
  readonly engine: {
    readonly windows: number;
    readonly names: readonly string[];
    readonly feat: string;
  };
  readonly cost: {
    readonly instrs: number;
    readonly hostcalls: number;
    readonly mempeak_pages: number;
    readonly mode: string;
  };
  readonly io: {
    readonly out_bytes: number;
    readonly out_fnv1a: string;
  };
  readonly capabilities: {
    readonly declared: number;
    readonly used: number;
    readonly used_names: readonly RomUsedWindow[];
  };
}

/**
 * FNV-1a is 32-bit, so the anchor is at most 8 hex digits.
 *
 * The `0x` prefix is **optional**, and that is not laxity — the
 * reference engine emits the anchor bare and zero-padded (`{x:0>8}`,
 * e.g. `8f2ad431`), while `docs/design/rom-plugin.md`'s illustrative
 * value carries a `0x`. The document says its values are placeholders,
 * but a placeholder with the wrong *shape* is a trap for anyone
 * implementing against it. Both forms are accepted so that neither the
 * running engine nor a reader who trusted the document is rejected;
 * the document has been corrected to match the wire.
 */
const FNV1A_RE = /^(0x)?[0-9a-fA-F]{1,8}$/;

function fail(message: string, field: string): never {
  throw new DomainError(`rom envelope: ${message}`, field);
}

function obj(raw: unknown, field: string): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(`${field} must be an object`, field);
  }
  return raw as Record<string, unknown>;
}

function nonNegInt(raw: unknown, field: string): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
    fail(
      `${field} must be a non-negative integer, got ${JSON.stringify(raw)}`,
      field,
    );
  }
  return raw;
}

function nonEmptyString(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    fail(
      `${field} must be a non-empty string, got ${JSON.stringify(raw)}`,
      field,
    );
  }
  return raw;
}

/**
 * Parse and validate a v1 ROM report envelope.
 *
 * Throws `DomainError` naming the offending field. Never returns a
 * partially-validated object: a caller that gets a value back may treat
 * every invariant above as established.
 */
export function parseRomEnvelope(raw: unknown): RomEnvelope {
  const root = obj(raw, 'envelope');

  // Version first — a mismatch makes every field below unreliable, so
  // report it alone rather than as the first of a cascade.
  const v = root['v'];
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    fail(`v must be an integer, got ${JSON.stringify(v)}`, 'v');
  }
  if (v !== ROM_ENVELOPE_VERSION) {
    fail(
      `unsupported envelope version ${v} (this build understands v${ROM_ENVELOPE_VERSION})`,
      'v',
    );
  }

  const engine = obj(root['engine'], 'engine');
  const windows = nonNegInt(engine['windows'], 'engine.windows');
  const namesRaw = engine['names'];
  if (!Array.isArray(namesRaw)) {
    fail('engine.names must be an array of window names', 'engine.names');
  }
  const names = namesRaw.map((n, i) =>
    nonEmptyString(n, `engine.names[${i}]`),
  );
  const feat = engine['feat'];
  if (typeof feat !== 'string') {
    fail(
      `engine.feat must be a string, got ${JSON.stringify(feat)}`,
      'engine.feat',
    );
  }

  // Declared count vs the table it counts. An engine that emits a
  // truncated name list (or forgets to bump the count when it adds a
  // window) says so here instead of shipping a quiet under-report.
  if (names.length !== windows) {
    fail(
      `engine.windows says ${windows} but engine.names lists ${names.length} — ` +
        `the declared count and the table it counts disagree`,
      'engine.windows',
    );
  }
  const declaredSet = new Set(names);
  if (declaredSet.size !== names.length) {
    fail('engine.names contains duplicate window names', 'engine.names');
  }

  const cost = obj(root['cost'], 'cost');
  const instrs = nonNegInt(cost['instrs'], 'cost.instrs');
  const hostcalls = nonNegInt(cost['hostcalls'], 'cost.hostcalls');
  const mempeakPages = nonNegInt(cost['mempeak_pages'], 'cost.mempeak_pages');
  const mode = nonEmptyString(cost['mode'], 'cost.mode');

  const io = obj(root['io'], 'io');
  const outBytes = nonNegInt(io['out_bytes'], 'io.out_bytes');
  const outFnv1a = nonEmptyString(io['out_fnv1a'], 'io.out_fnv1a');
  if (!FNV1A_RE.test(outFnv1a)) {
    fail(
      `io.out_fnv1a must be a 32-bit hex anchor like "0x8f2ad431", got ${JSON.stringify(outFnv1a)}`,
      'io.out_fnv1a',
    );
  }

  const caps = obj(root['capabilities'], 'capabilities');
  const declared = nonNegInt(caps['declared'], 'capabilities.declared');
  const used = nonNegInt(caps['used'], 'capabilities.used');
  const usedRaw = caps['used_names'];
  if (!Array.isArray(usedRaw)) {
    fail(
      'capabilities.used_names must be an array of {name, count}',
      'capabilities.used_names',
    );
  }
  const usedNames: RomUsedWindow[] = usedRaw.map((entry, i) => {
    const e = obj(entry, `capabilities.used_names[${i}]`);
    const name = nonEmptyString(e['name'], `capabilities.used_names[${i}].name`);
    const count = nonNegInt(e['count'], `capabilities.used_names[${i}].count`);
    if (count === 0) {
      fail(
        `capabilities.used_names[${i}].count is 0 — a window that was not ` +
          `touched does not belong in used_names`,
        `capabilities.used_names[${i}].count`,
      );
    }
    return { name, count };
  });

  const seen = new Set<string>();
  for (const entry of usedNames) {
    if (seen.has(entry.name)) {
      fail(
        `capabilities.used_names lists "${entry.name}" more than once`,
        'capabilities.used_names',
      );
    }
    seen.add(entry.name);
  }

  if (declared !== windows) {
    fail(
      `capabilities.declared (${declared}) disagrees with engine.windows (${windows})`,
      'capabilities.declared',
    );
  }
  if (used !== usedNames.length) {
    fail(
      `capabilities.used says ${used} but used_names lists ${usedNames.length}`,
      'capabilities.used',
    );
  }
  if (used > declared) {
    fail(
      `capabilities.used (${used}) exceeds capabilities.declared (${declared})`,
      'capabilities.used',
    );
  }

  // The set relation the envelope exists to make checkable. Counts
  // alone would pass a run that touched windows the engine never
  // offered, which is the exact claim being verified.
  const undeclared = usedNames
    .map((e) => e.name)
    .filter((n) => !declaredSet.has(n));
  if (undeclared.length > 0) {
    fail(
      `capabilities.used_names touches window(s) absent from engine.names: ` +
        `${undeclared.join(', ')} — used ⊄ declared`,
      'capabilities.used_names',
    );
  }

  return {
    v,
    engine: { windows, names, feat },
    cost: { instrs, hostcalls, mempeak_pages: mempeakPages, mode },
    io: { out_bytes: outBytes, out_fnv1a: outFnv1a },
    capabilities: { declared, used, used_names: usedNames },
  };
}
