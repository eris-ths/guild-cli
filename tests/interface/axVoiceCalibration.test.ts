import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, runGate, rid } from './_axHelpers.js';

// ── voice calibration: Two-Persona Devil gets a memory ──────────

test('voices --with-calibration: aligns verdicts against terminal outcomes', () => {
  // Carol files sharp concerns on things that later fail — her
  // devil-lense calibration should read as "trusted". Bob rubber-
  // stamps ok on things that fail — "learning".
  const { root, cleanup } = bootstrap();
  try {
    // Register carol (only alice + bob exist in the bootstrap).
    const r = runGate(root, ['register', '--name', 'carol']);
    assert.equal(r.status, 0);

    // 7 lifecycles: 4 failed + 3 completed. Bob always ok, carol
    // rejects failures and oks completions.
    const outcomes: Array<['completed' | 'failed', number]> = [
      ['completed', 1], ['failed', 2], ['failed', 3], ['completed', 4],
      ['failed', 5], ['failed', 6], ['completed', 7],
    ];
    for (const [state, n] of outcomes) {
      const id = rid(n);
      runGate(
        root,
        ['request', '--from', 'alice', '--action', `t${n}`, '--reason', 'r', '--executors', 'alice'],
        { GUILD_ACTOR: 'alice' },
      );
      runGate(root, ['approve', id, '--by', 'alice']);
      runGate(root, ['execute', id, '--by', 'alice']);
      if (state === 'completed') {
        runGate(root, ['complete', id, '--by', 'alice']);
      } else {
        runGate(root, ['fail', id, '--by', 'alice', '--reason', 'nope']);
      }
      runGate(root, [
        'review', id, '--by', 'bob', '--lense', 'devil', '--verdict', 'ok', '--comment', 'b',
      ]);
      const carolV = state === 'completed' ? 'ok' : 'reject';
      runGate(root, [
        'review', id, '--by', 'carol', '--lense', 'devil', '--verdict', carolV, '--comment', 'c',
      ]);
    }

    const { stdout: carolJson } = runGate(
      root,
      ['voices', 'carol', '--format', 'json', '--with-calibration'],
      { GUILD_ACTOR: 'alice' },
    );
    const carol = JSON.parse(carolJson).calibration;
    assert.equal(carol.by_lens.devil.status, 'trusted');
    assert.equal(carol.by_lens.devil.aligned, 7);
    assert.equal(carol.by_lens.devil.missed, 0);

    const { stdout: bobJson } = runGate(
      root,
      ['voices', 'bob', '--format', 'json', '--with-calibration'],
      { GUILD_ACTOR: 'alice' },
    );
    const bob = JSON.parse(bobJson).calibration;
    assert.equal(bob.by_lens.devil.status, 'learning');
    assert.equal(bob.by_lens.devil.aligned, 3);
    assert.equal(bob.by_lens.devil.missed, 4);
  } finally {
    cleanup();
  }
});

test('voices: self-view hides calibration (no self-optimisation)', () => {
  // Voter shouldn't see their own score — the calibration only lands
  // when viewing OTHER voices. Keeps the signal honest (if you can't
  // see it, you can't game it).
  const { root, cleanup } = bootstrap();
  try {
    // Seed one review so there's data to hide.
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r'],
      { GUILD_ACTOR: 'alice' },
    );
    runGate(root, [
      'review', rid(1), '--by', 'bob', '--lense', 'devil', '--verdict', 'ok', '--comment', 'b',
    ]);

    // bob views himself: calibration block NOT rendered in text.
    const selfText = runGate(root, ['voices', 'bob', '--format', 'text'], { GUILD_ACTOR: 'bob' });
    assert.equal(/calibration/.test(selfText.stdout), false);

    // alice views bob: calibration block IS present (or at least the
    // footer header renders, even if sample count is low).
    const viewText = runGate(root, ['voices', 'bob', '--format', 'text'], { GUILD_ACTOR: 'alice' });
    assert.match(viewText.stdout, /calibration/);

    // JSON path: self-view returns null calibration under the flag.
    const selfJson = runGate(
      root,
      ['voices', 'bob', '--format', 'json', '--with-calibration'],
      { GUILD_ACTOR: 'bob' },
    );
    const payload = JSON.parse(selfJson.stdout);
    assert.equal(payload.calibration, null);
  } finally {
    cleanup();
  }
});

test('voices: default JSON shape unchanged (backward compat)', () => {
  // `--with-calibration` is opt-in; without it, the JSON remains an
  // array of utterances so existing consumers don't break.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout } = runGate(root, ['voices', 'alice', '--format', 'json']);
    const payload = JSON.parse(stdout);
    assert.ok(Array.isArray(payload), 'default JSON should still be an array');
  } finally {
    cleanup();
  }
});

