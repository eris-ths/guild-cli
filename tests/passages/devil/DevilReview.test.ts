// devil-review — DevilReview aggregate invariant tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DevilReview, parseReviewId, parseReviewState, parseTargetType } from '../../../src/passages/devil/domain/DevilReview.js';
import { Entry } from '../../../src/passages/devil/domain/Entry.js';

const ts = '2026-05-03T00:00:00.000Z';

const baseTarget = {
  type: 'pr' as const,
  ref: 'https://github.com/eris-ths/guild-cli/pull/125',
};

test('DevilReview.open creates an open review with empty arrays', () => {
  const r = DevilReview.open({
    id: 'rev-2026-05-03-001',
    target: baseTarget,
    opened_by: 'alice',
  });
  assert.equal(r.id, 'rev-2026-05-03-001');
  assert.equal(r.state, 'open');
  assert.equal(r.opened_by, 'alice');
  assert.equal(r.entries.length, 0);
  assert.equal(r.suspensions.length, 0);
  assert.equal(r.resumes.length, 0);
  assert.equal(r.re_run_history.length, 0);
  assert.equal(r.conclusion, undefined);
  assert.equal(r.isSuspended, false);
});

test('parseReviewId enforces rev-YYYY-MM-DD-NNN', () => {
  assert.equal(parseReviewId('rev-2026-05-03-001'), 'rev-2026-05-03-001');
  assert.equal(parseReviewId('rev-2026-05-03-1234'), 'rev-2026-05-03-1234');
  assert.throws(() => parseReviewId('2026-05-03-001'), /must match/);
  assert.throws(() => parseReviewId('rev-26-05-03-001'), /must match/);
});

test('parseTargetType rejects unknown types', () => {
  assert.equal(parseTargetType('pr'), 'pr');
  assert.equal(parseTargetType('file'), 'file');
  assert.equal(parseTargetType('function'), 'function');
  assert.equal(parseTargetType('commit'), 'commit');
  assert.throws(() => parseTargetType('feature'), /must be one of/);
});

test('parseReviewState rejects unknown states (no suspended in v0)', () => {
  assert.equal(parseReviewState('open'), 'open');
  assert.equal(parseReviewState('concluded'), 'concluded');
  assert.throws(() => parseReviewState('suspended'), /must be one of/);
});

test('DevilReview.open requires non-empty target.ref', () => {
  assert.throws(
    () =>
      DevilReview.open({
        id: 'rev-2026-05-03-001',
        target: { type: 'pr', ref: '' },
        opened_by: 'alice',
      }),
    /target.ref required/,
  );
});

test('DevilReview.restore: state=concluded must have conclusion', () => {
  assert.throws(
    () =>
      DevilReview.restore({
        id: 'rev-2026-05-03-001',
        target: baseTarget,
        state: 'concluded',
        opened_at: ts,
        opened_by: 'alice',
        entries: [],
        suspensions: [],
        resumes: [],
        re_run_history: [],
      }),
    /state='concluded' but no conclusion present/,
  );
});

test('DevilReview.restore: state=open must NOT have conclusion', () => {
  assert.throws(
    () =>
      DevilReview.restore({
        id: 'rev-2026-05-03-001',
        target: baseTarget,
        state: 'open',
        opened_at: ts,
        opened_by: 'alice',
        entries: [],
        suspensions: [],
        resumes: [],
        re_run_history: [],
        conclusion: {
          at: ts,
          by: 'alice',
          synthesis: 'whatever',
          unresolved: [],
        },
      }),
    /state='open' but conclusion present/,
  );
});

test('DevilReview.restore validates entries and rejects duplicate ids', () => {
  const sample = {
    id: 'e-001',
    at: ts,
    by: 'alice',
    persona: 'red-team',
    lense: 'injection',
    kind: 'finding',
    text: 'sample',
    severity: 'high',
    severity_rationale: 'rationale',
    status: 'open',
  };
  assert.throws(
    () =>
      DevilReview.restore({
        id: 'rev-2026-05-03-001',
        target: baseTarget,
        state: 'open',
        opened_at: ts,
        opened_by: 'alice',
        entries: [sample, sample],
        suspensions: [],
        resumes: [],
        re_run_history: [],
      } as unknown as Parameters<typeof DevilReview.restore>[0]),
    /duplicate entry id: e-001/,
  );
});

test('DevilReview.restore rejects resumes.length > suspensions.length', () => {
  assert.throws(
    () =>
      DevilReview.restore({
        id: 'rev-2026-05-03-001',
        target: baseTarget,
        state: 'open',
        opened_at: ts,
        opened_by: 'alice',
        entries: [],
        suspensions: [],
        resumes: [{ at: ts, by: 'alice' }],
        re_run_history: [],
      } as Parameters<typeof DevilReview.restore>[0]),
    /resumes \(1\) cannot exceed suspensions \(0\)/,
  );
});

test('DevilReview.isSuspended is true when one extra suspension over resumes', () => {
  const r = DevilReview.restore({
    id: 'rev-2026-05-03-001',
    target: baseTarget,
    state: 'open',
    opened_at: ts,
    opened_by: 'alice',
    entries: [],
    suspensions: [
      { at: ts, by: 'alice', cliff: 'c', invitation: 'i' },
    ],
    resumes: [],
    re_run_history: [],
  } as Parameters<typeof DevilReview.restore>[0]);
  assert.equal(r.isSuspended, true);
});

test('DevilReview.findEntry returns entry when present, null when absent', () => {
  const r = DevilReview.restore({
    id: 'rev-2026-05-03-001',
    target: baseTarget,
    state: 'open',
    opened_at: ts,
    opened_by: 'alice',
    entries: [
      {
        id: 'e-001',
        at: ts,
        by: 'alice',
        persona: 'red-team',
        lense: 'injection',
        kind: 'finding',
        text: 'sample',
        severity: 'high',
        severity_rationale: 'rationale',
        status: 'open',
      },
    ],
    suspensions: [],
    resumes: [],
    re_run_history: [],
  } as unknown as Parameters<typeof DevilReview.restore>[0]);
  assert.ok(r.findEntry('e-001'));
  assert.equal(r.findEntry('e-002'), null);
});

test('DevilReview.toJSON omits empty arrays and absent conclusion', () => {
  const r = DevilReview.open({
    id: 'rev-2026-05-03-001',
    target: baseTarget,
    opened_by: 'alice',
  });
  const json = r.toJSON();
  assert.equal('suspensions' in json, false);
  assert.equal('resumes' in json, false);
  assert.equal('re_run_history' in json, false);
  assert.equal('conclusion' in json, false);
  assert.deepEqual(json['entries'], []);
});

test('DevilReview.toJSON includes conclusion when concluded', () => {
  const r = DevilReview.restore({
    id: 'rev-2026-05-03-001',
    target: baseTarget,
    state: 'concluded',
    opened_at: ts,
    opened_by: 'alice',
    entries: [],
    suspensions: [],
    resumes: [],
    re_run_history: [],
    conclusion: {
      at: ts,
      by: 'alice',
      synthesis: 'tested all lenses, nothing actionable beyond the open assumption',
      unresolved: ['e-003'],
    },
  } as Parameters<typeof DevilReview.restore>[0]);
  const json = r.toJSON();
  assert.ok(json['conclusion']);
  const c = json['conclusion'] as Record<string, unknown>;
  assert.equal(c['synthesis'], 'tested all lenses, nothing actionable beyond the open assumption');
  assert.deepEqual(c['unresolved'], ['e-003']);
});
