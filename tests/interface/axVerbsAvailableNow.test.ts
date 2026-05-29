import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, runGate, rid } from './_axHelpers.js';

// ── boot.verbs_available_now: state-aware verb discovery ────────

test('boot.verbs_available_now: actionable lists all valid transitions', () => {
  // bob has executing-by-me (0001) AND unreviewed-mine (0002). suggested_next
  // picks ONE; actionable lists ALL siblings so a branching agent sees
  // the other options.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 't1', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    runGate(root, ['approve', rid(1), '--by', 'alice']);
    runGate(root, ['execute', rid(1), '--by', 'bob']);
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 't2', '--reason', 'r', '--auto-review', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'bob' });
    const p = JSON.parse(stdout);
    const verbs = p.verbs_available_now.actionable.map(
      (a: { verb: string }) => a.verb,
    );
    assert.ok(verbs.includes('complete'), 'complete missing');
    assert.ok(verbs.includes('fail'), 'fail missing');
    assert.ok(verbs.includes('review'), 'review missing');
    // suggested_next is ONE of the actionable entries.
    assert.ok(
      verbs.includes(p.suggested_next.verb),
      'suggested_next must be in actionable list',
    );
  } finally {
    cleanup();
  }
});

test('boot.verbs_available_now: always_readable present for anonymous caller', () => {
  // Initial-agent discovery: without identity, actionable is empty
  // (can't transition anything), but always_readable still names
  // the read surface so newcomers see the map.
  const { root, cleanup } = bootstrap();
  try {
    const { stdout } = runGate(root, ['boot']);
    const p = JSON.parse(stdout);
    assert.equal(p.verbs_available_now.actionable.length, 0);
    assert.equal(p.verbs_available_now.requires_other_actor.length, 0);
    assert.ok(p.verbs_available_now.always_readable.length >= 10);
    assert.ok(p.verbs_available_now.always_readable.includes('suggest'));
    assert.ok(p.verbs_available_now.always_readable.includes('schema'));
    assert.ok(p.verbs_available_now.always_readable.includes('unresponded'));
  } finally {
    cleanup();
  }
});

test('boot.verbs_available_now: requires_other_actor surfaces pending blockers', () => {
  // 2.A: a non-host author who filed a pending request sees the
  // approval blocker — verb=approve, candidates=[host], reason
  // explains why they can't act alone. This is the gap that bit
  // first-time agents: suggested_next would return "by: host" with
  // no obvious context for why the actor's own --by wouldn't work.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'pending', '--reason', 'r', '--executors', 'alice'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'alice' });
    const p = JSON.parse(stdout);
    assert.equal(p.verbs_available_now.actionable.length, 0);
    assert.ok(
      p.verbs_available_now.requires_other_actor.length >= 1,
      'expected a pending-approval blocker for alice',
    );
    const blocker = p.verbs_available_now.requires_other_actor[0];
    assert.equal(blocker.verb, 'approve');
    assert.deepEqual(blocker.candidates, ['human']);
    assert.match(blocker.reason, /pending/i);
  } finally {
    cleanup();
  }
});

test('boot.verbs_available_now: host self-approval doesnt double-list as blocker', () => {
  // When the actor IS the host, pending requests on their own
  // record show up under actionable (pending-as-executor) — NOT
  // under requires_other_actor, since the host can self-approve.
  const { root, cleanup } = bootstrap();
  try {
    // human is the host; have human file + name self executor
    runGate(
      root,
      ['request', '--from', 'human', '--action', 'self', '--reason', 'r', '--executors', 'human'],
      { GUILD_ACTOR: 'human' },
    );
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'human' });
    const p = JSON.parse(stdout);
    assert.equal(
      p.verbs_available_now.requires_other_actor.length,
      0,
      'host should not see their own pending-approval as blocker',
    );
  } finally {
    cleanup();
  }
});

