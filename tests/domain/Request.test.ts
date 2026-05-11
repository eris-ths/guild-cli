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
        executor: '../bob',
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

test('Request.create rejects --executor + --executors combined', () => {
  assert.throws(
    () =>
      Request.create({
        id: RequestId.generate(d, 1),
        from: 'alice',
        action: 'a',
        reason: 'r',
        executor: 'miki',
        executors: ['leysia'],
      }),
    DomainError,
  );
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
    executor: 'bob',
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

test('Request.toRenderJSON: emits BOTH `executors` and deprecated `executor` (JSON back-compat)', () => {
  // Devil review #230 blocker 2: tool wirings reading `gate show
  // --format json | jq .executor` were a documented surface. The
  // render-side projection keeps the deprecated alias visible
  // alongside the new array key. Persistence (toJSON) stays clean.
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
    executors: ['miki', 'leysia'],
  });
  const j = r.toRenderJSON();
  // Issue #294: post-create executors emit as structured records.
  assert.deepEqual(j['executors'], [
    { name: 'miki', status: 'pending' },
    { name: 'leysia', status: 'pending' },
  ]);
  // Deprecated alias = first-of-list. Multi-executor consumers should
  // already be reading `executors`; this key is back-compat only.
  assert.equal(j['executor'], 'miki');
});

test('Request.toRenderJSON: omits both keys when no executor assigned', () => {
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
  });
  const j = r.toRenderJSON();
  assert.equal(j['executors'], undefined);
  assert.equal(j['executor'], undefined);
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
    executor: 'miki',
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
    executor: 'miki',
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

// ─── Issue #294: per-executor slice closure (Slice A) ───────────

function mkApprovedMulti(execs: string[]): Request {
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
    executors: execs,
  });
  r.approve(MemberName.of('eris'));
  for (const e of execs) {
    // Each executor enters executing — wave-state lifecycle is shared;
    // the per-slice closure derives the wave terminal.
  }
  r.execute(MemberName.of(execs[0]!));
  return r;
}

test('#294 legacy flat-array hydrate: in-memory status=unknown', () => {
  // Simulate post-hydrate via Request.restore (the repository's
  // hydrate() builds the same shape). Pre-#294 records had
  // status='unknown' for every executor.
  const r = Request.restore({
    id: RequestId.generate(d, 1),
    from: MemberName.of('alice'),
    action: 'a',
    reason: 'r',
    state: 'pending',
    createdAt: '2026-05-11T00:00:00.000Z',
    executors: [
      { name: MemberName.of('bob'), status: 'unknown' },
      { name: MemberName.of('miki'), status: 'unknown' },
    ],
    statusLog: [
      { state: 'pending', by: 'alice', at: '2026-05-11T00:00:00.000Z' },
    ],
    reviews: [],
  });
  // executors getter still returns names for back-compat.
  assert.deepEqual(r.executors.map((m) => m.value), ['bob', 'miki']);
  // structured records expose status.
  assert.equal(r.executorRecords[0]!.status, 'unknown');
  assert.equal(r.executorStatus('bob'), 'unknown');
  // toJSON: all-unknown collapses to flat array (byte-stable round-trip).
  assert.deepEqual(r.toJSON()['executors'], ['bob', 'miki']);
});

test('#294 structured-form round-trip: pending/completed/failed mix', () => {
  const r = Request.restore({
    id: RequestId.generate(d, 1),
    from: MemberName.of('alice'),
    action: 'a',
    reason: 'r',
    state: 'executing',
    createdAt: '2026-05-11T00:00:00.000Z',
    executors: [
      {
        name: MemberName.of('bob'),
        status: 'completed',
        completedAt: '2026-05-11T01:00:00.000Z',
        note: 'done',
      },
      {
        name: MemberName.of('miki'),
        status: 'failed',
        completedAt: '2026-05-11T01:30:00.000Z',
        note: 'broken',
      },
      { name: MemberName.of('leysia'), status: 'pending' },
    ],
    statusLog: [
      { state: 'pending', by: 'alice', at: '2026-05-11T00:00:00.000Z' },
    ],
    reviews: [],
  });
  const j = r.toJSON();
  assert.deepEqual(j['executors'], [
    {
      name: 'bob',
      status: 'completed',
      completed_at: '2026-05-11T01:00:00.000Z',
      note: 'done',
    },
    {
      name: 'miki',
      status: 'failed',
      completed_at: '2026-05-11T01:30:00.000Z',
      note: 'broken',
    },
    { name: 'leysia', status: 'pending' },
  ]);
});

