import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDelta } from '../../src/interface/gate/voices.js';

test('formatDelta: sub-minute deltas in seconds', () => {
  assert.equal(
    formatDelta('2026-04-14T10:59:05.842Z', '2026-04-14T10:59:11.559Z'),
    '+5s',
  );
  assert.equal(
    formatDelta('2026-04-14T10:00:00.000Z', '2026-04-14T10:00:45.000Z'),
    '+45s',
  );
});

test('formatDelta: sub-hour deltas in minutes', () => {
  assert.equal(
    formatDelta('2026-04-14T10:00:00.000Z', '2026-04-14T10:03:30.000Z'),
    '+3m',
  );
  assert.equal(
    formatDelta('2026-04-14T14:21:12.613Z', '2026-04-14T14:21:57.535Z'),
    '+44s',
  );
});

test('formatDelta: sub-day deltas in hours + minutes', () => {
  assert.equal(
    formatDelta('2026-04-14T10:00:00.000Z', '2026-04-14T11:19:00.000Z'),
    '+1h19m',
  );
  assert.equal(
    formatDelta('2026-04-14T10:00:00.000Z', '2026-04-14T13:00:00.000Z'),
    '+3h',
  );
});

test('formatDelta: multi-day deltas in days + hours', () => {
  assert.equal(
    formatDelta('2026-04-14T10:00:00.000Z', '2026-04-16T14:30:00.000Z'),
    '+2d4h',
  );
  assert.equal(
    formatDelta('2026-04-14T10:00:00.000Z', '2026-04-17T10:00:00.000Z'),
    '+3d',
  );
});

test('formatDelta: same timestamp yields +0s', () => {
  const ts = '2026-04-14T10:00:00.000Z';
  assert.equal(formatDelta(ts, ts), '+0s');
});

test('formatDelta: negative delta returns empty string (boundary defense)', () => {
  assert.equal(
    formatDelta('2026-04-14T11:00:00.000Z', '2026-04-14T10:00:00.000Z'),
    '',
  );
});

test('formatDelta: unparseable input returns empty string', () => {
  assert.equal(formatDelta('not-a-date', '2026-04-14T10:00:00.000Z'), '');
  assert.equal(formatDelta('2026-04-14T10:00:00.000Z', 'garbage'), '');
  assert.equal(formatDelta('', ''), '');
});
