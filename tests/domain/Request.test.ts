import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Request } from '../../src/domain/request/Request.js';
import { RequestId } from '../../src/domain/request/RequestId.js';
import {
  canTransition,
  assertTransition,
} from '../../src/domain/request/RequestState.js';
import { Review } from '../../src/domain/request/Review.js';
import { MemberName } from '../../src/domain/member/MemberName.js';
import { DomainError } from '../../src/domain/shared/DomainError.js';

const d = new Date('2026-04-14T00:00:00Z');

function mkReq(): Request {
  return Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'do stuff',
    reason: 'because',
  });
}

test('RequestId generate produces 4-digit format', () => {
  const id = RequestId.generate(d, 42);
  assert.equal(id.value, '2026-04-14-0042');
});

test('RequestId generate zero-pads small sequences', () => {
  const id = RequestId.generate(d, 1);
  assert.equal(id.value, '2026-04-14-0001');
});

test('RequestId generate accepts up to 9999', () => {
  const id = RequestId.generate(d, 9999);
  assert.equal(id.value, '2026-04-14-9999');
  assert.throws(() => RequestId.generate(d, 10000), DomainError);
});

test('RequestId of validates pattern', () => {
  assert.throws(() => RequestId.of('2026-4-14-001'), DomainError);
  assert.throws(() => RequestId.of('bad'), DomainError);
  // Legacy 3-digit still accepted for backward compatibility.
  assert.doesNotThrow(() => RequestId.of('2026-04-14-001'));
  // New 4-digit form.
  assert.doesNotThrow(() => RequestId.of('2026-04-14-0001'));
  // 2 digits rejected.
  assert.throws(() => RequestId.of('2026-04-14-01'), DomainError);
  // 5 digits rejected.
  assert.throws(() => RequestId.of('2026-04-14-00001'), DomainError);
});

test('Request starts in pending', () => {
  const r = mkReq();
  assert.equal(r.state, 'pending');
  assert.equal(r.statusLog.length, 1);
});

test('Request approve transitions to approved', () => {
  const r = mkReq();
  r.approve(MemberName.of('eris'));
  assert.equal(r.state, 'approved');
});

test('Request cannot approve twice', () => {
  const r = mkReq();
  r.approve(MemberName.of('eris'));
  assert.throws(() => r.approve(MemberName.of('eris')), DomainError);
});

test('Request deny from pending works, but not from approved', () => {
  const r1 = mkReq();
  r1.deny(MemberName.of('eris'), 'nope');
  assert.equal(r1.state, 'denied');

  const r2 = mkReq();
  r2.approve(MemberName.of('eris'));
  assert.throws(() => r2.deny(MemberName.of('eris'), 'late'), DomainError);
});

test('Request full happy path', () => {
  const r = mkReq();
  r.approve(MemberName.of('eris'));
  r.execute(MemberName.of('bob'));
  r.complete(MemberName.of('bob'), 'done');
  assert.equal(r.state, 'completed');
  assert.equal(r.statusLog.length, 4);
});

test('Request fail from executing', () => {
  const r = mkReq();
  r.approve(MemberName.of('eris'));
  r.execute(MemberName.of('bob'));
  r.fail(MemberName.of('bob'), 'broken');
  assert.equal(r.state, 'failed');
});

test('Request addReview appends', () => {
  const r = mkReq();
  r.addReview(
    Review.create({
      by: 'eris',
      lense: 'devil',
      verdict: 'ok',
      comment: 'lgtm',
    }),
  );
  assert.equal(r.reviews.length, 1);
});

test('canTransition rules', () => {
  assert.equal(canTransition('pending', 'approved'), true);
  assert.equal(canTransition('pending', 'completed'), false);
  assert.equal(canTransition('completed', 'failed'), false);
  assert.throws(() => assertTransition('completed', 'failed'), DomainError);
});

test('Request rejects invalid executor name', () => {
  assert.throws(
    () =>
      Request.create({
        id: RequestId.generate(d, 1),
        from: 'alice',
        action: 'x',
        reason: 'y',
        executor: '../bob',
      }),
    DomainError,
  );
});

test('Review strips control chars', () => {
  const rev = Review.create({
    by: 'eris',
    lense: 'devil',
    verdict: 'ok',
    comment: 'hello\x00world',
  });
  assert.equal(rev.comment, 'helloworld');
});

