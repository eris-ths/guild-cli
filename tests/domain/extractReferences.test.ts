// extractReferences — the shared lexical id-scanner over free text.
//
// Direct unit coverage for the three id kinds (request / issue / ctx).
// The ctx- prefix was added for `ctx chain`; these tests pin that it
// classifies correctly AND that adding it did not regress request/issue
// scanning (the boundary-after-hyphen trap that would mis-read a prefixed
// id as a bare request id).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractReferences } from '../../src/domain/shared/extractReferences.js';

test('classifies request, issue, and ctx ids into separate buckets', () => {
  const r = extractReferences('see 2026-04-14-014 and i-2026-04-14-004 and ctx-2026-05-09-001');
  assert.deepEqual(r.requestIds, ['2026-04-14-014']);
  assert.deepEqual(r.issueIds, ['i-2026-04-14-004']);
  assert.deepEqual(r.ctxIds, ['ctx-2026-05-09-001']);
});

test('a ctx-prefixed id is NOT also counted as a bare request id', () => {
  // The core digits of ctx-2026-05-09-001 are 2026-05-09-001; without the
  // prefix capture they would leak into requestIds (boundary-after-hyphen).
  const r = extractReferences('ctx-2026-05-09-001');
  assert.deepEqual(r.ctxIds, ['ctx-2026-05-09-001']);
  assert.deepEqual(r.requestIds, []);
  assert.deepEqual(r.issueIds, []);
});

test('issue ids still resolve unaffected by the ctx addition', () => {
  const r = extractReferences('i-2026-04-14-008 needs follow-up');
  assert.deepEqual(r.issueIds, ['i-2026-04-14-008']);
  assert.deepEqual(r.requestIds, []);
  assert.deepEqual(r.ctxIds, []);
});

test('dedupes within each kind, preserving first-seen order', () => {
  const r = extractReferences(
    'ctx-2026-05-09-001 ctx-2026-05-07-002 ctx-2026-05-09-001 ctx-2026-05-07-001',
  );
  assert.deepEqual(r.ctxIds, [
    'ctx-2026-05-09-001',
    'ctx-2026-05-07-002',
    'ctx-2026-05-07-001',
  ]);
});

test('accepts 3- and 4-digit suffixes, rejects 5+ digit runs', () => {
  const r = extractReferences('ctx-2026-05-09-001 and ctx-2026-05-09-0012 and ctx-2026-05-09-00123');
  // 3-digit and 4-digit suffixes are valid ids.
  assert.ok(r.ctxIds.includes('ctx-2026-05-09-001'));
  assert.ok(r.ctxIds.includes('ctx-2026-05-09-0012'));
  // a 5+ digit run is not matched as a ctx id (the (?!\d) guard).
  assert.ok(!r.ctxIds.some((id) => id.includes('00123')));
});

test('empty / non-string input yields all-empty buckets', () => {
  assert.deepEqual(extractReferences(''), { requestIds: [], issueIds: [], ctxIds: [] });
  // @ts-expect-error exercising the runtime guard for non-string input
  assert.deepEqual(extractReferences(null), { requestIds: [], issueIds: [], ctxIds: [] });
});
