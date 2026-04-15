import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReviewMarkers } from '../../src/interface/gate/index.js';

const WIDTH = 16;

test('formatReviewMarkers: empty reviews yields padded empty string', () => {
  const result = formatReviewMarkers([]);
  assert.equal(result.length, WIDTH);
  assert.equal(result.trim(), '');
});

test('formatReviewMarkers: undefined yields padded empty string', () => {
  const result = formatReviewMarkers(undefined);
  assert.equal(result.length, WIDTH);
});

test('formatReviewMarkers: non-array yields padded empty string', () => {
  const result = formatReviewMarkers('not an array');
  assert.equal(result.length, WIDTH);
});

test('formatReviewMarkers: single ok review renders as ✓<lens>', () => {
  const result = formatReviewMarkers([
    { lense: 'devil', verdict: 'ok' },
  ]);
  assert.ok(result.startsWith('✓devil'));
});

test('formatReviewMarkers: single concern review renders as !<lens>', () => {
  const result = formatReviewMarkers([
    { lense: 'devil', verdict: 'concern' },
  ]);
  assert.ok(result.startsWith('!devil'));
});

test('formatReviewMarkers: reject renders as x<lens>', () => {
  const result = formatReviewMarkers([
    { lense: 'devil', verdict: 'reject' },
  ]);
  assert.ok(result.startsWith('xdevil'));
});

test('formatReviewMarkers: unknown verdict renders as ?<lens> (defensive)', () => {
  const result = formatReviewMarkers([
    { lense: 'devil', verdict: 'weird' },
  ]);
  assert.ok(result.startsWith('?devil'));
});

test('formatReviewMarkers: multi-review output is space-separated', () => {
  const result = formatReviewMarkers([
    { lense: 'devil', verdict: 'concern' },
    { lense: 'layer', verdict: 'ok' },
  ]);
  assert.ok(result.startsWith('!devil ✓layer'));
});

test('formatReviewMarkers: long marker strings are not truncated', () => {
  // Three long-lens reviews exceed the 16-char padding width;
  // the function should not clip — padding is a floor, not a cap.
  const result = formatReviewMarkers([
    { lense: 'cognitive', verdict: 'concern' },
    { lense: 'cognitive', verdict: 'ok' },
    { lense: 'cognitive', verdict: 'ok' },
  ]);
  // "!cognitive ✓cognitive ✓cognitive" — 32 visible chars
  assert.ok(result.length >= 30);
  assert.ok(result.includes('!cognitive'));
  assert.ok(result.includes('✓cognitive'));
});

test('formatReviewMarkers: minimum width alignment across empty and non-empty', () => {
  const empty = formatReviewMarkers([]);
  const single = formatReviewMarkers([{ lense: 'devil', verdict: 'ok' }]);
  // Both should be at least WIDTH characters so list rows align.
  assert.ok(empty.length >= WIDTH);
  assert.ok(single.length >= WIDTH);
});