test('#294 completeSlice on intermediate executor: wave state unchanged', () => {
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
    executors: ['miki', 'leysia'],
  });
  r.approve(MemberName.of('eris'));
  r.execute(MemberName.of('miki'));
  r.completeSlice(MemberName.of('miki'), 'slice 1 done');
  // Wave stays executing — one slice still open.
  assert.equal(r.state, 'executing');
  assert.equal(r.executorStatus('miki'), 'completed');
  assert.equal(r.executorStatus('leysia'), 'pending');
});

test('#294 completeSlice on last open executor: wave transitions to completed', () => {
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
    executors: ['miki', 'leysia'],
  });
  r.approve(MemberName.of('eris'));
  r.execute(MemberName.of('miki'));
  r.completeSlice(MemberName.of('miki'), 'slice 1 done');
  r.completeSlice(MemberName.of('leysia'), 'slice 2 done');
  assert.equal(r.state, 'completed');
  assert.equal(r.executorStatus('miki'), 'completed');
  assert.equal(r.executorStatus('leysia'), 'completed');
});

test('#294 failSlice records failed status on the executor', () => {
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
    executors: ['miki', 'leysia'],
  });
  r.approve(MemberName.of('eris'));
  r.execute(MemberName.of('miki'));
  r.failSlice(MemberName.of('miki'), 'broken pipeline');
  assert.equal(r.state, 'executing');
  assert.equal(r.executorStatus('miki'), 'failed');
  const records = r.executorRecords;
  assert.equal(records[0]!.status, 'failed');
  assert.equal(records[0]!.note, 'broken pipeline');
});

test('#294 any-fail-wave-fail: failed + completed → wave fails', () => {
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
    executors: ['miki', 'leysia'],
  });
  r.approve(MemberName.of('eris'));
  r.execute(MemberName.of('miki'));
  r.failSlice(MemberName.of('miki'), 'broken');
  r.completeSlice(MemberName.of('leysia'), 'mine ok');
  // Any-fail-wave-fail: the wave terminal is failed even though only
  // one slice failed.
  assert.equal(r.state, 'failed');
});

test('#294 fallback: complete() on actor not in executors → direct wave terminal (pre-#294 compat)', () => {
  // Legacy: a hydrated pre-#294 record without an executor list (or
  // where the closing actor isn't one of the listed executors) keeps
  // the old behavior — `complete()` immediately drives the wave to
  // completed, regardless of slice machinery.
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
    // no executors assigned
  });
  r.approve(MemberName.of('eris'));
  r.execute(MemberName.of('bob'));
  r.complete(MemberName.of('bob'), 'done');
  assert.equal(r.state, 'completed');
});

test('#294 fallback: legacy unknown-only record + complete() on non-listed actor still works', () => {
  // Pre-#294 record hydrated as unknown-status; `complete --by X`
  // where X isn't on the list falls through to the wave-terminal path.
  const r = Request.restore({
    id: RequestId.generate(d, 1),
    from: MemberName.of('alice'),
    action: 'a',
    reason: 'r',
    state: 'executing',
    createdAt: '2026-05-11T00:00:00.000Z',
    executors: [{ name: MemberName.of('bob'), status: 'unknown' }],
    statusLog: [
      { state: 'pending', by: 'alice', at: '2026-05-11T00:00:00.000Z' },
      { state: 'approved', by: 'eris', at: '2026-05-11T00:01:00.000Z' },
      { state: 'executing', by: 'bob', at: '2026-05-11T00:02:00.000Z' },
    ],
    reviews: [],
  });
  // 'bob' IS in the list — completeSlice path is taken; slice becomes
  // completed and (being the only executor) the wave closes.
  r.complete(MemberName.of('bob'), 'done');
  assert.equal(r.state, 'completed');
  assert.equal(r.executorStatus('bob'), 'completed');
});