test('voices calibration: samples < 5 reads as "uncalibrated"', () => {
  // Noise floor: a handful of verdicts isn't signal. Show the count
  // so a reader sees where we are on the ramp, but don't claim a
  // status from incomplete data.
  const { root, cleanup } = bootstrap();
  try {
    for (let n = 1; n <= 3; n++) {
      runGate(
        root,
        ['fast-track', '--from', 'alice', '--action', `t${n}`, '--reason', 'r'],
        { GUILD_ACTOR: 'alice' },
      );
      runGate(root, [
        'review', rid(n), '--by', 'bob', '--lense', 'devil', '--verdict', 'ok', '--comment', 'b',
      ]);
    }
    const { stdout } = runGate(
      root,
      ['voices', 'bob', '--format', 'json', '--with-calibration'],
      { GUILD_ACTOR: 'alice' },
    );
    const calib = JSON.parse(stdout).calibration;
    assert.equal(calib.by_lens.devil.status, 'uncalibrated');
    assert.equal(calib.by_lens.devil.sample_count, 3);
    assert.equal(calib.by_lens.devil.alignment, null);
  } finally {
    cleanup();
  }
});

test('voices calibration: verdict=concern + state=failed counts as aligned', () => {
  // Pre-fix this case was excluded entirely — the source-code
  // header documented `concern + failed → aligned` but the
  // implementation had `// verdict === 'concern' intentionally
  // excluded`. Reviewers who used `concern` as their primary
  // signal got zero credit and registered as uncalibrated forever.
  // This test pins the contract directly so the documented v1
  // alignment rules can't quietly drift again.
  const { root, cleanup } = bootstrap();
  try {
    runGate(root, ['register', '--name', 'carol']);
    // 5 cycles, all failures, carol flags `concern` on each. Pre-
    // fix: 0 samples (uncalibrated). Post-fix: 5 aligned, trusted.
    for (let n = 1; n <= 5; n++) {
      const id = rid(n);
      runGate(
        root,
        ['request', '--from', 'alice', '--action', `t${n}`, '--reason', 'r', '--executors', 'alice'],
        { GUILD_ACTOR: 'alice' },
      );
      runGate(root, ['approve', id, '--by', 'alice']);
      runGate(root, ['execute', id, '--by', 'alice']);
      runGate(root, ['fail', id, '--by', 'alice', '--reason', 'nope']);
      runGate(root, [
        'review', id, '--by', 'carol',
        '--lense', 'devil', '--verdict', 'concern', '--comment', 'flagged',
      ]);
    }
    const { stdout } = runGate(
      root,
      ['voices', 'carol', '--format', 'json', '--with-calibration'],
      { GUILD_ACTOR: 'alice' },
    );
    const calib = JSON.parse(stdout).calibration;
    assert.equal(calib.by_lens.devil.aligned, 5);
    assert.equal(calib.by_lens.devil.missed, 0);
    assert.equal(calib.by_lens.devil.sample_count, 5);
    assert.equal(calib.by_lens.devil.status, 'trusted');
  } finally {
    cleanup();
  }
});

test('voices calibration: verdict=concern + state=completed stays excluded (soft)', () => {
  // The other concern branch — concern+completed = "soft", neither
  // a win nor a miss. The header rationale: the work landed, which
  // is consistent with "concern was noted and addressed" AND with
  // "concern was overblown" — counting it either way would bias
  // the score. Excluded from sample_count entirely.
  //
  // Pre-fix this was already the de-facto behaviour (because ALL
  // concerns were excluded). Post-fix, concern+failed counts as
  // aligned but concern+completed must stay excluded — pin that
  // boundary so a future "count all concerns somehow" refactor
  // doesn't quietly change the soft semantic.
  const { root, cleanup } = bootstrap();
  try {
    runGate(root, ['register', '--name', 'carol']);
    // 5 cycles, all completed, carol's concerns. Expected: 0 samples
    // (all soft, all excluded), uncalibrated.
    for (let n = 1; n <= 5; n++) {
      const id = rid(n);
      runGate(
        root,
        ['request', '--from', 'alice', '--action', `t${n}`, '--reason', 'r', '--executors', 'alice'],
        { GUILD_ACTOR: 'alice' },
      );
      runGate(root, ['approve', id, '--by', 'alice']);
      runGate(root, ['execute', id, '--by', 'alice']);
      runGate(root, ['complete', id, '--by', 'alice']);
      runGate(root, [
        'review', id, '--by', 'carol',
        '--lense', 'devil', '--verdict', 'concern', '--comment', 'noted',
      ]);
    }
    const { stdout } = runGate(
      root,
      ['voices', 'carol', '--format', 'json', '--with-calibration'],
      { GUILD_ACTOR: 'alice' },
    );
    const calib = JSON.parse(stdout).calibration;
    // The bucket exists (it's created on first sight of any verdict
    // for the lense) but soft verdicts don't increment aligned or
    // missed — sample_count stays 0 and status reads as uncalibrated.
    // The boundary we're pinning: soft does NOT bias the score.
    const devil = calib.by_lens.devil;
    assert.ok(devil, 'devil bucket should exist for the touched lense');
    assert.equal(devil.aligned, 0);
    assert.equal(devil.missed, 0);
    assert.equal(devil.sample_count, 0);
    assert.equal(devil.status, 'uncalibrated');
  } finally {
    cleanup();
  }
});

