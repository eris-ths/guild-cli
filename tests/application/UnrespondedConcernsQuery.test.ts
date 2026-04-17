// UnrespondedConcernsQuery — derives "concerns on my authored/paired
// requests that nothing later in the record references yet."
//
// Key invariants under test:
//   1. Concern with no follow-up → surfaced
//   2. Concern with any follow-up → dropped (partial-close deliberately
//      not detected; the reader judges coverage)
//   3. Pair-mode: a partner's follow-up closes the loop
//   4. Age cutoff: concerns older than maxAgeDays are dropped
//   5. ok verdicts are never surfaced; only concern / reject
//   6. Actor outside authorship set → request is invisible to them
//   7. Issue as follow-up counts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Request } from '../../src/domain/request/Request.js';
import { RequestId } from '../../src/domain/request/RequestId.js';
import { Review } from '../../src/domain/request/Review.js';
import { Issue, IssueId } from '../../src/domain/issue/Issue.js';
import {
  computeUnrespondedConcerns,
  DEFAULT_MAX_AGE_DAYS,
} from '../../src/application/concern/UnrespondedConcernsQuery.js';

const BASE_DATE = new Date('2026-04-17T00:00:00Z');

function daysAgo(n: number): string {
  return new Date(BASE_DATE.getTime() - n * 86_400_000).toISOString();
}

function makeRequest(opts: {
  seq: number;
  from: string;
  action: string;
  reason?: string;
  with?: readonly string[];
  createdAt?: string;
  reviews?: Array<{ by: string; lense: string; verdict: string; at?: string; comment?: string }>;
  extraNote?: string; // appended to status_log as a completion note
}): Request {
  const created = opts.createdAt ?? BASE_DATE.toISOString();
  const createInput: Parameters<typeof Request.create>[0] = {
    id: RequestId.generate(new Date(created), opts.seq),
    from: opts.from,
    action: opts.action,
    reason: opts.reason ?? 'test reason',
    createdAt: created,
  };
  if (opts.with && opts.with.length > 0) {
    createInput.with = opts.with;
  }
  const r = Request.create(createInput);
  for (const rv of opts.reviews ?? []) {
    r.addReview(
      Review.create({
        by: rv.by,
        lense: rv.lense,
        verdict: rv.verdict,
        comment: rv.comment ?? 'comment',
        at: rv.at ?? created,
      }),
    );
  }
  return r;
}

function makeIssue(seq: number, from: string, text: string): Issue {
  return Issue.create({
    id: IssueId.generate(BASE_DATE, seq),
    from,
    severity: 'low',
    area: 'test',
    text,
  });
}

test('empty inputs → empty result', () => {
  const out = computeUnrespondedConcerns([], [], 'claude', BASE_DATE.getTime(), 30);
  assert.deepEqual(out, []);
});

test('concern with no follow-up → surfaced', () => {
  const r = makeRequest({
    seq: 1,
    from: 'claude',
    action: 'propose X',
    reviews: [{ by: 'alice', lense: 'devil', verdict: 'concern', at: daysAgo(1) }],
  });
  const out = computeUnrespondedConcerns([r], [], 'claude', BASE_DATE.getTime(), 30);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.request_id, r.id.value);
  assert.equal(out[0]!.concerns.length, 1);
  assert.equal(out[0]!.concerns[0]!.by, 'alice');
  assert.equal(out[0]!.concerns[0]!.lense, 'devil');
  assert.equal(out[0]!.concerns[0]!.verdict, 'concern');
  assert.equal(out[0]!.concerns[0]!.age_days, 1);
});

test('follow-up request from author closes the loop', () => {
  const target = makeRequest({
    seq: 1,
    from: 'claude',
    action: 'propose X',
    reviews: [{ by: 'alice', lense: 'devil', verdict: 'concern', at: daysAgo(2) }],
  });
  const followUp = makeRequest({
    seq: 2,
    from: 'claude',
    action: 'respond to concern',
    reason: `addressing ${target.id.value}`,
    createdAt: daysAgo(1),
  });
  const out = computeUnrespondedConcerns(
    [target, followUp],
    [],
    'claude',
    BASE_DATE.getTime(),
    30,
  );
  assert.deepEqual(out, []);
});

