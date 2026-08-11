import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRomEnvelope,
  ROM_ENVELOPE_VERSION,
  ROM_CONTRACT_KEYS,
} from '../../src/domain/rom/RomEnvelope.js';
import {
  extractRomExtra,
  romEnvelopeToJSON,
} from '../../src/domain/observation/Observation.js';
import { DomainError } from '../../src/domain/shared/DomainError.js';

// A conforming envelope. Every negative case below is this object with
// exactly one mutation, so a test that goes red names one invariant
// rather than "something about the envelope."
//
// Small on purpose: three declared windows, two touched. A fixture whose
// declared set is large enough to hide a missing name would let the
// `used ⊆ declared` check pass for the wrong reason.
function valid(): Record<string, unknown> {
  return {
    v: ROM_ENVELOPE_VERSION,
    engine: {
      windows: 3,
      names: ['fd_write', 'fd_read', 'proc_exit'],
      feat: 'sandbox,nonrec,budget',
    },
    cost: {
      instrs: 1812458726,
      hostcalls: 14,
      mempeak_pages: 528,
      mode: 'verify',
    },
    io: { out_bytes: 230415, out_fnv1a: '0x8f2ad431' },
    capabilities: {
      declared: 3,
      used: 2,
      used_names: [
        { name: 'fd_write', count: 12 },
        { name: 'proc_exit', count: 1 },
      ],
    },
  };
}

/** Apply one mutation and assert the parse rejects it, naming `field`. */
function rejects(
  label: string,
  field: string,
  mutate: (e: Record<string, unknown>) => void,
): void {
  test(`rejects ${label}`, () => {
    const e = valid();
    mutate(e);
    let caught: unknown;
    try {
      parseRomEnvelope(e);
    } catch (err) {
      caught = err;
    }
    assert.ok(
      caught instanceof DomainError,
      `expected DomainError for ${label}, got ${String(caught)}`,
    );
    assert.equal(
      (caught as DomainError).field,
      field,
      `wrong field named for ${label}: ${(caught as DomainError).message}`,
    );
  });
}

test('accepts a conforming envelope and returns it typed', () => {
  const parsed = parseRomEnvelope(valid());
  assert.equal(parsed.v, ROM_ENVELOPE_VERSION);
  assert.equal(parsed.engine.windows, 3);
  assert.equal(parsed.capabilities.used, 2);
  assert.deepEqual(
    parsed.capabilities.used_names.map((u) => u.name),
    ['fd_write', 'proc_exit'],
  );
});

test('the fixture is genuinely accepted (guards every negative below)', () => {
  // Without this, a fixture broken in some unrelated way would make
  // every `rejects` case pass for the wrong reason — the whole suite
  // would be green while checking nothing about the invariant it names.
  assert.doesNotThrow(() => parseRomEnvelope(valid()));
});

test('accepts the shape the reference engine actually emits', () => {
  // Transcribed from the emitter (`reportAgent`, exp/03 init.zig), not
  // from docs/design/rom-plugin.md — the document had been validated
  // only against itself and carried two divergences from the wire:
  //
  //   1. `out_fnv1a` printed with a `0x` prefix the engine never emits
  //      (`{x:0>8}` → bare, zero-padded). A parser written from the
  //      document would have rejected every real envelope.
  //   2. a `policy` block the document does not mention at all.
  //
  // Both are pinned here so the contract cannot drift back toward the
  // prose. Undocumented keys are ignored, not rejected: the wire is
  // allowed to be ahead of the spec, and a conforming envelope must
  // keep validating while it is.
  const fromEngine = {
    v: 1,
    engine: {
      windows: 3,
      names: ['fd_write', 'fd_read', 'proc_exit'],
      feat: 'sandbox,nonrec,sched,budget',
    },
    cost: { instrs: 42, hostcalls: 3, mempeak_pages: 2, mode: 'verify' },
    io: { out_bytes: 11, out_fnv1a: '8f2ad431' },
    capabilities: {
      declared: 3,
      used: 1,
      used_names: [{ name: 'fd_write', count: 2 }],
    },
    policy: { enforced: false },
  };
  const parsed = parseRomEnvelope(fromEngine);
  assert.equal(parsed.io.out_fnv1a, '8f2ad431');
  assert.equal(parsed.capabilities.used, 1);
});

