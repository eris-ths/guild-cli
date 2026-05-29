// Issue #294 — per-executor slice closure. Extracted from the original
// Request.test.ts split; this is the self-contained #294 block (helper
// + ~25 tests) covering multi-executor wave composition, double-close
// refusal, terminal-wave early reject, and legacy-hydrate compatibility.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Request } from '../../src/domain/request/Request.js';
import { RequestId } from '../../src/domain/request/RequestId.js';
import { MemberName } from '../../src/domain/member/MemberName.js';
import { DomainError } from '../../src/domain/shared/DomainError.js';
import { d } from './_requestHelpers.js';

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
