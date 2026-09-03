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
import { d, mkReq } from './_requestHelpers.js';

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

test('assertTransition: illegal move surfaces the valid next states', () => {
  // Touch-feel improvement: the user typed `complete` on a pending
  // request and got "illegal" but no signal toward the right verb.
  // The message now lists the valid next states from the current
  // state — verb hints (`gate approve`) belong in the interface
  // layer; here we only cover the domain vocabulary the transition
  // map already carries.
  assert.throws(
    () => assertTransition('pending', 'completed'),
    (e: unknown) => {
      assert.ok(e instanceof DomainError);
      assert.match(e.message, /Illegal state transition: pending → completed\./);
      assert.match(
        e.message,
        /valid next states from pending: approved, denied\./,
      );
      return true;
    },
  );
});

test('assertTransition: terminal states say so explicitly', () => {
  // From completed/failed/denied there is no legal next move. Saying
  // "valid next states from completed: " (empty) would be confusing;
  // name the dead-end branch in plain English instead.
  assert.throws(
    () => assertTransition('completed', 'executing'),
    (e: unknown) => {
      assert.ok(e instanceof DomainError);
      assert.match(
        e.message,
        /completed is terminal — no further transitions are allowed\./,
      );
      return true;
    },
  );
});

test('assertTransition: same-state idempotency message stays unchanged', () => {
  // The `Request is already X` branch is the common idempotency error
  // (approving an already-approved request). It already reads in plain
  // English; pin that the next-states enrichment didn't accidentally
  // bleed into it.
  assert.throws(
    () => assertTransition('approved', 'approved'),
    (e: unknown) => {
      assert.ok(e instanceof DomainError);
      assert.match(e.message, /^Request is already approved\.$/);
      return true;
    },
  );
});

test('Request rejects invalid executor name', () => {
  assert.throws(
    () =>
      Request.create({
        id: RequestId.generate(d, 1),
        from: 'alice',
        action: 'x',
        reason: 'y',
        executors: ['../bob'],
      }),
    DomainError,
  );
});

// ── multi-executor (issue #230) ─────────────────────────────────

test('Request.create accepts --executors a,b and stores them in order', () => {
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
    executors: ['miki', 'leysia'],
  });
  assert.deepEqual(
    r.executors.map((m) => m.value),
    ['miki', 'leysia'],
  );
  // first-of-list reachable via `r.executors[0]` for callers that
  // legitimately need a representative (display, default --by); the
  // former scalar `executor` getter was removed in the Devil-review
  // pass to prevent silent drops of later-listed executors.
  assert.equal(r.executors[0]?.value, 'miki');
  // `hasExecutor` is the preferred membership predicate — multi-
  // executor wave members must all see the same belongs-to-me result.
  assert.equal(r.hasExecutor('miki'), true);
  assert.equal(r.hasExecutor('leysia'), true);
  assert.equal(r.hasExecutor('alice'), false);
});

test('Request.create rejects duplicate --executors entries', () => {
  assert.throws(
    () =>
      Request.create({
        id: RequestId.generate(d, 1),
        from: 'alice',
        action: 'a',
        reason: 'r',
        executors: ['miki', 'miki'],
      }),
    DomainError,
  );
});

test('Request.create rejects malformed --executors entry (regex check via MemberName)', () => {
  assert.throws(
    () =>
      Request.create({
        id: RequestId.generate(d, 1),
        from: 'alice',
        action: 'a',
        reason: 'r',
        executors: ['../bob'],
      }),
    DomainError,
  );
});

test('Request.toJSON: emits executors array (single-executor input), no legacy key on persistence path', () => {
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
    executors: ['bob'],
  });
  // Spec: persistence always uses new-form `executors:` regardless of
  // which input flag was used. The legacy `executor:` key MUST NOT
  // appear in toJSON — that's the YAML repo serialisation path and
  // re-emitting both keys would pollute on-disk records.
  // Issue #294: freshly-created records carry status='pending', so
  // toJSON emits the structured form (the legacy flat-array form is
  // reserved for hydrate-from-legacy round-trip where every record
  // has status='unknown'). Persistence still omits the deprecated
  // `executor:` scalar key.
  assert.deepEqual(r.toJSON()['executors'], [{ name: 'bob', status: 'pending' }]);
  assert.equal(r.toJSON()['executor'], undefined);
});

test('Request.toJSON: emits executors array (multi)', () => {
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
    executors: ['miki', 'leysia'],
  });
  // Issue #294: structured form for freshly-created records.
  assert.deepEqual(r.toJSON()['executors'], [
    { name: 'miki', status: 'pending' },
    { name: 'leysia', status: 'pending' },
  ]);
});