test('#294 hasExecutor still works through migration', () => {
  // Legacy unknown-status records and post-#294 pending/completed
  // records both answer hasExecutor on name match.
  const legacy = Request.restore({
    id: RequestId.generate(d, 1),
    from: MemberName.of('alice'),
    action: 'a',
    reason: 'r',
    state: 'pending',
    createdAt: '2026-05-11T00:00:00.000Z',
    executors: [{ name: MemberName.of('bob'), status: 'unknown' }],
    statusLog: [{ state: 'pending', by: 'alice', at: '2026-05-11T00:00:00.000Z' }],
    reviews: [],
  });
  assert.equal(legacy.hasExecutor('bob'), true);
  assert.equal(legacy.hasExecutor('mallory'), false);

  const fresh = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
    executors: ['miki', 'leysia'],
  });
  assert.equal(fresh.hasExecutor('miki'), true);
  assert.equal(fresh.hasExecutor('leysia'), true);
  assert.equal(fresh.hasExecutor('eris'), false);
});

test('#294 first mutation migrates legacy unknown → structured form on toJSON', () => {
  // Hydrate-from-legacy: every executor is unknown. completeSlice on
  // one of them flips its status to completed; toJSON now emits the
  // structured form (no longer all-unknown).
  const r = Request.restore({
    id: RequestId.generate(d, 1),
    from: MemberName.of('alice'),
    action: 'a',
    reason: 'r',
    state: 'executing',
    createdAt: '2026-05-11T00:00:00.000Z',
    executors: [
      { name: MemberName.of('bob'), status: 'unknown' },
      { name: MemberName.of('miki'), status: 'unknown' },
    ],
    statusLog: [
      { state: 'pending', by: 'alice', at: '2026-05-11T00:00:00.000Z' },
      { state: 'approved', by: 'eris', at: '2026-05-11T00:01:00.000Z' },
      { state: 'executing', by: 'bob', at: '2026-05-11T00:02:00.000Z' },
    ],
    reviews: [],
  });
  // Before mutation: all-unknown → flat form.
  assert.deepEqual(r.toJSON()['executors'], ['bob', 'miki']);
  // After mutation: structured form (bob.completed, miki.unknown).
  r.completeSlice(MemberName.of('bob'), 'first slice');
  const execs = r.toJSON()['executors'] as Array<Record<string, unknown>>;
  assert.equal(execs.length, 2);
  assert.equal(execs[0]!['name'], 'bob');
  assert.equal(execs[0]!['status'], 'completed');
  assert.equal(execs[0]!['note'], 'first slice');
  assert.equal(execs[1]!['name'], 'miki');
  assert.equal(execs[1]!['status'], 'unknown');
});

test('#294 double-close refusal: completeSlice twice on the same actor throws', () => {
  // Devil review §Correctness 1: same-actor re-close used to silently
  // overwrite attribution. Domain now refuses the second call.
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
    executors: ['bob', 'miki'],
  });
  r.approve(MemberName.of('eris'));
  r.execute(MemberName.of('bob'));
  r.completeSlice(MemberName.of('bob'), 'first close');
  assert.equal(r.executorStatus('bob'), 'completed');
  assert.throws(
    () => r.completeSlice(MemberName.of('bob'), 'second close (should throw)'),
    /already completed/,
  );
  // First attribution preserved — note unchanged.
  const rec = r.executorRecords.find((e) => e.name.value === 'bob');
  assert.equal(rec?.note, 'first close');
});