test('rejects a non-object at the root', () => {
  assert.throws(() => parseRomEnvelope('not an envelope'), DomainError);
  assert.throws(() => parseRomEnvelope(null), DomainError);
  assert.throws(() => parseRomEnvelope([valid()]), DomainError);
});

// --- version ----------------------------------------------------------
rejects('a future envelope version', 'v', (e) => {
  e['v'] = ROM_ENVELOPE_VERSION + 1;
});
rejects('a non-integer version', 'v', (e) => {
  e['v'] = '1';
});

// --- engine -----------------------------------------------------------
rejects('a missing engine block', 'engine', (e) => {
  delete e['engine'];
});
rejects('a negative window count', 'engine.windows', (e) => {
  (e['engine'] as Record<string, unknown>)['windows'] = -1;
});
rejects('a name list shorter than the declared count', 'engine.windows', (e) => {
  // The trap this module exists to catch, in its wire form: a count
  // hand-maintained beside the table it counts.
  (e['engine'] as Record<string, unknown>)['names'] = ['fd_write', 'fd_read'];
});
rejects('duplicate declared window names', 'engine.names', (e) => {
  (e['engine'] as Record<string, unknown>)['names'] = [
    'fd_write',
    'fd_write',
    'proc_exit',
  ];
});

// --- cost / io --------------------------------------------------------
rejects('a fractional instruction count', 'cost.instrs', (e) => {
  (e['cost'] as Record<string, unknown>)['instrs'] = 1.5;
});
rejects('an empty cost mode', 'cost.mode', (e) => {
  (e['cost'] as Record<string, unknown>)['mode'] = '';
});
rejects('an output anchor that is not 32-bit hex', 'io.out_fnv1a', (e) => {
  (e['io'] as Record<string, unknown>)['out_fnv1a'] = 'deadbeefcafe';
});

// --- capabilities: the invariants that earn the module ----------------
rejects('a declared count disagreeing with engine.windows', 'capabilities.declared', (e) => {
  (e['capabilities'] as Record<string, unknown>)['declared'] = 20;
});
rejects('a used count disagreeing with used_names', 'capabilities.used', (e) => {
  (e['capabilities'] as Record<string, unknown>)['used'] = 5;
});
rejects('a zero-count entry in used_names', 'capabilities.used_names[1].count', (e) => {
  const caps = e['capabilities'] as Record<string, unknown>;
  caps['used_names'] = [
    { name: 'fd_write', count: 12 },
    { name: 'proc_exit', count: 0 },
  ];
});
rejects('a duplicated used window', 'capabilities.used_names', (e) => {
  const caps = e['capabilities'] as Record<string, unknown>;
  caps['used_names'] = [
    { name: 'fd_write', count: 12 },
    { name: 'fd_write', count: 1 },
  ];
});

test('rejects a used window the engine never declared (used ⊄ declared)', () => {
  // The invariant that a count-only check would miss: the totals still
  // agree (declared 3 ≥ used 2, used === used_names.length), and the
  // run still touched a window that is not on the engine's list.
  const e = valid();
  const caps = e['capabilities'] as Record<string, unknown>;
  caps['used_names'] = [
    { name: 'fd_write', count: 12 },
    { name: 'path_open', count: 1 },
  ];
  let caught: unknown;
  try {
    parseRomEnvelope(e);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof DomainError);
  assert.equal((caught as DomainError).field, 'capabilities.used_names');
  assert.match((caught as DomainError).message, /path_open/);
});

test('counts alone would not have caught it — the arithmetic is consistent', () => {
  // Pins why the name check is not redundant with the count checks. If
  // someone later "simplifies" the parser down to comparing numbers,
  // this states what would be lost.
  const e = valid();
  const caps = e['capabilities'] as Record<string, unknown>;
  caps['used_names'] = [
    { name: 'fd_write', count: 12 },
    { name: 'path_open', count: 1 },
  ];
  const declared = caps['declared'] as number;
  const used = caps['used'] as number;
  const list = caps['used_names'] as unknown[];
  assert.equal(used, list.length);
  assert.ok(used <= declared);
});

