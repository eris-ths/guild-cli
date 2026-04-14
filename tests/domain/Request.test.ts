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

test('RequestId generate produces correct format', () => {
  const id = RequestId.generate(d, 42);
  assert.equal(id.value, '2026-04-14-042');
});

test('RequestId of validates pattern', () => {
  assert.throws(() => RequestId.of('2026-4-14-001'), DomainError);
  assert.throws(() => RequestId.of('bad'), DomainError);
  assert.doesNotThrow(() => RequestId.of('2026-04-14-001'));
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