test('partial-close: 2 concerns, 1 follow-up → entire request still dropped (documented limitation)', () => {
  const target = makeRequest({
    seq: 1,
    from: 'claude',
    action: 'propose X',
    reviews: [
      { by: 'alice', lense: 'devil', verdict: 'concern', at: daysAgo(2), comment: 'a' },
      { by: 'alice', lense: 'cognitive', verdict: 'concern', at: daysAgo(2), comment: 'b' },
    ],
  });
  const followUp = makeRequest({
    seq: 2,
    from: 'claude',
    action: 'half-response',
    reason: `partial ack of ${target.id.value}`,
    createdAt: daysAgo(1),
  });
  const out = computeUnrespondedConcerns(
    [target, followUp],
    [],
    'claude',
    BASE_DATE.getTime(),
    30,
  );
  // The tool deliberately does NOT try to detect partial close. Follow-up
  // exists → whole request is dropped. Limitation is documented.
  assert.deepEqual(out, []);
});

test('pair-mode: partner is in authorship set and sees the concern', () => {
  const target = makeRequest({
    seq: 1,
    from: 'claude',
    action: 'pair proposal',
    with: ['noir'],
    reviews: [{ by: 'alice', lense: 'devil', verdict: 'concern', at: daysAgo(1) }],
  });
  const forNoir = computeUnrespondedConcerns([target], [], 'noir', BASE_DATE.getTime(), 30);
  assert.equal(forNoir.length, 1);
  const forClaude = computeUnrespondedConcerns([target], [], 'claude', BASE_DATE.getTime(), 30);
  assert.equal(forClaude.length, 1);
});

test('pair-mode: partner\'s follow-up closes the loop for the author too', () => {
  const target = makeRequest({
    seq: 1,
    from: 'claude',
    action: 'pair proposal',
    with: ['noir'],
    reviews: [{ by: 'alice', lense: 'devil', verdict: 'concern', at: daysAgo(2) }],
  });
  const partnerFollowUp = makeRequest({
    seq: 2,
    from: 'noir',
    action: 'addressing concern',
    reason: `see ${target.id.value}`,
    createdAt: daysAgo(1),
  });
  const out = computeUnrespondedConcerns(
    [target, partnerFollowUp],
    [],
    'claude',
    BASE_DATE.getTime(),
    30,
  );
  assert.deepEqual(out, []);
});

test('age cutoff: concern older than maxAgeDays is dropped', () => {
  const target = makeRequest({
    seq: 1,
    from: 'claude',
    action: 'ancient',
    reviews: [{ by: 'alice', lense: 'devil', verdict: 'concern', at: daysAgo(100) }],
  });
  const out = computeUnrespondedConcerns([target], [], 'claude', BASE_DATE.getTime(), 30);
  assert.deepEqual(out, []);
});

test('age cutoff: concern at exactly maxAgeDays is included', () => {
  const target = makeRequest({
    seq: 1,
    from: 'claude',
    action: 'borderline',
    reviews: [{ by: 'alice', lense: 'devil', verdict: 'concern', at: daysAgo(30) }],
  });
  const out = computeUnrespondedConcerns([target], [], 'claude', BASE_DATE.getTime(), 30);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.concerns[0]!.age_days, 30);
});

test('ok verdict is not surfaced', () => {
  const target = makeRequest({
    seq: 1,
    from: 'claude',
    action: 'blessed',
    reviews: [
      { by: 'alice', lense: 'devil', verdict: 'ok', at: daysAgo(1) },
      { by: 'alice', lense: 'layer', verdict: 'ok', at: daysAgo(1) },
    ],
  });
  const out = computeUnrespondedConcerns([target], [], 'claude', BASE_DATE.getTime(), 30);
  assert.deepEqual(out, []);
});