// --- policy / timeline / exit -----------------------------------------
//
// These three blocks shipped on the wire before they were specified.
// `gate rom verify` accepted them as unknown keys and `gate rom record`
// stored them verbatim in `ObservationBody.extra`, which is why they
// could be specified later from stored runs rather than from prose.
//
// The fixture below is the shape the reference engine emits under
// enforcement, transcribed from `reportAgent` (exp/03 init.zig): three
// declared windows, two used, one denied, and the denial is where the
// run stopped.

function validFull(): Record<string, unknown> {
  const e = valid();
  e['policy'] = {
    enforced: true,
    granted: ['fd_write', 'proc_exit'],
    denied: [{ name: 'fd_read', count: 1 }],
    stopped_at: { window: 'fd_read', instr: 4211, hostcall: 3 },
  };
  e['timeline'] = [
    { seq: 1, window: 'fd_write', denied: false },
    { seq: 2, window: 'proc_exit', denied: false },
    { seq: 3, window: 'fd_read', denied: true },
  ];
  e['exit'] = { trapped: true, exited: false, code: 0 };
  return e;
}

/** `rejects`, but mutating the fully-populated fixture. */
function rejectsFull(
  label: string,
  field: string,
  mutate: (e: Record<string, unknown>) => void,
): void {
  test(`rejects ${label}`, () => {
    const e = validFull();
    mutate(e);
    let caught: unknown;
    try {
      parseRomEnvelope(e);
    } catch (err) {
      caught = err;
    }
    assert.ok(
      caught instanceof DomainError,
      `expected DomainError for ${label}, got ${String(caught)}`,
    );
    assert.equal(
      (caught as DomainError).field,
      field,
      `wrong field named for ${label}: ${(caught as DomainError).message}`,
    );
  });
}

test('the full fixture is genuinely accepted (guards every negative below)', () => {
  assert.doesNotThrow(() => parseRomEnvelope(validFull()));
});

test('accepts a fully-populated envelope and returns all three blocks typed', () => {
  const p = parseRomEnvelope(validFull());
  assert.equal(p.policy?.enforced, true);
  assert.deepEqual(p.policy?.granted, ['fd_write', 'proc_exit']);
  assert.deepEqual(p.policy?.denied?.map((d) => d.name), ['fd_read']);
  assert.equal(p.policy?.stopped_at?.window, 'fd_read');
  assert.equal(p.timeline?.length, 3);
  assert.equal(p.exit?.trapped, true);
});

test('the optional blocks are optional — absence is not a rejection', () => {
  // `guild-cli` owns the contract and no engine. An engine that
  // observes without enforcing conforms; what it must not do is send a
  // hollow block. This pins the permissive half so a later tightening
  // of the invariants cannot quietly make the blocks mandatory.
  const p = parseRomEnvelope(valid());
  assert.equal(p.policy, undefined);
  assert.equal(p.timeline, undefined);
  assert.equal(p.exit, undefined);
});

test('ROM_CONTRACT_KEYS is the key set the parser actually returns', () => {
  // The binding that keeps `ObservationBody.extra` honest. `extra` is
  // defined as "top-level keys the contract does not own", so the day a
  // block is specified here, the persistence layer must stop filing it
  // as unknown. A hand-kept second list would not — it would keep
  // storing `policy` as extra, silently, with nothing comparing them.
  const parsed = parseRomEnvelope(validFull()) as unknown as Record<
    string,
    unknown
  >;
  assert.deepEqual(
    Object.keys(parsed).sort(),
    [...ROM_CONTRACT_KEYS].sort(),
    'the parser returns a different key set than ROM_CONTRACT_KEYS declares',
  );
  // And the consumer's behaviour, not just the constant: a fully
  // specified envelope leaves nothing over.
  assert.equal(extractRomExtra(validFull()), undefined);
  // While an envelope carrying something genuinely new still does.
  const ahead = validFull();
  ahead['coverage'] = { edges: 12 };
  assert.deepEqual(extractRomExtra(ahead), { coverage: { edges: 12 } });
});