test('#294 double-close refusal: complete-then-fail on same actor throws', () => {
  // Devil review §Correctness 1: complete → fail used to silently flip
  // the slice verdict, which then drove any-fail-wave-fail.
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
    executors: ['bob', 'miki'],
  });
  r.approve(MemberName.of('eris'));
  r.execute(MemberName.of('bob'));
  r.completeSlice(MemberName.of('bob'), 'shipped');
  assert.throws(
    () => r.failSlice(MemberName.of('bob'), 'changed my mind'),
    /already completed/,
  );
  assert.equal(r.executorStatus('bob'), 'completed');
});

test('#294 double-close refusal: fail-then-complete on same actor throws', () => {
  // Devil review §Correctness 1: mirror of the above — once failed,
  // a slice cannot be re-closed as completed.
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
    executors: ['bob', 'miki'],
  });
  r.approve(MemberName.of('eris'));
  r.execute(MemberName.of('bob'));
  r.failSlice(MemberName.of('bob'), 'broke the build');
  assert.throws(
    () => r.completeSlice(MemberName.of('bob'), 'actually it works'),
    /already failed/,
  );
  assert.equal(r.executorStatus('bob'), 'failed');
});

test('#294 terminal-wave early reject: completeSlice on multi-executor wave driven terminal by a non-slice path', () => {
  // Devil review §Correctness 2 (round-2): the terminal-wave guard must
  // fire even when the slice itself is still `pending` — proving the
  // state-level guard is reached BEFORE the double-close guard. Build
  // a multi-executor record via Request.restore where the wave is
  // already terminal but one executor's slice remains `pending`. This
  // shape only occurs in pathological / hand-edited records, but it's
  // the exact scenario the terminal-state early reject was added for.
  const r = Request.restore({
    id: RequestId.generate(d, 1),
    from: MemberName.of('alice'),
    action: 'a',
    reason: 'r',
    state: 'completed',
    createdAt: '2026-05-11T00:00:00.000Z',
    executors: [
      { name: MemberName.of('bob'), status: 'completed', completedAt: '2026-05-11T00:05:00.000Z' },
      { name: MemberName.of('miki'), status: 'pending' },
    ],
    statusLog: [
      { state: 'pending', by: 'alice', at: '2026-05-11T00:00:00.000Z' },
      { state: 'approved', by: 'eris', at: '2026-05-11T00:01:00.000Z' },
      { state: 'executing', by: 'bob', at: '2026-05-11T00:02:00.000Z' },
      { state: 'completed', by: 'bob', at: '2026-05-11T00:05:00.000Z' },
    ],
    reviews: [],
  });
  // miki's slice is still 'pending' so the double-close guard would
  // NOT fire. The terminal-state guard fires first, on `state` only.
  assert.throws(
    () => r.completeSlice(MemberName.of('miki'), 'too late'),
    /request .+ is already completed; slice closure only applies on live waves/,
  );
  // Aggregate unmutated by the throw — miki still pending, log length
  // unchanged.
  assert.equal(r.executorStatus('miki'), 'pending');
  assert.equal(r.statusLog.length, 4);
});

test('#294 terminal-wave early reject — single-actor terminal wave is also refused', () => {
  // The simpler shape: wave terminal AND slice terminal. Both guards
  // fire; the state guard fires first per the implementation order,
  // so the discriminating regex from the test above applies here too.
  // Kept for coverage of the common-case attempt-twice path.
  const r = Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'a',
    reason: 'r',
    executors: ['bob'],
  });
  r.approve(MemberName.of('eris'));
  r.execute(MemberName.of('bob'));
  r.completeSlice(MemberName.of('bob'), 'done');
  assert.equal(r.state, 'completed');
  assert.throws(
    () => r.completeSlice(MemberName.of('bob'), 'after terminal'),
    /request .+ is already completed; slice closure only applies on live waves/,
  );
});