test('reject verdict is surfaced (harsher than concern, same treatment)', () => {
  const target = makeRequest({
    seq: 1,
    from: 'claude',
    action: 'rejected',
    reviews: [{ by: 'alice', lense: 'devil', verdict: 'reject', at: daysAgo(1) }],
  });
  const out = computeUnrespondedConcerns([target], [], 'claude', BASE_DATE.getTime(), 30);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.concerns[0]!.verdict, 'reject');
});

test('actor not in authorship set → request is invisible to them', () => {
  const target = makeRequest({
    seq: 1,
    from: 'claude',
    action: 'someone else\'s work',
    reviews: [{ by: 'alice', lense: 'devil', verdict: 'concern', at: daysAgo(1) }],
  });
  const out = computeUnrespondedConcerns([target], [], 'noir', BASE_DATE.getTime(), 30);
  assert.deepEqual(out, []);
});

test('issue as follow-up counts as a response', () => {
  const target = makeRequest({
    seq: 1,
    from: 'claude',
    action: 'propose X',
    reviews: [{ by: 'alice', lense: 'devil', verdict: 'concern', at: daysAgo(2) }],
  });
  const issue = makeIssue(1, 'claude', `tracking concern from ${target.id.value}`);
  const out = computeUnrespondedConcerns(
    [target],
    [issue],
    'claude',
    BASE_DATE.getTime(),
    30,
  );
  assert.deepEqual(out, []);
});

test('issue follow-up must be from authorship set', () => {
  const target = makeRequest({
    seq: 1,
    from: 'claude',
    action: 'propose X',
    reviews: [{ by: 'alice', lense: 'devil', verdict: 'concern', at: daysAgo(2) }],
  });
  // Issue filed by alice mentioning claude's request doesn't close
  // claude's loop — alice is the critic, not co-author.
  const issue = makeIssue(1, 'alice', `re ${target.id.value}`);
  const out = computeUnrespondedConcerns(
    [target],
    [issue],
    'claude',
    BASE_DATE.getTime(),
    30,
  );
  assert.equal(out.length, 1);
});

test('most-recent concern sorted first', () => {
  const older = makeRequest({
    seq: 1,
    from: 'claude',
    action: 'older',
    createdAt: daysAgo(5),
    reviews: [{ by: 'alice', lense: 'devil', verdict: 'concern', at: daysAgo(5) }],
  });
  const newer = makeRequest({
    seq: 2,
    from: 'claude',
    action: 'newer',
    createdAt: daysAgo(1),
    reviews: [{ by: 'alice', lense: 'devil', verdict: 'concern', at: daysAgo(1) }],
  });
  const out = computeUnrespondedConcerns(
    [older, newer],
    [],
    'claude',
    BASE_DATE.getTime(),
    30,
  );
  assert.equal(out.length, 2);
  assert.equal(out[0]!.request_id, newer.id.value);
  assert.equal(out[1]!.request_id, older.id.value);
});

test('default maxAgeDays is 30', () => {
  // Not a behavior test — just a contract pin so the constant isn't
  // silently changed without a corresponding docs update.
  assert.equal(DEFAULT_MAX_AGE_DAYS, 30);
});

test('self-review on own request still counts as a concern to track', () => {
  // Edge case: a review by the author themselves on their own request
  // (rare but possible via fast-track self-review flows). Still a
  // concern that needs a response.
  const target = makeRequest({
    seq: 1,
    from: 'claude',
    action: 'self-crit',
    reviews: [{ by: 'claude', lense: 'cognitive', verdict: 'concern', at: daysAgo(1) }],
  });
  const out = computeUnrespondedConcerns([target], [], 'claude', BASE_DATE.getTime(), 30);
  assert.equal(out.length, 1);
});
