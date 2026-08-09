// delta domain — deposit construction, delivery transition, id allocation.
//
// The invariants worth pinning here are the ones that protect a reader
// who arrives later: a delivered deposit must not silently become
// outstanding again, and a delivery must not be overwritable (which
// would erase where the deposit actually went).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Delta,
  nextDeltaId,
  parseDeltaDestination,
  parseDeltaId,
} from '../../../../src/passages/delta/domain/Delta.js';
import { DomainError } from '../../../../src/domain/shared/DomainError.js';

const AT = new Date('2026-08-09T00:00:00.000Z');

function deposit(
  overrides: Partial<{
    id: string;
    text: string;
    by: string;
    source: string;
    candidate: string;
  }> = {},
): Delta {
  return Delta.create({
    id: overrides.id ?? 'delta-2026-08-09-001',
    text: overrides.text ?? 'a conclusion nobody has filed yet',
    created_by: overrides.by ?? 'eris',
    source: overrides.source,
    candidate: overrides.candidate,
    now: () => AT,
  });
}

test('a fresh deposit is pending and carries only what was given', () => {
  const d = deposit();
  assert.equal(d.state, 'pending');
  assert.equal(d.created_at, '2026-08-09T00:00:00.000Z');
  // byte-stable YAML: optional fields are absent, not empty-valued
  const json = d.toJSON();
  assert.equal('source' in json, false);
  assert.equal('candidate' in json, false);
  assert.equal('delivered' in json, false);
});

test('optional prose that is only whitespace is dropped, not stored blank', () => {
  const d = deposit({ source: '   ', candidate: '\n' });
  assert.equal(d.source, undefined);
  assert.equal(d.candidate, undefined);
});

test('text and author are required', () => {
  assert.throws(() => deposit({ text: '   ' }), DomainError);
  assert.throws(() => deposit({ by: '' }), DomainError);
});

test('id must match delta-YYYY-MM-DD-NNN', () => {
  assert.equal(parseDeltaId('delta-2026-08-09-001'), 'delta-2026-08-09-001');
  assert.throws(() => parseDeltaId('ctx-2026-08-09-001'), DomainError);
  assert.throws(() => parseDeltaId('delta-2026-08-09-1'), DomainError);
  assert.throws(() => parseDeltaId(42), DomainError);
});

test('markDelivered returns a new record and leaves the receiver untouched', () => {
  const d = deposit();
  const done = d.markDelivered({ to: 'cultivate', by: 'eris', now: () => AT });
  assert.equal(d.state, 'pending', 'the original deposit must not mutate');
  assert.equal(done.state, 'delivered');
  assert.equal(done.delivered?.to, 'cultivate');
  assert.equal(done.delivered?.by, 'eris');
  assert.equal(done.delivered?.at, '2026-08-09T00:00:00.000Z');
  assert.equal(done.id, d.id, 'delivery keeps identity');
});

test('a second delivery is refused and the error names the first destination', () => {
  const done = deposit().markDelivered({ to: 'cultivate', by: 'eris', now: () => AT });
  assert.throws(
    () => done.markDelivered({ to: 'reflect', by: 'eris', now: () => AT }),
    (e: unknown) => e instanceof DomainError && /already delivered to 'cultivate'/.test(e.message),
  );
});

test('destination shape is enforced so `list --to` stays a usable filter', () => {
  assert.equal(parseDeltaDestination('  cultivate  '), 'cultivate');
  assert.throws(() => parseDeltaDestination(''), DomainError);
  assert.throws(() => parseDeltaDestination('a\nb'), DomainError);
  assert.throws(() => parseDeltaDestination('x'.repeat(65)), DomainError);
});

test('restore fails closed on a tampered delivery rather than reading as pending', () => {
  // The failure this guards: a delivered deposit whose `to` was blanked
  // out on disk must NOT hydrate as an outstanding deposit — that would
  // resurrect work that was already filed.
  assert.throws(
    () =>
      Delta.restore({
        id: 'delta-2026-08-09-001',
        created_at: '2026-08-09T00:00:00.000Z',
        created_by: 'eris',
        text: 'x',
        source: undefined,
        candidate: undefined,
        delivered: { to: '', at: '2026-08-09T00:00:00.000Z', by: 'eris', note: undefined },
      }),
    DomainError,
  );
});

test('a delivered record round-trips through toJSON/restore unchanged', () => {
  const done = deposit({ source: 'gate:2026-08-09-0005' }).markDelivered({
    to: 'cultivate',
    by: 'eris',
    note: 'landed in the command doc',
    now: () => AT,
  });
  const back = Delta.restore(done.toJSON() as never);
  assert.deepEqual(back.toJSON(), done.toJSON());
});

test('nextDeltaId fills the first free slot for the day', () => {
  assert.equal(nextDeltaId([], AT), 'delta-2026-08-09-001');
  assert.equal(
    nextDeltaId(['delta-2026-08-09-001', 'delta-2026-08-09-002'], AT),
    'delta-2026-08-09-003',
  );
  // a gap is reused; other days and other passages are ignored
  assert.equal(
    nextDeltaId(['delta-2026-08-09-002', 'delta-2026-08-08-001', 'ctx-2026-08-09-001'], AT),
    'delta-2026-08-09-001',
  );
});
