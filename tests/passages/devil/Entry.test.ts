// devil-review — Entry domain invariant tests.
//
// Pin issue #126's per-kind schema: which fields are required when,
// which are forbidden, and which conditional fields propagate.
// Substrate-level invariants — a tampered file or a buggy verb
// must surface a structured DomainError, not corrupt state.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Entry } from '../../../src/passages/devil/domain/Entry.js';

const ts = '2026-05-03T00:00:00.000Z';

const baseFinding = {
  id: 'e-001',
  at: ts,
  by: 'alice',
  persona: 'red-team',
  lense: 'injection',
  kind: 'finding' as const,
  text: 'Concatenated user input in raw SQL',
  severity: 'high' as const,
  severity_rationale: 'Public endpoint, no preceding sanitization layer',
  status: 'open' as const,
};

test('finding entry: severity / severity_rationale / status all required', () => {
  assert.throws(
    () =>
      Entry.create({
        ...baseFinding,
        severity: undefined as unknown as 'high',
      }),
    /requires severity/,
  );
  assert.throws(
    () =>
      Entry.create({
        ...baseFinding,
        severity_rationale: undefined as unknown as string,
      }),
    /requires severity_rationale/,
  );
  assert.throws(
    () =>
      Entry.create({
        ...baseFinding,
        status: undefined as unknown as 'open',
      }),
    /requires status/,
  );
});

test('finding entry: severity_rationale must be non-empty (not just whitespace)', () => {
  assert.throws(
    () => Entry.create({ ...baseFinding, severity_rationale: '   ' }),
    /requires severity_rationale/,
  );
});

test('finding entry round-trips through restore', () => {
  const e = Entry.create(baseFinding);
  const restored = Entry.restore(e.toJSON());
  assert.equal(restored.id, e.id);
  assert.equal(restored.kind, e.kind);
  assert.equal(restored.severity, e.severity);
  assert.equal(restored.severity_rationale, e.severity_rationale);
  assert.equal(restored.status, e.status);
});

test('finding+dismissed: dismissal_reason required, dismissal_note optional', () => {
  // dismissal_reason absent → throw
  assert.throws(
    () =>
      Entry.create({
        ...baseFinding,
        status: 'dismissed',
      }),
    /status='dismissed' requires dismissal_reason/,
  );
  // valid dismissal
  const e = Entry.create({
    ...baseFinding,
    status: 'dismissed',
    dismissal_reason: 'false-positive',
    dismissal_note: 'tracer was matched against a stub class, not the real sink',
  });
  assert.equal(e.status, 'dismissed');
  assert.equal(e.dismissal_reason, 'false-positive');
  assert.equal(
    e.dismissal_note,
    'tracer was matched against a stub class, not the real sink',
  );
});

test('finding+open: dismissal_reason / dismissal_note must NOT be present', () => {
  assert.throws(
    () =>
      Entry.create({
        ...baseFinding,
        dismissal_reason: 'false-positive',
      }),
    /dismissal_reason only valid when status='dismissed'/,
  );
  assert.throws(
    () => Entry.create({ ...baseFinding, dismissal_note: 'why' }),
    /dismissal_note only valid when status='dismissed'/,
  );
});

test('finding+resolved: resolved_by_commit optional, others forbidden', () => {
  const e = Entry.create({
    ...baseFinding,
    status: 'resolved',
    resolved_by_commit: 'abc123',
  });
  assert.equal(e.status, 'resolved');
  assert.equal(e.resolved_by_commit, 'abc123');
  // also valid without resolved_by_commit
  const e2 = Entry.create({ ...baseFinding, status: 'resolved' });
  assert.equal(e2.status, 'resolved');
  assert.equal(e2.resolved_by_commit, undefined);
});