// policy — enforcement is a claim, and the claim is checked
rejectsFull('a grant list under enforced:false', 'policy.granted', (e) => {
  e['policy'] = { enforced: false, granted: ['fd_write'] };
  delete e['timeline'];
});
rejectsFull('a denial list under enforced:false', 'policy.denied', (e) => {
  e['policy'] = { enforced: false, denied: [{ name: 'fd_read', count: 1 }] };
  delete e['timeline'];
});
rejectsFull('a non-boolean enforced flag', 'policy.enforced', (e) => {
  (e['policy'] as Record<string, unknown>)['enforced'] = 'true';
});
rejectsFull('granting a window the engine never declared', 'policy.granted', (e) => {
  (e['policy'] as Record<string, unknown>)['granted'] = ['fd_write', 'proc_exit', 'path_open'];
});
rejectsFull('a window both granted and denied', 'policy.denied', (e) => {
  const p = e['policy'] as Record<string, unknown>;
  p['granted'] = ['fd_write', 'proc_exit', 'fd_read'];
});
rejectsFull('a denial count of zero', 'policy.denied[0].count', (e) => {
  const p = e['policy'] as Record<string, unknown>;
  p['denied'] = [{ name: 'fd_read', count: 0 }];
  p['stopped_at'] = { window: 'fd_read', instr: 1, hostcall: 1 };
});
rejectsFull('stopping on a refusal that was never reported', 'policy.stopped_at.window', (e) => {
  const p = e['policy'] as Record<string, unknown>;
  p['stopped_at'] = { window: 'proc_exit', instr: 1, hostcall: 1 };
});

test('rejects a used window outside the grant set — enforcement leaked', () => {
  // The reason `policy` is worth specifying at all. `used ⊆ declared`
  // already passes here: fd_read IS one of engine.names, and every
  // count is arithmetically consistent. What fails is the narrower
  // claim the engine made about itself — it said it was enforcing a
  // grant set, and then reported using a window outside it.
  const e = validFull();
  const caps = e['capabilities'] as Record<string, unknown>;
  caps['used'] = 3;
  caps['used_names'] = [
    { name: 'fd_write', count: 12 },
    { name: 'proc_exit', count: 1 },
    { name: 'fd_read', count: 1 },
  ];
  const p = e['policy'] as Record<string, unknown>;
  p['denied'] = [];
  delete p['stopped_at'];
  e['timeline'] = [
    { seq: 1, window: 'fd_write', denied: false },
    { seq: 2, window: 'proc_exit', denied: false },
    { seq: 3, window: 'fd_read', denied: false },
  ];

  // Same object minus the policy block: this is what the pre-spec
  // parser saw, and it accepted it.
  const withoutPolicy = { ...e };
  delete withoutPolicy['policy'];
  delete withoutPolicy['timeline'];
  assert.doesNotThrow(
    () => parseRomEnvelope(withoutPolicy),
    'the leak is invisible without policy — that is the point of the block',
  );

  let caught: unknown;
  try {
    parseRomEnvelope(e);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof DomainError, 'the leak was not caught');
  assert.equal((caught as DomainError).field, 'policy.granted');
  assert.match((caught as DomainError).message, /fd_read/);
});

// timeline — complete or absent, never a prefix
rejectsFull('a gap in the timeline sequence', 'timeline[1].seq', (e) => {
  const t = e['timeline'] as Record<string, unknown>[];
  t[1]!['seq'] = 3;
  t[2]!['seq'] = 4;
});
rejectsFull('a window listed twice in the timeline', 'timeline', (e) => {
  e['timeline'] = [
    { seq: 1, window: 'fd_write', denied: false },
    { seq: 2, window: 'fd_write', denied: false },
    { seq: 3, window: 'proc_exit', denied: false },
    { seq: 4, window: 'fd_read', denied: true },
  ];
});
rejectsFull('a timeline window absent from engine.names', 'timeline[2].window', (e) => {
  const t = e['timeline'] as Record<string, unknown>[];
  t[2]!['window'] = 'path_open';
});
test('rejects a timeline that omits a window reported as used', () => {
  // The truncation case. What is dropped here is a *used* window, not
  // the denied one, so the denied-flag check below still agrees and
  // completeness is the only invariant that can fire. An earlier
  // version of this test dropped the tail instead: the flags check
  // caught it first and named the same field, so the assertion passed
  // while the completeness guard was dead. Mutation testing found it —
  // deleting the completeness check left the suite green.
  //
  // Hence the message assertion. Two checks guarding one field cannot
  // stand in for each other silently.
  const e = validFull();
  e['timeline'] = [
    { seq: 1, window: 'proc_exit', denied: false },
    { seq: 2, window: 'fd_read', denied: true },
  ];
  let caught: unknown;
  try {
    parseRomEnvelope(e);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof DomainError, 'a truncated timeline was accepted');
  assert.equal((caught as DomainError).field, 'timeline');
  assert.match(
    (caught as DomainError).message,
    /omits window\(s\) reported elsewhere/,
    'rejected, but by a different invariant than completeness',
  );
  assert.match((caught as DomainError).message, /fd_write/);
});
rejectsFull('timeline denied flags that disagree with policy.denied', 'timeline', (e) => {
  const t = e['timeline'] as Record<string, unknown>[];
  t[2]!['denied'] = false;
});