// Issue #231 — worktree-isolation domain round-trip. The flag is set
// at create time and surfaces only when truthy; the cwd lives on the
// `executing` status_log entry. These tests pin both the persistence
// shape (toJSON / statusLogEntry serialiser) and the read accessors
// (`requiresWorktreeIsolation`, `lastExecutingCwd`) the interface layer
// reads to gate the cwd-collision check.
test('Request: requires_worktree_isolation round-trip (#231)', () => {
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
    executors: ['miki', 'leysia'],
    requiresWorktreeIsolation: true,
  });
  assert.equal(r.requiresWorktreeIsolation, true);
  assert.equal(r.toJSON()['requires_worktree_isolation'], true);
});

test('Request: requires_worktree_isolation absent when not set (default false)', () => {
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
    executors: ['miki'],
  });
  assert.equal(r.requiresWorktreeIsolation, false);
  assert.equal(r.toJSON()['requires_worktree_isolation'], undefined);
});

test('Request.execute(cwd): stamps executing_at_cwd on the status_log entry', () => {
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
    executors: ['miki'],
  });
  r.approve(MemberName.of('alice'));
  r.execute(MemberName.of('miki'), undefined, undefined, '/tmp/worktree-A');
  assert.equal(r.lastExecutingCwd, '/tmp/worktree-A');
  const last = r.toJSON()['status_log'] as Array<Record<string, unknown>>;
  assert.equal(last[last.length - 1]!['executing_at_cwd'], '/tmp/worktree-A');
});

test('Request.execute(): no cwd → executing_at_cwd absent (back-compat)', () => {
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
    executors: ['miki'],
  });
  r.approve(MemberName.of('alice'));
  r.execute(MemberName.of('miki'));
  assert.equal(r.lastExecutingCwd, undefined);
  const log = r.toJSON()['status_log'] as Array<Record<string, unknown>>;
  assert.equal(log[log.length - 1]!['executing_at_cwd'], undefined);
});

test('Request.toJSON: omits executors key when none assigned', () => {
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
  });
  assert.equal(r.toJSON()['executors'], undefined);
  assert.equal(r.toJSON()['executor'], undefined);
});

test('Request.restore: legacy `executor:` (string) is normalised to executors[0] (records-outlive-writers)', () => {
  // This restores a Request as if it were just hydrated from the
  // legacy YAML form. We can't go through hydrate() without the
  // repository, but we verify the post-hydrate aggregate behaviour:
  // the getter returns `bob`, the new array surface returns `[bob]`,
  // and toJSON re-emits the new form on round-trip.
  const r = Request.restore({
    id: RequestId.generate(d, 1),
    from: MemberName.of('alice'),
    action: 'a',
    reason: 'r',
    state: 'pending',
    createdAt: '2026-04-14T00:00:00.000Z',
    executors: [{ name: MemberName.of('bob'), status: 'unknown' }],
    statusLog: [
      { state: 'pending', by: 'alice', at: '2026-04-14T00:00:00.000Z' },
    ],
    reviews: [],
  });
  assert.equal(r.executors[0]?.value, 'bob');
  assert.deepEqual(r.executors.map((m) => m.value), ['bob']);
  assert.deepEqual(r.toJSON()['executors'], ['bob']);
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

test('Request.create with `with` stores partners in order, dedupes, rejects self', () => {
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
    with: ['eris', 'bob', 'eris', 'alice'], // duplicate eris, self alice
  });
  assert.deepEqual(
    r.with.map((m) => m.value),
    ['eris', 'bob'],
    'duplicates dropped (first-wins), self removed',
  );
});

test('Request.create with empty `with` leaves with unset', () => {
  const r1 = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
    with: [],
  });
  assert.equal(r1.with.length, 0);
  // Only-self input also collapses to empty
  const r2 = Request.create({
    id: RequestId.generate(d, 2),
    from: 'alice',
    action: 'a',
    reason: 'r',
    with: ['alice'],
  });
  assert.equal(r2.with.length, 0);
});

test('Request.toJSON emits `with` only when non-empty', () => {
  const solo = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
  });
  assert.equal(solo.toJSON()['with'], undefined);
  const paired = Request.create({
    id: RequestId.generate(d, 2),
    from: 'alice',
    action: 'a',
    reason: 'r',
    with: ['eris'],
  });
  assert.deepEqual(paired.toJSON()['with'], ['eris']);
});