test('boot.status.unresponded: counts unresponded concerns for the actor', () => {
  // The orientation gap: an actor with concerns recorded against
  // their completed work used to see status = all-zero, then
  // separately have to remember to run `gate unresponded`. With
  // the count surfaced in boot.status, a single boot call shows
  // the concern queue exists. Same detector as `gate unresponded`,
  // so the two surfaces never disagree.
  const { root, cleanup } = bootstrap();
  try {
    // Register carol so she can review.
    runGate(root, ['register', '--name', 'carol']);

    // Lifecycle: alice files → human approves → bob executes → bob
    // completes → carol records a devil/concern verdict.
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'rushed', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const id = rid(1);
    runGate(root, ['approve', id, '--by', 'human']);
    runGate(root, ['execute', id, '--by', 'bob']);
    runGate(root, ['complete', id, '--by', 'bob']);
    runGate(root, [
      'review', id, '--by', 'carol', '--lense', 'devil',
      '--verdict', 'concern', '--comment', 'rushed',
    ]);

    const { stdout: aliceBoot } = runGate(
      root,
      ['boot'],
      { GUILD_ACTOR: 'alice' },
    );
    const alice = JSON.parse(aliceBoot);
    assert.equal(
      alice.status.unresponded,
      1,
      'alice (author) should see her unresponded concern in boot.status',
    );

    // Cross-check: gate status surfaces the same number.
    const { stdout: aliceStatus } = runGate(
      root,
      ['status', '--format', 'json'],
      { GUILD_ACTOR: 'alice' },
    );
    assert.equal(JSON.parse(aliceStatus).unresponded, 1);

    // bob (executor, not in authorship set) has no unresponded.
    const { stdout: bobBoot } = runGate(
      root,
      ['boot'],
      { GUILD_ACTOR: 'bob' },
    );
    assert.equal(JSON.parse(bobBoot).status.unresponded, 0);
  } finally {
    cleanup();
  }
});

test('boot.verbs_available_now: executor (≠author) doesnt double-list as blocker', () => {
  // When the actor is a non-host executor named on a pending request
  // they didn't author, the pending-as-executor predicate puts approve
  // into actionable. Listing the same id+verb under requires_other_actor
  // would contradict actionable for the same record — the gap a fresh
  // agent reading boot would notice immediately.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'cross', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'bob' });
    const p = JSON.parse(stdout);
    const actionable = p.verbs_available_now.actionable;
    const blockers = p.verbs_available_now.requires_other_actor;
    assert.ok(
      actionable.some(
        (a: { verb: string; id: string }) =>
          a.verb === 'approve' && a.id.startsWith('20'),
      ),
      'executor should see approve as actionable',
    );
    assert.equal(
      blockers.length,
      0,
      'executor (≠ author) should not see their own approve as a blocker',
    );
  } finally {
    cleanup();
  }
});

test('write response suggested_next carries actor_resolved', () => {
  // 2.E: the boolean lets an orchestrator branch without parsing
  // `args.by` against the env. True when args.by is absent or
  // matches GUILD_ACTOR, false otherwise.
  const { root, cleanup } = bootstrap();
  try {
    const created = runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executors', 'alice', '--format', 'json'],
      { GUILD_ACTOR: 'alice' },
    );
    const payload = JSON.parse(created.stdout);
    // Pending state suggests approve by host (human). alice is not
    // the host, so actor_resolved=false.
    assert.equal(payload.suggested_next.verb, 'approve');
    assert.equal(payload.suggested_next.args.by, 'human');
    assert.equal(payload.suggested_next.actor_resolved, false);
  } finally {
    cleanup();
  }
});

test('boot.verbs_available_now: actionable entries carry id + reason', () => {
  // The reason converts "approve exists" into "approve is valid on
  // this id because …" — teaching not just catalog.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'bob' });
    const p = JSON.parse(stdout);
    const approve = p.verbs_available_now.actionable.find(
      (a: { verb: string }) => a.verb === 'approve',
    );
    assert.ok(approve, 'approve should be actionable');
    assert.equal(approve.id, rid(1));
    assert.match(approve.reason, /pending/);
    assert.match(approve.reason, /executor/);
  } finally {
    cleanup();
  }
});