test('non-finding kinds reject finding-only fields', () => {
  for (const kind of ['assumption', 'resistance', 'skip', 'synthesis'] as const) {
    assert.throws(
      () =>
        Entry.create({
          id: 'e-001',
          at: ts,
          by: 'alice',
          persona: 'mirror',
          lense: 'composition',
          kind,
          text: 'something',
          severity: 'low',
        }),
      /severity only valid for kind='finding'/,
    );
    assert.throws(
      () =>
        Entry.create({
          id: 'e-001',
          at: ts,
          by: 'alice',
          persona: 'mirror',
          lense: 'composition',
          kind,
          text: 'something',
          status: 'open',
        }),
      /status only valid for kind='finding'/,
    );
  }
});

test('gate entry requires non-empty stages[]', () => {
  assert.throws(
    () =>
      Entry.create({
        id: 'e-001',
        at: ts,
        by: 'alice',
        persona: 'red-team',
        lense: 'supply-chain',
        kind: 'gate',
        text: 'SCG 8-stage gate result',
      }),
    /requires non-empty stages/,
  );
  assert.throws(
    () =>
      Entry.create({
        id: 'e-001',
        at: ts,
        by: 'alice',
        persona: 'red-team',
        lense: 'supply-chain',
        kind: 'gate',
        text: 'SCG 8-stage gate result',
        stages: [],
      }),
    /requires non-empty stages/,
  );
});

test('gate entry: each stage must have name + verdict + reasoning (all non-empty)', () => {
  const validStages = [
    { name: 'L1-audit', verdict: 'clean', reasoning: 'no advisories on direct deps' },
    { name: 'L2-osv', verdict: 'clean', reasoning: 'no transitive advisories matched' },
  ];
  const e = Entry.create({
    id: 'e-001',
    at: ts,
    by: 'alice',
    persona: 'red-team',
    lense: 'supply-chain',
    kind: 'gate',
    text: 'SCG result',
    stages: validStages,
  });
  assert.equal(e.stages?.length, 2);
  assert.equal(e.stages?.[0]?.name, 'L1-audit');

  // missing reasoning
  assert.throws(
    () =>
      Entry.create({
        id: 'e-002',
        at: ts,
        by: 'alice',
        persona: 'red-team',
        lense: 'supply-chain',
        kind: 'gate',
        text: 'SCG result',
        stages: [{ name: 'L1', verdict: 'pass', reasoning: '' }],
      }),
    /reasoning required/,
  );
});

test('non-gate kinds reject stages[]', () => {
  assert.throws(
    () =>
      Entry.create({
        ...baseFinding,
        stages: [{ name: 'x', verdict: 'y', reasoning: 'z' }],
      }),
    /stages only valid for kind='gate'/,
  );
});

test('Entry.create rejects malformed entry id', () => {
  assert.throws(
    () => Entry.create({ ...baseFinding, id: 'bad' }),
    /entry id must match e-NNN/,
  );
  assert.throws(
    () => Entry.create({ ...baseFinding, id: '001' }),
    /entry id must match e-NNN/,
  );
});

test('Entry.create rejects unknown lense / persona via parser', () => {
  // parser-level rejection (uppercase, format)
  assert.throws(
    () => Entry.create({ ...baseFinding, lense: 'BadLense' }),
    /lense name/,
  );
  assert.throws(
    () => Entry.create({ ...baseFinding, persona: 'BadPersona' }),
    /persona name/,
  );
});

test('addresses field is validated as an entry id when present', () => {
  const e = Entry.create({ ...baseFinding, addresses: 'e-002' });
  assert.equal(e.addresses, 'e-002');
  assert.throws(
    () => Entry.create({ ...baseFinding, addresses: 'not-an-id' }),
    /entry id must match e-NNN/,
  );
});

test('skip entry: just text, no other fields', () => {
  const e = Entry.create({
    id: 'e-001',
    at: ts,
    by: 'alice',
    persona: 'red-team',
    lense: 'memory-safety',
    kind: 'skip',
    text: 'irrelevant: project is pure TypeScript, no native code or unsafe primitives',
  });
  assert.equal(e.kind, 'skip');
  assert.equal(e.severity, undefined);
  assert.equal(e.status, undefined);
  assert.equal(e.stages, undefined);
});