test('Request.create rejects invalid `with` entries (same validation as other actor fields)', () => {
  assert.throws(
    () =>
      Request.create({
        id: RequestId.generate(d, 1),
        from: 'alice',
        action: 'a',
        reason: 'r',
        with: ['../bob'],
      }),
    DomainError,
  );
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

// ── invoked_by: agent proxy vs on-record actor ──

test('Request.approve stamps invoked_by when it differs from by', () => {
  const r = mkReq();
  r.approve(MemberName.of('alice'), 'ok', 'claude');
  const log = r.toJSON()['status_log'] as Array<Record<string, unknown>>;
  const last = log[log.length - 1]!;
  assert.equal(last['by'], 'alice');
  assert.equal(last['invoked_by'], 'claude');
});

test('Request.approve omits invoked_by when it equals by (no clutter)', () => {
  const r = mkReq();
  r.approve(MemberName.of('alice'), 'ok', 'alice');
  const log = r.toJSON()['status_log'] as Array<Record<string, unknown>>;
  const last = log[log.length - 1]!;
  assert.equal(last['by'], 'alice');
  assert.equal('invoked_by' in last, false);
});

test('Request.approve without invokedBy emits no invoked_by key', () => {
  const r = mkReq();
  r.approve(MemberName.of('alice'), 'ok');
  const log = r.toJSON()['status_log'] as Array<Record<string, unknown>>;
  const last = log[log.length - 1]!;
  assert.equal('invoked_by' in last, false);
});

test('Review.create stamps invoked_by when it differs from by', () => {
  const review = Review.create({
    by: 'alice',
    lense: 'devil',
    verdict: 'ok',
    comment: 'looks fine',
    invokedBy: 'claude',
  });
  const j = review.toJSON();
  assert.equal(j['by'], 'alice');
  assert.equal(j['invoked_by'], 'claude');
});

test('Review.create omits invoked_by when it equals by', () => {
  const review = Review.create({
    by: 'alice',
    lense: 'devil',
    verdict: 'ok',
    comment: 'looks fine',
    invokedBy: 'alice',
  });
  const j = review.toJSON();
  assert.equal('invoked_by' in j, false);
});

// ── Review.create vs Review.restore: comment strictness split ──
//
// Pre-2026-05 the domain tolerated empty comments and only the CLI
// handler enforced "comment required". That left RequestUseCases.review
// (the application API) and any future programmatic caller able to
// land empty-comment reviews. The split tightens fresh-write paths
// (Review.create) while keeping hydration (Review.restore) tolerant of
// historical records whose `comment` field is empty or missing.

test('Review.create rejects empty comment', () => {
  assert.throws(
    () =>
      Review.create({
        by: 'alice',
        lense: 'devil',
        verdict: 'ok',
        comment: '',
      }),
    DomainError,
  );
});

test('Review.create rejects whitespace-only comment', () => {
  assert.throws(
    () =>
      Review.create({
        by: 'alice',
        lense: 'devil',
        verdict: 'ok',
        comment: '   \n\t  ',
      }),
    DomainError,
  );
});

test('Review.restore tolerates empty comment (hydration path)', () => {
  const review = Review.restore({
    by: 'alice',
    lense: 'devil',
    verdict: 'ok',
    comment: '',
    at: '2026-05-04T00:00:00.000Z',
  });
  assert.equal(review.comment, '');
  assert.equal(review.by.value, 'alice');
});

test('Review.restore preserves a non-empty comment unchanged', () => {
  const review = Review.restore({
    by: 'alice',
    lense: 'devil',
    verdict: 'ok',
    comment: 'historical prose',
    at: '2026-05-04T00:00:00.000Z',
  });
  assert.equal(review.comment, 'historical prose');
});

test('Request restore preserves invoked_by round-trip', () => {
  const r = Request.restore({
    id: RequestId.generate(d, 1),
    from: MemberName.of('alice'),
    action: 'a',
    reason: 'r',
    state: 'approved',
    createdAt: '2026-04-14T00:00:00.000Z',
    statusLog: [
      { state: 'pending', by: 'alice', at: '2026-04-14T00:00:00.000Z' },
      {
        state: 'approved',
        by: 'alice',
        at: '2026-04-14T00:00:01.000Z',
        invokedBy: 'claude',
      },
    ],
    reviews: [],
  });
  const log = r.toJSON()['status_log'] as Array<Record<string, unknown>>;
  assert.equal(log[1]!['invoked_by'], 'claude');
});

// ── invoked_by on Request.create (initial status_log entry) ──

test('Request.create stamps invoked_by on initial status_log when differs from from', () => {
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
    invokedBy: 'claude',
  });
  const log = r.toJSON()['status_log'] as Array<Record<string, unknown>>;
  assert.equal(log[0]!['by'], 'alice');
  assert.equal(log[0]!['invoked_by'], 'claude');
});