test('rejects a denial flag when nothing was being enforced', () => {
  // A timeline claiming a refusal with no policy in force is a report
  // about an authority that does not exist.
  const e = valid();
  e['timeline'] = [
    { seq: 1, window: 'fd_write', denied: false },
    { seq: 2, window: 'proc_exit', denied: true },
  ];
  assert.throws(() => parseRomEnvelope(e), DomainError);
});

// exit
rejectsFull('a run that both trapped and exited cleanly', 'exit.trapped', (e) => {
  (e['exit'] as Record<string, unknown>)['exited'] = true;
});
rejectsFull('a negative exit code', 'exit.code', (e) => {
  (e['exit'] as Record<string, unknown>)['code'] = -1;
});
rejectsFull('a non-boolean trapped flag', 'exit.trapped', (e) => {
  (e['exit'] as Record<string, unknown>)['trapped'] = 1;
});

test('the serializer round-trips every specified field', () => {
  // `romEnvelopeToJSON` is a third statement of the envelope shape,
  // after the type and the parser. It cannot be derived from either, so
  // it is bound here instead: serialize(parse(x)) must equal x.
  //
  // Written because it had already dropped `policy`, `timeline` and
  // `exit` — they parsed, they validated, and then they did not reach
  // the disk. Nothing noticed, because the only test that touched them
  // asserted they were preserved as *unknown* keys, and unknown keys
  // travel by a different path.
  assert.deepEqual(romEnvelopeToJSON(parseRomEnvelope(validFull())), validFull());
});

test('the serializer omits absent blocks rather than emitting empty ones', () => {
  // Absence and emptiness are different claims: "made no enforcement
  // claim" is not "enforced nothing". Omit-when-absent is also the
  // store's byte-stability invariant.
  const out = romEnvelopeToJSON(parseRomEnvelope(valid()));
  assert.deepEqual(romEnvelopeToJSON(parseRomEnvelope(valid())), valid());
  assert.ok(!('policy' in out), 'an absent policy was serialized anyway');
  assert.ok(!('timeline' in out), 'an absent timeline was serialized anyway');
  assert.ok(!('exit' in out), 'an absent exit was serialized anyway');
});

test('a non-contract key named __proto__ survives as a key', () => {
  // `out[k] = v` routes `__proto__` through the prototype setter: the
  // value becomes the object's prototype rather than one of its keys,
  // `Object.keys` reports nothing, and `extractRomExtra` returns
  // undefined — the block is discarded as empty. Silent loss, in the
  // function whose entire purpose is to not lose things.
  //
  // Reachable from engine output: `JSON.parse` produces an own
  // `__proto__` property, so this does not require a hand-built object.
  const raw = JSON.parse(
    '{"v":1,"__proto__":{"hostile":"yes"},"coverage":{"edges":3}}',
  ) as Record<string, unknown>;
  const extra = extractRomExtra(raw);
  assert.ok(extra !== undefined, 'the non-contract keys were dropped entirely');
  assert.deepEqual(
    Object.keys(extra).sort(),
    ['__proto__', 'coverage'],
    '__proto__ did not survive as a key',
  );
  // The global prototype was never at risk — the target is a fresh
  // literal — but assert it, because a future refactor to a shared
  // accumulator would change that and nothing else would notice.
  assert.equal(
    (Object.prototype as Record<string, unknown>)['hostile'],
    undefined,
    'Object.prototype was polluted',
  );
});
