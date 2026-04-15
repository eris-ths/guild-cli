import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeRequestsById } from '../../src/infrastructure/persistence/YamlRequestRepository.js';
import { Request } from '../../src/domain/request/Request.js';
import { RequestId } from '../../src/domain/request/RequestId.js';
import { MemberName } from '../../src/domain/member/MemberName.js';

/**
 * Build a synthetic Request via Request.restore with an explicit
 * status_log so the dedup tie-break logic can be tested without
 * going through the full lifecycle. The restore path is the same
 * one used when hydrating YAML, so the Request instances are
 * identical to what the repo would produce from disk.
 */
function make(
  id: string,
  state: 'pending' | 'approved' | 'executing' | 'completed' | 'failed' | 'denied',
  logLength: number,
): Request {
  const statusLog = [];
  for (let i = 0; i < logLength; i++) {
    statusLog.push({
      state,
      by: 'kiri',
      at: `2026-04-15T00:00:${String(i).padStart(2, '0')}.000Z`,
    });
  }
  return Request.restore({
    id: RequestId.of(id),
    from: MemberName.of('kiri'),
    action: 'test',
    reason: 'test',
    state,
    createdAt: '2026-04-15T00:00:00.000Z',
    reviews: [],
    statusLog,
  });
}

test('dedupeRequestsById: empty input', () => {
  assert.deepEqual(dedupeRequestsById([]), []);
});

test('dedupeRequestsById: unique ids pass through unchanged', () => {
  const a = make('2026-04-15-001', 'pending', 1);
  const b = make('2026-04-15-002', 'completed', 4);
  const result = dedupeRequestsById([a, b]);
  assert.equal(result.length, 2);
});

test('dedupeRequestsById: more status_log entries wins tie', () => {
  // Same id appearing under two state directories — pick the one
  // with more status_log entries (strictly newer).
  const stale = make('2026-04-15-001', 'pending', 1);
  const fresh = make('2026-04-15-001', 'approved', 2);
  const result = dedupeRequestsById([stale, fresh]);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.state, 'approved');
  assert.equal(result[0]?.statusLog.length, 2);
});

test('dedupeRequestsById: order of input does not matter for tie-break', () => {
  const stale = make('2026-04-15-001', 'pending', 1);
  const fresh = make('2026-04-15-001', 'completed', 4);
  const a = dedupeRequestsById([stale, fresh]);
  const b = dedupeRequestsById([fresh, stale]);
  assert.equal(a[0]?.state, 'completed');
  assert.equal(b[0]?.state, 'completed');
});

test('dedupeRequestsById: on equal log length, later REQUEST_STATES wins', () => {
  // Both representations have 1 status_log entry (shouldn't really
  // happen in practice since status_log grows, but defensive).
  // pending < approved in REQUEST_STATES, so approved wins.
  const a = make('2026-04-15-001', 'pending', 1);
  const b = make('2026-04-15-001', 'approved', 1);
  const result = dedupeRequestsById([a, b]);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.state, 'approved');
});

test('dedupeRequestsById: preserves unique entries alongside duplicates', () => {
  const a1 = make('2026-04-15-001', 'pending', 1);
  const a2 = make('2026-04-15-001', 'approved', 2);
  const b = make('2026-04-15-002', 'completed', 4);
  const result = dedupeRequestsById([a1, b, a2]);
  assert.equal(result.length, 2);
  const ids = result.map((r) => r.id.value).sort();
  assert.deepEqual(ids, ['2026-04-15-001', '2026-04-15-002']);
  const a = result.find((r) => r.id.value === '2026-04-15-001');
  assert.equal(a?.state, 'approved');
});

test('dedupeRequestsById: three-way collision picks the longest log', () => {
  const a1 = make('2026-04-15-001', 'pending', 1);
  const a2 = make('2026-04-15-001', 'approved', 2);
  const a3 = make('2026-04-15-001', 'completed', 4);
  const result = dedupeRequestsById([a1, a2, a3]);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.state, 'completed');
  assert.equal(result[0]?.statusLog.length, 4);
});

test('dedupeRequestsById: divergent terminal states (failed/denied) are dedupe-stable', () => {
  // If two reads see completed (4 entries) and failed (4 entries)
  // for the same id, that's logically impossible in practice, but
  // the dedup should still return one — whichever one REQUEST_STATES
  // ranks later. The actual semantics of which terminal is "right"
  // is a domain question we can't answer here; what matters is that
  // dedupeRequestsById is deterministic.
  const done = make('2026-04-15-001', 'completed', 4);
  const fail = make('2026-04-15-001', 'failed', 4);
  const a = dedupeRequestsById([done, fail]);
  const b = dedupeRequestsById([fail, done]);
  // Both orderings must agree.
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.equal(a[0]?.state, b[0]?.state);
});