test('Request.create omits invoked_by on initial entry when equals from', () => {
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
    invokedBy: 'alice',
  });
  const log = r.toJSON()['status_log'] as Array<Record<string, unknown>>;
  assert.equal(log[0]!['by'], 'alice');
  assert.equal('invoked_by' in log[0]!, false);
});

test('Request.create without invokedBy leaves initial entry clean', () => {
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
  });
  const log = r.toJSON()['status_log'] as Array<Record<string, unknown>>;
  assert.equal('invoked_by' in log[0]!, false);
});

// ── promoted_from: structured link to source issue ──

test('Request.create with promotedFrom stores the id on the aggregate', () => {
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'whatever',
    reason: 'whatever',
    promotedFrom: 'i-2026-04-14-0001',
  });
  assert.equal(r.promotedFrom, 'i-2026-04-14-0001');
  assert.equal(r.toJSON()['promoted_from'], 'i-2026-04-14-0001');
});

test('Request.toJSON omits promoted_from when not set (pre-promote requests byte-identical)', () => {
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
  });
  assert.equal('promoted_from' in r.toJSON(), false);
});

test('Request.restore preserves promotedFrom on round-trip', () => {
  // Simulates the repo rehydrating a request that was promoted.
  // The field must survive load → toJSON without needing domain
  // logic to re-infer it from text.
  const r = Request.restore({
    id: RequestId.generate(d, 1),
    from: MemberName.of('alice'),
    action: 'custom title (no id mention)',
    reason: 'custom reason (no id mention)',
    state: 'pending',
    createdAt: '2026-04-14T00:00:00.000Z',
    statusLog: [
      { state: 'pending', by: 'alice', at: '2026-04-14T00:00:00.000Z' },
    ],
    reviews: [],
    promotedFrom: 'i-2026-04-14-0007',
  });
  assert.equal(r.promotedFrom, 'i-2026-04-14-0007');
  assert.equal(r.toJSON()['promoted_from'], 'i-2026-04-14-0007');
});

// ── supersedes: forward link to the older request this one corrects ──
//
// Unlike promoted_from / source_agora_play these are operator-typed,
// so the domain owns two refusals: shape, and self-reference.

test('Request.create with supersedes stores the id on the aggregate', () => {
  const r = Request.create({
    id: RequestId.generate(d, 2),
    from: 'alice',
    action: 'correcting the earlier claim',
    reason: 'the measurement was wrong',
    supersedes: '2026-04-14-0001',
  });
  assert.equal(r.supersedes, '2026-04-14-0001');
  assert.equal(r.toJSON()['supersedes'], '2026-04-14-0001');
});

test('Request.toJSON omits supersedes when not set (ordinary records byte-identical)', () => {
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
  });
  assert.equal('supersedes' in r.toJSON(), false);
});

test('Request.create refuses a self-supersession', () => {
  // A record cannot correct itself: the link would be a cycle of one
  // and a reader following it would never reach a prior claim.
  const id = RequestId.generate(d, 3);
  assert.throws(
    () =>
      Request.create({
        id,
        from: 'alice',
        action: 'a',
        reason: 'r',
        supersedes: id.value,
      }),
    /cannot supersede itself/,
  );
});

test('Request.create refuses a malformed supersedes id', () => {
  assert.throws(
    () =>
      Request.create({
        id: RequestId.generate(d, 4),
        from: 'alice',
        action: 'a',
        reason: 'r',
        supersedes: 'not-an-id',
      }),
    /Invalid request id/,
  );
});

test('Request.create accepts a legacy 3-digit supersedes target', () => {
  // Pre-0.2.0 content roots wrote 3-digit sequences. A correction must
  // be able to point at one, or the oldest records become uncorrectable
  // (principle 04 — cold readers of old YAML keep working).
  const r = Request.create({
    id: RequestId.generate(d, 5),
    from: 'alice',
    action: 'a',
    reason: 'r',
    supersedes: '2026-01-02-007',
  });
  assert.equal(r.supersedes, '2026-01-02-007');
});

test('Request.restore preserves supersedes on round-trip', () => {
  const r = Request.restore({
    id: RequestId.generate(d, 6),
    from: MemberName.of('alice'),
    action: 'custom title (no id mention)',
    reason: 'custom reason (no id mention)',
    state: 'pending',
    createdAt: '2026-04-14T00:00:00.000Z',
    statusLog: [
      { state: 'pending', by: 'alice', at: '2026-04-14T00:00:00.000Z' },
    ],
    reviews: [],
    supersedes: '2026-04-14-0009',
  });
  assert.equal(r.supersedes, '2026-04-14-0009');
  assert.equal(r.toJSON()['supersedes'], '2026-04-14-0009');
});

