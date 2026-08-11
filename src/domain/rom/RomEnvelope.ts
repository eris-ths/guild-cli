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
 * ## Two layers of claim
 *
 * `capabilities` is an *observation*: what this run touched, out of
 * what the engine offers. `policy` is an *enforcement claim*: what the
 * run was permitted to touch, and whether it tried to go further. The
 * second is strictly stronger and is checked against the first — under
 * enforcement the binding surface is `policy.granted`, not
 * `engine.names`, and a used window outside the grant set means the
 * engine is reporting that its own enforcement leaked.
 *
 * `timeline` and `exit` carry causality and outcome. Each invariant is
 * documented at the function that enforces it rather than enumerated
 * here; a list in this header would be one more restatement to keep in
 * sync (principle 17), and the checks are the thing readers must trust.
 *
 * ## Optional does not mean unchecked
 *
 * `policy`, `timeline` and `exit` may be absent — `guild-cli` owns the
 * contract and no engine, so an engine that observes without enforcing
 * is conforming. What is refused is a *present but hollow* block: a
 * granted list under `enforced: false`, a timeline missing windows the
 * same envelope reports as used. Absence is a legible silence;
 * a partial block is a silence wearing the shape of an answer.
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

/**
 * Capability enforcement, as reported by the run.
 *
 * `capabilities` says what the run *touched*. This says what it was
 * *allowed* to touch, and whether it tried to go further. The two are
 * independent claims: an engine can observe without enforcing
 * (`enforced: false`), which is the honest default and the reason this
 * block exists as its own thing rather than as more fields on
 * `capabilities`.
 *
 * **The granted set is fixed for the run.** A single list cannot
 * describe an authority that changes mid-run, so any engine that
 * revokes dynamically is outside this contract rather than quietly
 * under-describing itself with it. Several invariants below follow
 * from this and would be wrong without it.
 */
export interface RomPolicy {
  readonly enforced: boolean;
  /** Windows the run was permitted to call. Present iff `enforced`. */
  readonly granted?: readonly string[];
  /** Windows the run called and was refused. Present iff `enforced`. */
  readonly denied?: readonly RomUsedWindow[];
  /**
   * Where the *first* refusal happened. Optional even under
   * enforcement: an engine may deny-and-continue rather than stop, and
   * then there is no single location to name.
   */
  readonly stopped_at?: {
    readonly window: string;
    readonly instr: number;
    readonly hostcall: number;
  };
}

/**
 * First-touch order of the windows this run reached — causality, where
 * `capabilities` is a tally.
 *
 * **Emit it complete or omit it.** A truncated timeline is
 * indistinguishable from a complete one at the reading end, which is
 * the precise silence this envelope exists to remove. An engine with a
 * bounded buffer it might overflow should send no `timeline` rather
 * than a prefix, and the invariants below enforce that choice: every
 * used and every denied window must appear.
 */
export interface RomTimelineEntry {
  readonly seq: number;
  readonly window: string;
  readonly denied: boolean;
}

/** How the run ended. */
export interface RomExit {
  readonly trapped: boolean;
  readonly exited: boolean;
  readonly code: number;
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
  /** Optional blocks — absent means "not reported", never "empty". */
  readonly policy?: RomPolicy;
  readonly timeline?: readonly RomTimelineEntry[];
  readonly exit?: RomExit;
}

/**
 * The contract's top-level key set.
 *
 * Exported because `ObservationBody.extra` is defined as "the keys this
 * contract does not own", and that definition needs one source. A
 * second hand-kept copy beside the persistence layer is exactly
 * principle 17's failure: the day a block is specified here, the copy
 * over there keeps filing it as unknown and nothing says so.
 *
 * `tests/domain/RomEnvelope.test.ts` binds this set to the keys
 * `parseRomEnvelope` actually returns, so it cannot drift from the
 * parser either.
 */
export const ROM_CONTRACT_KEYS: ReadonlySet<string> = new Set([
  'v',
  'engine',
  'cost',
  'io',
  'capabilities',
  'policy',
  'timeline',
  'exit',
]);

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

function bool(raw: unknown, field: string): boolean {
  if (typeof raw !== 'boolean') {
    fail(`${field} must be a boolean, got ${JSON.stringify(raw)}`, field);
  }
  return raw;
}

/**
 * `[{name, count}]` with the same rules `used_names` follows: a count
 * of zero means "did not happen", and a thing that did not happen has
 * no entry. Shared so the two lists cannot diverge in what they accept.
 */
