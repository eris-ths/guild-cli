import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractReferences,
  gatherRequestText,
  gatherIssueText,
} from '../../src/interface/gate/chain.js';

test('extractReferences: empty string returns empty sets', () => {
  const r = extractReferences('');
  assert.deepEqual(r.requestIds, []);
  assert.deepEqual(r.issueIds, []);
});

test('extractReferences: returns empty on non-string input', () => {
  const r = extractReferences(undefined as unknown as string);
  assert.deepEqual(r.requestIds, []);
  assert.deepEqual(r.issueIds, []);
});

test('extractReferences: finds a lone request id', () => {
  const r = extractReferences('see 2026-04-14-003 for details');
  assert.deepEqual(r.requestIds, ['2026-04-14-003']);
  assert.deepEqual(r.issueIds, []);
});

test('extractReferences: finds a lone issue id', () => {
  const r = extractReferences('filed as i-2026-04-14-002');
  assert.deepEqual(r.requestIds, []);
  assert.deepEqual(r.issueIds, ['i-2026-04-14-002']);
});

test('extractReferences: distinguishes request and issue with same digits', () => {
  // `i-2026-04-14-003` should NOT also match as request `2026-04-14-003`
  const r = extractReferences('mentions i-2026-04-14-003 and 2026-04-14-003');
  assert.deepEqual(r.issueIds, ['i-2026-04-14-003']);
  assert.deepEqual(r.requestIds, ['2026-04-14-003']);
});

test('extractReferences: deduplicates repeated references (first-seen order)', () => {
  const r = extractReferences(
    'first: 2026-04-14-001, then 2026-04-14-002, then 2026-04-14-001 again',
  );
  assert.deepEqual(r.requestIds, ['2026-04-14-001', '2026-04-14-002']);
});

test('extractReferences: preserves first-seen order across types', () => {
  const r = extractReferences(
    'opened i-2026-04-14-005, promoted to 2026-04-14-007, note in i-2026-04-14-008',
  );
  assert.deepEqual(r.issueIds, [
    'i-2026-04-14-005',
    'i-2026-04-14-008',
  ]);
  assert.deepEqual(r.requestIds, ['2026-04-14-007']);
});

test('extractReferences: multiple references in one paragraph', () => {
  const text = `
    audit scope: 2026-04-14-001 through 2026-04-14-013
    findings: i-2026-04-14-004, i-2026-04-14-005, i-2026-04-14-006
  `;
  const r = extractReferences(text);
  assert.ok(r.requestIds.includes('2026-04-14-001'));
  assert.ok(r.requestIds.includes('2026-04-14-013'));
  assert.equal(r.issueIds.length, 3);
});

test('extractReferences: not confused by adjacent digits', () => {
  // A 4-digit year followed by another digit should not match.
  // (Our pattern is YYYY-MM-DD-NNN, so nothing should fire on a bare
  // date like "2026-04-14" without the sequence suffix.)
  const r = extractReferences('dated 2026-04-14 and logged');
  assert.deepEqual(r.requestIds, []);
  assert.deepEqual(r.issueIds, []);
});

test('extractReferences: accepts 4-digit sequences', () => {
  // As of 0.2.0, sequence ceiling is 9999/day and ids are 4 digits.
  const r = extractReferences('see 2026-04-14-0001');
  assert.deepEqual(r.requestIds, ['2026-04-14-0001']);
});

test('extractReferences: rejects 5+ digit sequences', () => {
  // 5 digits exceeds the domain pattern and should not be extracted.
  const r = extractReferences('bogus 2026-04-14-00001');
  assert.deepEqual(r.requestIds, []);
});

test('extractReferences: accepts legacy 3-digit sequences', () => {
  // Backward-compat: content roots from 0.1.x still produce 3-digit ids
  // and cross-references to them must keep working.
  const r = extractReferences('legacy 2026-04-14-001');
  assert.deepEqual(r.requestIds, ['2026-04-14-001']);
});

test('extractReferences: does not match ids embedded in word characters', () => {
  // "pre2026-04-14-001" should not match — the (?<!\w) at the start
  // refuses the match when a word character precedes.
  const r = extractReferences('pre2026-04-14-001 and normal 2026-04-14-002');
  assert.deepEqual(r.requestIds, ['2026-04-14-002']);
});

test('extractReferences: stable regex state across repeated calls', () => {
  // The global-flagged regex must reset its lastIndex between calls.
  // Calling twice with different inputs should give independent results.
  const a = extractReferences('2026-04-14-001');
  const b = extractReferences('2026-04-14-002');
  assert.deepEqual(a.requestIds, ['2026-04-14-001']);
  assert.deepEqual(b.requestIds, ['2026-04-14-002']);
});

test('gatherRequestText: concatenates all the narrative fields', () => {
  const text = gatherRequestText({
    action: 'Action',
    reason: 'Reason',
    completion_note: 'Note',
    deny_reason: 'Deny',
    failure_reason: 'Fail',
    reviews: [
      { comment: 'review one' },
      { comment: 'review two' },
    ],
  });
  for (const part of ['Action', 'Reason', 'Note', 'Deny', 'Fail', 'review one', 'review two']) {
    assert.ok(text.includes(part), `missing ${part}`);
  }
});

test('gatherRequestText: omits undefined optional fields cleanly', () => {
  const text = gatherRequestText({
    action: 'A',
    reason: 'B',
  });
  assert.equal(text, 'A\nB');
});

test('gatherIssueText: just returns the text field', () => {
  assert.equal(gatherIssueText({ text: 'issue body' }), 'issue body');
});

test('extractReferences: end-to-end via gatherRequestText', () => {
  // Simulates the real audit case: ids appear in completion notes
  // and review comments, not in the action/reason.
  const text = gatherRequestText({
    action: 'Post-session audit',
    reason: 'review changes',
    completion_note: 'filed i-2026-04-14-004 and i-2026-04-14-005',
    reviews: [
      { comment: 'elevated to 2026-04-14-008; also see i-2026-04-14-006' },
    ],
  });
  const refs = extractReferences(text);
  assert.deepEqual(refs.requestIds, ['2026-04-14-008']);
  assert.deepEqual(refs.issueIds, [
    'i-2026-04-14-004',
    'i-2026-04-14-005',
    'i-2026-04-14-006',
  ]);
});

// ── gatherIssueText: now includes notes so cross-refs added
//    post-hoc as annotations are still scannable. ──

test('gatherIssueText: without notes returns bare text (backward compat)', () => {
  const result = gatherIssueText({ text: 'original problem' });
  assert.equal(result, 'original problem');
});

test('gatherIssueText: with notes concatenates text + every note body', () => {
  const result = gatherIssueText({
    text: 'original problem',
    notes: [
      { text: 'see 2026-04-14-001' },
      { text: 'also i-2026-04-14-003' },
    ],
  });
  // Join order preserves note order; extractReferences reads the
  // full joined string.
  assert.match(result, /original problem/);
  assert.match(result, /2026-04-14-001/);
  assert.match(result, /i-2026-04-14-003/);
});

test('gatherIssueText: empty notes array is same as no notes', () => {
  const result = gatherIssueText({ text: 'x', notes: [] });
  assert.equal(result, 'x');
});
