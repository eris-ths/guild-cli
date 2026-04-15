import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectUtterances,
  RequestJSON,
} from '../../src/interface/gate/voices.js';

// Synthetic request corpus. These are intentionally not Request
// domain objects — the point of collectUtterances is that it works
// on structural JSON shapes, so tests don't need domain fixtures.
const corpus: RequestJSON[] = [
  {
    id: '2026-04-14-001',
    from: 'kiri',
    action: 'Feature A',
    reason: 'first task',
    created_at: '2026-04-14T10:00:00.000Z',
    completion_note: 'shipped',
    reviews: [
      {
        by: 'noir',
        lense: 'devil',
        verdict: 'concern',
        comment: 'I/O racy',
        at: '2026-04-14T11:00:00.000Z',
      },
      {
        by: 'rin',
        lense: 'layer',
        verdict: 'ok',
        comment: 'layers fine',
        at: '2026-04-14T11:05:00.000Z',
      },
    ],
  },
  {
    id: '2026-04-14-002',
    from: 'noir',
    action: 'Feature B',
    reason: 'second task',
    created_at: '2026-04-14T12:00:00.000Z',
    deny_reason: 'scope creep',
    reviews: [],
  },
  {
    id: '2026-04-14-003',
    from: 'kiri',
    action: 'Feature C',
    reason: 'third task',
    created_at: '2026-04-14T13:00:00.000Z',
    failure_reason: 'upstream outage',
    reviews: [
      {
        by: 'noir',
        lense: 'user',
        verdict: 'ok',
        comment: 'users fine',
        at: '2026-04-14T14:00:00.000Z',
      },
    ],
  },
];

test('collectUtterances returns all authored + review utterances for an actor', () => {
  const result = collectUtterances(corpus, { name: 'kiri' });
  // kiri authored req 001 and 003, reviewed nothing.
  assert.equal(result.length, 2);
  assert.equal(result[0]?.kind, 'authored');
  assert.equal(result[0]?.requestId, '2026-04-14-001');
  assert.equal(result[1]?.kind, 'authored');
  assert.equal(result[1]?.requestId, '2026-04-14-003');
});

test('collectUtterances returns mixed authored + review for an actor who wears both hats', () => {
  const result = collectUtterances(corpus, { name: 'noir' });
  // noir authored req 002, reviewed req 001 (devil) and req 003 (user).
  // Sorted by timestamp: devil@11:00, noir-authored@12:00, user@14:00.
  assert.equal(result.length, 3);
  assert.equal(result[0]?.kind, 'review');
  assert.equal(result[0]?.requestId, '2026-04-14-001');
  assert.equal(result[1]?.kind, 'authored');
  assert.equal(result[1]?.requestId, '2026-04-14-002');
  assert.equal(result[2]?.kind, 'review');
  assert.equal(result[2]?.requestId, '2026-04-14-003');
});

test('collectUtterances: --lense filter excludes authored and non-matching reviews', () => {
  const result = collectUtterances(corpus, { name: 'noir', lense: 'devil' });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.kind, 'review');
  const r = result[0];
  if (r?.kind === 'review') {
    assert.equal(r.lense, 'devil');
    assert.equal(r.verdict, 'concern');
  }
});

test('collectUtterances: --verdict filter is independent of lens filter', () => {
  const result = collectUtterances(corpus, { name: 'noir', verdict: 'ok' });
  // noir has two ok reviews (layer on 001? no, rin; user on 003 — noir).
  // Only user/ok on 003.
  assert.equal(result.length, 1);
  if (result[0]?.kind === 'review') {
    assert.equal(result[0].lense, 'user');
    assert.equal(result[0].verdict, 'ok');
  }
});

test('collectUtterances: unknown name returns empty array', () => {
  assert.deepEqual(collectUtterances(corpus, { name: 'ghost' }), []);
});

test('collectUtterances: name matching is case-insensitive', () => {
  const lower = collectUtterances(corpus, { name: 'noir' });
  const upper = collectUtterances(corpus, { name: 'NOIR' });
  const mixed = collectUtterances(corpus, { name: 'NoIr' });
  assert.equal(lower.length, 3);
  assert.deepEqual(lower, upper);
  assert.deepEqual(lower, mixed);
});

test('collectUtterances: sorts results chronologically ascending', () => {
  const result = collectUtterances(corpus, { name: 'noir' });
  for (let i = 1; i < result.length; i++) {
    const prev = result[i - 1]?.at ?? '';
    const curr = result[i]?.at ?? '';
    assert.ok(prev.localeCompare(curr) <= 0, `${prev} should be ≤ ${curr}`);
  }
});

test('collectUtterances: authored utterance captures deny_reason when present', () => {
  const result = collectUtterances(corpus, { name: 'noir' });
  const authored = result.find(
    (u) => u.kind === 'authored' && u.requestId === '2026-04-14-002',
  );
  assert.ok(authored, 'expected noir-authored denied request');
  if (authored?.kind === 'authored') {
    assert.equal(authored.denyReason, 'scope creep');
    assert.equal(authored.completionNote, undefined);
    assert.equal(authored.failureReason, undefined);
  }
});

test('collectUtterances: authored utterance captures failure_reason when present', () => {
  const result = collectUtterances(corpus, { name: 'kiri' });
  const failed = result.find(
    (u) => u.kind === 'authored' && u.requestId === '2026-04-14-003',
  );
  assert.ok(failed, 'expected kiri-authored failed request');
  if (failed?.kind === 'authored') {
    assert.equal(failed.failureReason, 'upstream outage');
    assert.equal(failed.completionNote, undefined);
    assert.equal(failed.denyReason, undefined);
  }
});

test('collectUtterances: authored utterance captures completion_note when present', () => {
  const result = collectUtterances(corpus, { name: 'kiri' });
  const completed = result.find(
    (u) => u.kind === 'authored' && u.requestId === '2026-04-14-001',
  );
  assert.ok(completed, 'expected kiri-authored completed request');
  if (completed?.kind === 'authored') {
    assert.equal(completed.completionNote, 'shipped');
    assert.equal(completed.denyReason, undefined);
    assert.equal(completed.failureReason, undefined);
  }
});

test('collectUtterances: lens+verdict filters combine via AND', () => {
  const result = collectUtterances(corpus, {
    name: 'noir',
    lense: 'devil',
    verdict: 'ok',
  });
  // noir's devil review is concern, not ok, so nothing matches.
  assert.deepEqual(result, []);
});

test('collectUtterances: empty reviews array is handled gracefully', () => {
  const onlyAuthored: RequestJSON[] = [
    {
      id: '2026-04-15-001',
      from: 'kiri',
      action: 'x',
      reason: 'y',
      created_at: '2026-04-15T00:00:00.000Z',
      reviews: [],
    },
  ];
  const result = collectUtterances(onlyAuthored, { name: 'kiri' });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.kind, 'authored');
});

test('collectUtterances: missing reviews field (undefined) is handled gracefully', () => {
  const noReviews: RequestJSON[] = [
    {
      id: '2026-04-15-002',
      from: 'kiri',
      action: 'x',
      reason: 'y',
      created_at: '2026-04-15T00:00:00.000Z',
    },
  ];
  const result = collectUtterances(noReviews, { name: 'kiri' });
  assert.equal(result.length, 1);
});