test('Request.create starts with loadedVersion=0 (never on disk)', () => {
  const r = mkReq();
  assert.equal(r.loadedVersion, 0);
  assert.equal(r.currentVersion, 1); // 1 status_log entry
});

test('Request.restore snapshots loadedVersion as status_log + reviews', () => {
  // Hand-build a request with 3 log entries and 2 reviews to prove
  // version counts both. If someone narrows version back to
  // status_log alone, this test fails.
  const r = Request.restore({
    id: RequestId.generate(d, 1),
    from: MemberName.of('alice'),
    action: 'a',
    reason: 'r',
    state: 'completed',
    createdAt: '2026-04-14T00:00:00.000Z',
    statusLog: [
      { state: 'pending', by: 'alice', at: '2026-04-14T00:00:00.000Z' },
      { state: 'approved', by: 'eris', at: '2026-04-14T00:00:01.000Z' },
      { state: 'completed', by: 'alice', at: '2026-04-14T00:00:02.000Z' },
    ],
    reviews: [
      Review.create({ by: 'eris', lense: 'devil', verdict: 'ok', comment: 'a' }),
      Review.create({ by: 'eris', lense: 'layer', verdict: 'ok', comment: 'b' }),
    ],
  });
  assert.equal(r.loadedVersion, 5);
  assert.equal(r.currentVersion, 5);
});

test('Request.addReview increments currentVersion but not loadedVersion', () => {
  // After addReview, on-disk is stale by one; the repo compares
  // on-disk.version to loadedVersion, so loadedVersion must NOT
  // move with in-memory mutations.
  const r = Request.restore({
    id: RequestId.generate(d, 1),
    from: MemberName.of('alice'),
    action: 'a',
    reason: 'r',
    state: 'completed',
    createdAt: '2026-04-14T00:00:00.000Z',
    statusLog: [
      { state: 'pending', by: 'alice', at: '2026-04-14T00:00:00.000Z' },
      { state: 'completed', by: 'alice', at: '2026-04-14T00:00:02.000Z' },
    ],
    reviews: [],
  });
  assert.equal(r.loadedVersion, 2);
  r.addReview(Review.create({ by: 'eris', lense: 'devil', verdict: 'ok', comment: 'x' }));
  assert.equal(r.loadedVersion, 2, 'loadedVersion is the load-time snapshot, never bumped');
  assert.equal(r.currentVersion, 3);
});

test('Request.toJSON derives completion_note from status_log[-1].note', () => {
  const r = mkReq();
  r.approve(MemberName.of('eris'));
  r.execute(MemberName.of('bob'));
  r.complete(MemberName.of('bob'), 'shipped');
  const j = r.toJSON();
  assert.equal(j['completion_note'], 'shipped');
  assert.equal(j['deny_reason'], undefined);
  assert.equal(j['failure_reason'], undefined);
});

test('Request.toJSON derives deny_reason and failure_reason from status_log[-1].note', () => {
  const denied = mkReq();
  denied.deny(MemberName.of('eris'), 'not now');
  assert.equal(denied.toJSON()['deny_reason'], 'not now');
  assert.equal(denied.toJSON()['completion_note'], undefined);

  const failed = mkReq();
  failed.approve(MemberName.of('eris'));
  failed.execute(MemberName.of('bob'));
  failed.fail(MemberName.of('bob'), 'broken');
  assert.equal(failed.toJSON()['failure_reason'], 'broken');
  assert.equal(failed.toJSON()['completion_note'], undefined);
});

test('Request.toJSON: closure-note derivation is single-sourced from status_log', () => {
  // The old duplication bug wrote the note into both props.completionNote
  // and status_log[-1].note. If someone mutates status_log out of band
  // (only possible via restore), toJSON must still reflect what the
  // log says, proving there is no shadow field.
  const r = Request.restore({
    id: RequestId.generate(d, 1),
    from: MemberName.of('alice'),
    action: 'a',
    reason: 'r',
    state: 'completed',
    createdAt: '2026-04-14T00:00:00.000Z',
    statusLog: [
      { state: 'pending', by: 'alice', at: '2026-04-14T00:00:00.000Z' },
      { state: 'completed', by: 'alice', at: '2026-04-14T00:00:01.000Z', note: 'log-wins' },
    ],
    reviews: [],
  });
  assert.equal(r.toJSON()['completion_note'], 'log-wins');
});