function windowCounts(
  raw: unknown,
  field: string,
  declared: ReadonlySet<string>,
): RomUsedWindow[] {
  if (!Array.isArray(raw)) {
    fail(`${field} must be an array of {name, count}`, field);
  }
  const out = raw.map((entry, i) => {
    const e = obj(entry, `${field}[${i}]`);
    const name = nonEmptyString(e['name'], `${field}[${i}].name`);
    const count = nonNegInt(e['count'], `${field}[${i}].count`);
    if (count === 0) {
      fail(
        `${field}[${i}].count is 0 — a window that was not touched does ` +
          `not belong in ${field}`,
        `${field}[${i}].count`,
      );
    }
    return { name, count };
  });
  const seen = new Set<string>();
  for (const entry of out) {
    if (seen.has(entry.name)) {
      fail(`${field} lists "${entry.name}" more than once`, field);
    }
    seen.add(entry.name);
  }
  const unknown = out.map((e) => e.name).filter((n) => !declared.has(n));
  if (unknown.length > 0) {
    fail(
      `${field} names window(s) absent from engine.names: ${unknown.join(', ')}`,
      field,
    );
  }
  return out;
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
 * `policy` — the enforcement half of the capability claim.
 *
 * The invariants here are the ones that make the block worth reading.
 * Shape alone would accept an engine reporting that it enforced a
 * grant set and then ran outside it.
 */
function parsePolicy(
  raw: unknown,
  declared: ReadonlySet<string>,
  usedNames: readonly RomUsedWindow[],
): RomPolicy {
  const p = obj(raw, 'policy');
  const enforced = bool(p['enforced'], 'policy.enforced');

  if (!enforced) {
    // No enforcement means no grant set — every window was permitted.
    // A `granted` list here would describe a restriction that is not in
    // force, which is worse than saying nothing: a reader would take
    // the narrower surface as the true one.
    for (const key of ['granted', 'denied', 'stopped_at']) {
      if (p[key] !== undefined) {
        fail(
          `policy.${key} is present but policy.enforced is false — ` +
            `nothing was being enforced, so there is no grant set to report`,
          `policy.${key}`,
        );
      }
    }
    return { enforced };
  }

  const grantedRaw = p['granted'];
  if (!Array.isArray(grantedRaw)) {
    fail(
      'policy.granted must be an array of window names when enforcement is on',
      'policy.granted',
    );
  }
  const granted = grantedRaw.map((n, i) =>
    nonEmptyString(n, `policy.granted[${i}]`),
  );
  const grantedSet = new Set(granted);
  if (grantedSet.size !== granted.length) {
    fail('policy.granted contains duplicate window names', 'policy.granted');
  }
  const ungrantable = granted.filter((n) => !declared.has(n));
  if (ungrantable.length > 0) {
    fail(
      `policy.granted names window(s) absent from engine.names: ` +
        `${ungrantable.join(', ')} — the engine cannot grant what it does ` +
        `not offer`,
      'policy.granted',
    );
  }

  const denied = windowCounts(p['denied'], 'policy.denied', declared);

  // Granted and denied are complementary under a grant set fixed for
  // the run: being refused a window you hold is a contradiction, not a
  // rare event.
  const both = denied.map((e) => e.name).filter((n) => grantedSet.has(n));
  if (both.length > 0) {
    fail(
      `policy.denied refuses window(s) that policy.granted permits: ` +
        `${both.join(', ')}`,
      'policy.denied',
    );
  }

  // The enforcement claim itself. `used ⊆ declared` is already checked
  // against engine.names; under enforcement the binding surface is the
  // grant set, which is narrower. An engine reporting a used window it
  // never granted is reporting that its own enforcement leaked — the
  // single most important thing this block can say, and invisible to
  // any count comparison.
  const escaped = usedNames
    .map((e) => e.name)
    .filter((n) => !grantedSet.has(n));
  if (escaped.length > 0) {
    fail(
      `capabilities.used_names touches window(s) not in policy.granted: ` +
        `${escaped.join(', ')} — enforcement was claimed but used ⊄ granted`,
      'policy.granted',
    );
  }

  const out: {
    enforced: boolean;
    granted: readonly string[];
    denied: readonly RomUsedWindow[];
    stopped_at?: { window: string; instr: number; hostcall: number };
  } = { enforced, granted, denied };

  const stoppedRaw = p['stopped_at'];
  if (stoppedRaw !== undefined) {
    const s = obj(stoppedRaw, 'policy.stopped_at');
    const window = nonEmptyString(s['window'], 'policy.stopped_at.window');
    const instr = nonNegInt(s['instr'], 'policy.stopped_at.instr');
    const hostcall = nonNegInt(s['hostcall'], 'policy.stopped_at.hostcall');
    // The stop is a refusal, so it must be one of the refusals.
    if (!denied.some((e) => e.name === window)) {
      fail(
        `policy.stopped_at.window "${window}" does not appear in ` +
          `policy.denied — the run cannot have stopped on a refusal it ` +
          `did not report`,
        'policy.stopped_at.window',
      );
    }
    out.stopped_at = { window, instr, hostcall };
  }

  return out;
}

/**
 * `timeline` — first-touch order.
 *
 * Completeness is enforced rather than assumed; see `RomTimelineEntry`
 * for why a prefix is refused instead of accepted.
 */
function parseTimeline(
  raw: unknown,
  declared: ReadonlySet<string>,
  usedNames: readonly RomUsedWindow[],
  policy: RomPolicy | undefined,
): RomTimelineEntry[] {
  if (!Array.isArray(raw)) {
    fail('timeline must be an array of {seq, window, denied}', 'timeline');
  }
  const entries = raw.map((entry, i) => {
    const e = obj(entry, `timeline[${i}]`);
    const seq = nonNegInt(e['seq'], `timeline[${i}].seq`);
    const window = nonEmptyString(e['window'], `timeline[${i}].window`);
    const denied = bool(e['denied'], `timeline[${i}].denied`);
    if (!declared.has(window)) {
      fail(
        `timeline[${i}].window "${window}" is absent from engine.names`,
        `timeline[${i}].window`,
      );
    }
    return { seq, window, denied };
  });

  // Contiguous 1..N in order. A gap means an entry was dropped, which
  // is the truncation this field refuses to represent.
  for (const [i, e] of entries.entries()) {
    if (e.seq !== i + 1) {
      fail(
        `timeline[${i}].seq is ${e.seq}, expected ${i + 1} — seq must run ` +
          `1..N in order with no gaps`,
        `timeline[${i}].seq`,
      );
    }
  }

  const windows = entries.map((e) => e.window);
  const windowSet = new Set(windows);
  if (windowSet.size !== windows.length) {
    fail(
      'timeline lists a window more than once — it records first touch, ' +
        'not every call',
      'timeline',
    );
  }

  // Completeness: anything the other blocks say was touched must be
  // here. This is what makes a present timeline trustworthy as a whole
  // account rather than a sample.
  const deniedNames = (policy?.denied ?? []).map((e) => e.name);
  const missing = [...usedNames.map((e) => e.name), ...deniedNames].filter(
    (n) => !windowSet.has(n),
  );
  if (missing.length > 0) {
    fail(
      `timeline omits window(s) reported elsewhere in this envelope: ` +
        `${missing.join(', ')} — emit a complete timeline or omit the field ` +
        `entirely (a prefix reads as a complete account)`,
      'timeline',
    );
  }

  // The denied flag restates policy.denied. Bind the two rather than
  // letting a reader pick whichever they looked at first.
  const flagged = entries.filter((e) => e.denied).map((e) => e.window).sort();
  const expected = [...deniedNames].sort();
  if (flagged.join(',') !== expected.join(',')) {
    fail(
      `timeline denied flags [${flagged.join(', ')}] disagree with ` +
        `policy.denied [${expected.join(', ')}]`,
      'timeline',
    );
  }

  return entries;
}

/** `exit` — how the run ended. */
function parseExit(raw: unknown): RomExit {
  const e = obj(raw, 'exit');
  const trapped = bool(e['trapped'], 'exit.trapped');
  const exited = bool(e['exited'], 'exit.exited');
  const code = nonNegInt(e['code'], 'exit.code');
  // A clean exit is not a trap, by the meaning of the two words. Both
  // true describes no run that happened.
  if (trapped && exited) {
    fail(
      'exit.trapped and exit.exited are both true — a run either trapped ' +
        'or exited cleanly',
      'exit.trapped',
    );
  }
  return { trapped, exited, code };
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

  // Optional blocks. Each is absent-or-valid: an engine that does not
  // report enforcement omits `policy` entirely rather than sending a
  // hollow one, so `undefined` here means "not reported" and never
  // "reported as nothing".
  const policy =
    root['policy'] === undefined
      ? undefined
      : parsePolicy(root['policy'], declaredSet, usedNames);
  const timeline =
    root['timeline'] === undefined
      ? undefined
      : parseTimeline(root['timeline'], declaredSet, usedNames, policy);
  const exit = root['exit'] === undefined ? undefined : parseExit(root['exit']);

  const out: {
    v: number;
    engine: RomEnvelope['engine'];
    cost: RomEnvelope['cost'];
    io: RomEnvelope['io'];
    capabilities: RomEnvelope['capabilities'];
    policy?: RomPolicy;
    timeline?: readonly RomTimelineEntry[];
    exit?: RomExit;
  } = {
    v,
    engine: { windows, names, feat },
    cost: { instrs, hostcalls, mempeak_pages: mempeakPages, mode },
    io: { out_bytes: outBytes, out_fnv1a: outFnv1a },
    capabilities: { declared, used, used_names: usedNames },
  };
  // Omit-when-absent keeps the persisted YAML byte-stable for engines
  // that send the subset — the same invariant the rest of the store
  // holds.
  if (policy !== undefined) out.policy = policy;
  if (timeline !== undefined) out.timeline = timeline;
  if (exit !== undefined) out.exit = exit;
  return out;
}
