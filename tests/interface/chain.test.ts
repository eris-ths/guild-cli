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

// ── bidirectional mention dedup ──
// End-to-end: when two requests reference each other, chain renders
// the other one once (under "referenced") with a ↔ marker, not twice
// (once under "referenced" and once under "referenced by").

import { spawnSync as _spawnSync } from 'node:child_process';
import {
  mkdtempSync as _mkdtempSync,
  writeFileSync as _writeFileSync,
  rmSync as _rmSync,
  mkdirSync as _mkdirSync,
} from 'node:fs';
import { tmpdir as _tmpdir } from 'node:os';
import { join as _join, resolve as _resolve, dirname as _dirname } from 'node:path';
import { fileURLToPath as _fileURLToPath } from 'node:url';

const _here = _dirname(_fileURLToPath(import.meta.url));
const _GATE = _resolve(_here, '../../../bin/gate.mjs');

function _bootstrap(): { root: string; cleanup: () => void } {
  const root = _mkdtempSync(_join(_tmpdir(), 'guild-chain-bidir-'));
  _writeFileSync(
    _join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  for (const d of ['members', 'requests', 'issues', 'inbox']) {
    _mkdirSync(_join(root, d));
  }
  _writeFileSync(
    _join(root, 'members', 'mia.yaml'),
    'name: mia\ncategory: professional\nactive: true\n',
  );
  return { root, cleanup: () => _rmSync(root, { recursive: true, force: true }) };
}

function _runGate(cwd: string, args: string[]): { stdout: string; status: number } {
  const r = _spawnSync(process.execPath, [_GATE, ...args], {
    cwd,
    env: { ...process.env, GUILD_ACTOR: 'mia' },
    encoding: 'utf8',
  });
  return { stdout: r.stdout, status: r.status ?? -1 };
}

// IDs are allocated from today's UTC date by gate itself, so the tests
// derive their prefix at run time rather than baking in the authoring
// day's date (which made these tests pass only on 2026-04-18).
const _today = () => new Date().toISOString().slice(0, 10);
const _id = (n: number) => `${_today()}-${String(n).padStart(4, '0')}`;

test('chain: bidirectional text-mention renders once with ↔ marker, not twice', () => {
  const { root, cleanup } = _bootstrap();
  try {
    const r1 = _id(1);
    const r2 = _id(2);
    // r1 and r2 mention each other in their text.
    _runGate(root, ['request', '--from', 'mia', '--action', 'v1', '--reason', 'r']);
    _runGate(root, ['deny', r1, '--by', 'mia',
      '--reason', `refiled as ${r2}`]);
    _runGate(root, ['request', '--from', 'mia', '--action',
      `v2 from ${r1}`, '--reason', 'response to critique']);
    const { stdout } = _runGate(root, ['chain', r2]);
    // Count only tree-entry lines (those starting with tree glyphs);
    // the root header ALSO mentions v1 in its action text (because
    // v2's action was "v2 from <r1>"), and that's not a dedup concern.
    const entryLines = stdout
      .split('\n')
      .filter((l) => /^[│├└ ]/.test(l) && l.includes(r1));
    assert.equal(
      entryLines.length,
      1,
      `expected 1 tree entry for v1, got ${entryLines.length}:\n${stdout}`,
    );
    assert.match(entryLines[0]!, new RegExp(`↔ ${r1}`));
    // "referenced by requests" section should NOT appear (dedupped
    // into the forward section).
    assert.equal(/referenced by requests/.test(stdout), false);
  } finally {
    cleanup();
  }
});

test('chain: one-way reference shows no ↔ marker', () => {
  const { root, cleanup } = _bootstrap();
  try {
    const r1 = _id(1);
    const r2 = _id(2);
    _runGate(root, ['request', '--from', 'mia', '--action', 'target', '--reason', 'r']);
    // Only r2 mentions r1 (not vice versa).
    _runGate(root, ['request', '--from', 'mia', '--action',
      `refers to ${r1}`, '--reason', 'one-way']);
    const { stdout: forwardOut } = _runGate(root, ['chain', r2]);
    // r2's chain: r1 is referenced (not bidirectional).
    assert.match(forwardOut, /referenced requests/);
    assert.equal(/↔/.test(forwardOut), false);

    const { stdout: inboundOut } = _runGate(root, ['chain', r1]);
    // r1's chain: r2 mentions it (inbound, not bidirectional).
    assert.match(inboundOut, /referenced by requests/);
    assert.equal(/↔/.test(inboundOut), false);
  } finally {
    cleanup();
  }
});
