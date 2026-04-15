import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSequenceIds } from '../../src/domain/shared/compareSequenceIds.js';

test('compareSequenceIds: 4-digit only sorts numerically', () => {
  const ids = ['2026-04-15-0011', '2026-04-15-0002', '2026-04-15-0020'];
  ids.sort(compareSequenceIds);
  assert.deepEqual(ids, [
    '2026-04-15-0002',
    '2026-04-15-0011',
    '2026-04-15-0020',
  ]);
});

test('compareSequenceIds: mixed 3-digit / 4-digit no longer collapses', () => {
  // The bug: lex sort puts "001" before "0011" before "002".
  // The fix: parse the trailing number and compare numerically.
  const ids = [
    '2026-04-15-001',
    '2026-04-15-0011',
    '2026-04-15-002',
    '2026-04-15-0020',
  ];
  ids.sort(compareSequenceIds);
  assert.deepEqual(ids, [
    '2026-04-15-001',
    '2026-04-15-002',
    '2026-04-15-0011',
    '2026-04-15-0020',
  ]);
});

test('compareSequenceIds: issue ids (i- prefix) sort the same way', () => {
  const ids = [
    'i-2026-04-15-001',
    'i-2026-04-15-0011',
    'i-2026-04-15-002',
    'i-2026-04-15-0020',
    'i-2026-04-15-009',
  ];
  ids.sort(compareSequenceIds);
  assert.deepEqual(ids, [
    'i-2026-04-15-001',
    'i-2026-04-15-002',
    'i-2026-04-15-009',
    'i-2026-04-15-0011',
    'i-2026-04-15-0020',
  ]);
});

test('compareSequenceIds: date prefix wins over sequence', () => {
  const ids = ['2026-04-15-0001', '2026-04-14-9999', '2026-04-16-0001'];
  ids.sort(compareSequenceIds);
  assert.deepEqual(ids, [
    '2026-04-14-9999',
    '2026-04-15-0001',
    '2026-04-16-0001',
  ]);
});

test('compareSequenceIds: unknown shapes fall back to localeCompare', () => {
  // Should not throw for malformed input. Order is deterministic
  // (lexicographic) so stable sorts stay stable.
  const ids = ['xyz', 'abc'];
  ids.sort(compareSequenceIds);
  assert.deepEqual(ids, ['abc', 'xyz']);
});

test('compareSequenceIds: comparator contract (anti-symmetric, reflexive)', () => {
  const a = '2026-04-15-002';
  const b = '2026-04-15-0011';
  assert.ok(compareSequenceIds(a, b) < 0);
  assert.ok(compareSequenceIds(b, a) > 0);
  assert.equal(compareSequenceIds(a, a), 0);
});
