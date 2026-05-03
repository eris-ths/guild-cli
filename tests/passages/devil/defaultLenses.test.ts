// devil-review — default lense catalog tests.
//
// Pin the v1 catalog shape: 12 lenses, exactly the names from
// issue #126's table, and supply-chain carries the mandatory SCG
// delegate. These pins exist so a future commit cannot silently
// drop or rename a lense without the test failing — lenses are
// part of the substrate contract per principle 10.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lense } from '../../../src/passages/devil/domain/Lense.js';
import {
  buildDefaultLenses,
  DEFAULT_LENSE_NAMES,
} from '../../../src/passages/devil/domain/defaultLenses.js';

const EXPECTED_NAMES: readonly string[] = [
  'injection',
  'injection-parser',
  'path-network',
  'auth-access',
  'memory-safety',
  'crypto',
  'deserialization',
  'protocol-encoding',
  'supply-chain',
  'composition',
  'temporal',
  'coherence',
];

test('default lense catalog has exactly 12 lenses with the expected names', () => {
  const map = buildDefaultLenses();
  assert.equal(
    map.size,
    12,
    'expected 12 default lenses (Claude Security 8 + composition + temporal + supply-chain + coherence)',
  );
  assert.deepEqual(
    [...map.keys()].sort(),
    [...EXPECTED_NAMES].sort(),
    'lense names must match issue #126 exactly',
  );
  // DEFAULT_LENSE_NAMES is the canonical order for v0 discoverability.
  assert.deepEqual(
    [...DEFAULT_LENSE_NAMES].sort(),
    [...EXPECTED_NAMES].sort(),
  );
});

test('every default lense has non-empty title and description', () => {
  const map = buildDefaultLenses();
  for (const lense of map.values()) {
    assert.ok(lense.title.length > 0, `${lense.name}: title must be non-empty`);
    assert.ok(
      lense.description.length > 0,
      `${lense.name}: description must be non-empty`,
    );
  }
});

test('supply-chain lense delegates to scg (mandatory, not optional)', () => {
  const map = buildDefaultLenses();
  const sc = map.get('supply-chain');
  assert.ok(sc, 'supply-chain lense must exist');
  assert.equal(
    sc.delegate,
    'scg',
    'supply-chain.delegate must be "scg" per issue #126 mandatory-delegate decision',
  );
});

test('only supply-chain has a delegate; the other 11 are hand-rolled or any-source', () => {
  const map = buildDefaultLenses();
  for (const lense of map.values()) {
    if (lense.name === 'supply-chain') continue;
    assert.equal(
      lense.delegate,
      undefined,
      `${lense.name}: only supply-chain carries a mandatory delegate in v1`,
    );
  }
});

test('every default lense round-trips through toJSON without losing fields', () => {
  const map = buildDefaultLenses();
  for (const lense of map.values()) {
    const json = lense.toJSON();
    assert.equal(json['name'], lense.name);
    assert.equal(json['title'], lense.title);
    assert.equal(json['description'], lense.description);
    assert.deepEqual(json['ingest_sources'], lense.ingest_sources);
    if (lense.delegate !== undefined) {
      assert.equal(json['delegate'], lense.delegate);
    } else {
      assert.equal('delegate' in json, false, 'omit delegate when undefined');
    }
  }
});

test('Lense.create rejects empty title', () => {
  assert.throws(
    () =>
      Lense.create({
        name: 'x',
        title: '',
        description: 'desc',
      }),
    /title required/,
  );
});

test('Lense.create rejects empty description', () => {
  assert.throws(
    () =>
      Lense.create({
        name: 'x',
        title: 't',
        description: '',
      }),
    /description required/,
  );
});

test('Lense.create rejects malformed name (uppercase, leading digit, too long)', () => {
  assert.throws(() => Lense.create({ name: 'Bad', title: 't', description: 'd' }), /lense name/);
  assert.throws(() => Lense.create({ name: '1bad', title: 't', description: 'd' }), /lense name/);
  assert.throws(
    () => Lense.create({ name: 'a'.repeat(49), title: 't', description: 'd' }),
    /lense name/,
  );
});

test('Lense.create rejects empty delegate string', () => {
  assert.throws(
    () => Lense.create({ name: 'x', title: 't', description: 'd', delegate: '' }),
    /delegate must be a non-empty string/,
  );
});
