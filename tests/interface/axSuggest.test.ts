import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, runGate, rid } from './_axHelpers.js';

// ── gate suggest: tight-loop sibling of boot ─────────────────────

test('suggest --format json: returns the same triple as boot, no orientation payload', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const bootOut = JSON.parse(runGate(root, ['boot'], { GUILD_ACTOR: 'bob' }).stdout);
    const suggestOut = JSON.parse(runGate(root, ['suggest'], { GUILD_ACTOR: 'bob' }).stdout);
    // Same suggestion.
    assert.deepEqual(bootOut.suggested_next, suggestOut.suggested_next);
    // Orientation keys present in boot, absent in suggest.
    assert.ok('status' in bootOut);
    assert.ok('tail' in bootOut);
    assert.equal('status' in suggestOut, false);
    assert.equal('tail' in suggestOut, false);
    // Payload shrinks dramatically — suggest is the hot-loop form.
    const bootStr = JSON.stringify(bootOut);
    const suggestStr = JSON.stringify(suggestOut);
    assert.ok(
      suggestStr.length < bootStr.length / 3,
      `expected suggest to be <1/3 of boot, got ${suggestStr.length} vs ${bootStr.length}`,
    );
  } finally {
    cleanup();
  }
});

test('suggest: null when registered actor has nothing to do', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout } = runGate(root, ['suggest'], { GUILD_ACTOR: 'alice' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.suggested_next, null);
    // Genuine silence — no open work, no reason to surface.
    assert.equal(payload.suggested_next_reason, null);
  } finally {
    cleanup();
  }
});

test('suggest: null with substrate open-work surfaces suggested_next_reason', () => {
  // Asteria dogfood 2026-05-17: host saw status.pending.total: 1 but
  // suggested_next: null. The substrate's silence read as a bug. Fix:
  // a sibling `suggested_next_reason` names which open requests exist
  // when the suggestion ladder is empty but the substrate isn't.
  const { root, cleanup } = bootstrap();
  try {
    // Alice authors a request naming bob as executor. Host has no
    // role in the executor list, so actionableTransitions is empty
    // for the host — but `status.pending.total: 1` would still show.
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['suggest'], { GUILD_ACTOR: 'human' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.suggested_next, null);
    assert.ok(
      typeof payload.suggested_next_reason === 'string' &&
        payload.suggested_next_reason.includes('1 pending'),
      `expected reason to mention 1 pending, got: ${payload.suggested_next_reason}`,
    );
    assert.match(payload.suggested_next_reason, /none names you as executor/);
  } finally {
    cleanup();
  }
});

test('suggest: self-wave pending is counted so the reason reconciles with queues', () => {
  // dogfood 2026-05-29: an actor authored a self-wave pending (author ==
  // executor). suggested_next stayed null (the ladder won't nudge
  // self-approve — actionableTransitions requires from != actor for
  // pending-as-executor), but the null-reason skipped it while boot's
  // `queues: pending` counted it. The two surfaces disagreed (queues
  // pending=2, reason said "1 pending"). The reason now carries a
  // self-wave clause so the tallies match.
  const { root, cleanup } = bootstrap();
  try {
    // alice: self-wave (author == executor). bob: a normal wave alice
    // has no role in. Viewed as alice, neither is actionable, so
    // suggested_next is null and both must be reflected in the reason.
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'solo', '--reason', 'r', '--executors', 'alice'],
      { GUILD_ACTOR: 'alice' },
    );
    runGate(
      root,
      ['request', '--from', 'bob', '--action', 'theirs', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'bob' },
    );
    const { stdout } = runGate(root, ['suggest'], { GUILD_ACTOR: 'alice' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.suggested_next, null);
    const reason: string = payload.suggested_next_reason;
    // The not-mine clause (bob's) AND the self-wave clause (alice's)
    // both fire, so the pending tally reconciles with queues.pending=2.
    assert.match(reason, /none names you as executor/);
    assert.match(reason, /self-wave/);
    // Reconciliation: boot's queues.pending must equal the count the
    // reason accounts for. Both pending requests are acknowledged.
    const boot = JSON.parse(
      runGate(root, ['boot', '--format', 'json'], { GUILD_ACTOR: 'alice' }).stdout,
    );
    assert.equal(boot.status.pending.total, 2);
    assert.equal((reason.match(/pending/g) ?? []).length >= 2, true,
      `reason must account for both pending requests; got: ${reason}`);
  } finally {
    cleanup();
  }
});

test('suggest: a lone self-wave pending no longer goes silent', () => {
  // Regression for the silent-gap sub-case: when the ONLY open request
  // is a self-wave pending, the pre-fix null-reason returned null
  // (not-mine total was 0), so `gate suggest` said nothing while
  // `queues: pending=1` showed one — exactly the "silence reads as a
  // bug" failure the reason field exists to prevent.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'solo', '--reason', 'r', '--executors', 'alice'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['suggest'], { GUILD_ACTOR: 'alice' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.suggested_next, null);
    assert.ok(
      typeof payload.suggested_next_reason === 'string' &&
        /self-wave/.test(payload.suggested_next_reason),
      `lone self-wave pending must surface a reason; got: ${payload.suggested_next_reason}`,
    );
  } finally {
    cleanup();
  }
});

test('suggest --format text: null + reason → (nothing urgent — <reason>)', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(
      root,
      ['suggest', '--format', 'text'],
      { GUILD_ACTOR: 'human' },
    );
    assert.match(stdout, /^\(nothing urgent — /);
    assert.match(stdout, /1 pending/);
  } finally {
    cleanup();
  }
});

test('boot: suggested_next_reason field is null when suggested_next is non-null', () => {
  // When the suggest ladder picks a hint, the hint's own `reason`
  // field carries the explanation — the sibling field stays null
  // to avoid duplicate prose at the surface.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'bob' });
    const payload = JSON.parse(stdout);
    assert.ok(payload.suggested_next !== null);
    assert.equal(payload.suggested_next_reason, null);
  } finally {
    cleanup();
  }
});

test('suggest --format text: compact two-line form for humans', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['request', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(
      root,
      ['suggest', '--format', 'text'],
      { GUILD_ACTOR: 'bob' },
    );
    // Line 1: → verb arg=val arg=val
    // Line 2: the reason, indented
    const lines = stdout.trim().split('\n');
    assert.equal(lines.length, 2);
    assert.match(lines[0]!, /^→ approve/);
    assert.match(lines[0]!, /id=/);
    assert.match(lines[0]!, /by=bob/);
    assert.match(lines[1]!, /^  /);
  } finally {
    cleanup();
  }
});

