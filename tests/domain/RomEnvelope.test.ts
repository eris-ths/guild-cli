import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRomEnvelope,
  ROM_ENVELOPE_VERSION,
} from '../../src/domain/rom/RomEnvelope.js';
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
