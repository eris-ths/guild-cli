import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, runGate, rid } from './_axHelpers.js';

// ── gate thank: cross-actor appreciation primitive ──────────────

test('thank: records appreciation with by/to/reason on the request', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { status } = runGate(
      root,
      ['thank', 'bob', '--for', rid(1), '--reason', 'nice work'],
      { GUILD_ACTOR: 'alice' },
    );
    assert.equal(status, 0);
    const { stdout } = runGate(root, ['show', rid(1), '--fields', 'thanks']);
    const payload = JSON.parse(stdout);
    assert.equal(payload.thanks.length, 1);
    assert.equal(payload.thanks[0].by, 'alice');
    assert.equal(payload.thanks[0].to, 'bob');
    assert.equal(payload.thanks[0].reason, 'nice work');
    assert.equal(typeof payload.thanks[0].at, 'string');
  } finally {
    cleanup();
  }
});

test('thank: does NOT affect state or reviews (orthogonal record)', () => {
  // Critical invariant: thanks is NOT a state transition and does
  // NOT feed calibration. Keep these concerns orthogonal.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r'],
      { GUILD_ACTOR: 'alice' },
    );
    runGate(root, ['thank', 'alice', '--for', rid(1), '--reason', 'ty'], {
      GUILD_ACTOR: 'alice',
    });
    const { stdout } = runGate(root, ['show', rid(1)]);
    const p = JSON.parse(stdout);
    assert.equal(p.state, 'completed');
    assert.equal(p.reviews.length, 0);
    assert.equal(p.thanks.length, 1);
  } finally {
    cleanup();
  }
});

test('thank: reason is optional', () => {
  // Most of the time the fact of the thank is the signal; a reason
  // is a grace note. The schema doesn't require it.
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { status } = runGate(root, ['thank', 'bob', '--for', rid(1)], {
      GUILD_ACTOR: 'alice',
    });
    assert.equal(status, 0);
    const { stdout } = runGate(root, ['show', rid(1), '--fields', 'thanks']);
    const thanks = JSON.parse(stdout).thanks;
    assert.equal(thanks[0].reason, undefined);
  } finally {
    cleanup();
  }
});

test('thank: self-thank emits stderr notice but succeeds', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r'],
      { GUILD_ACTOR: 'alice' },
    );
    const { status, stderr } = runGate(
      root,
      ['thank', 'alice', '--for', rid(1), '--reason', 'past me'],
      { GUILD_ACTOR: 'alice' },
    );
    assert.equal(status, 0);
    assert.match(stderr, /self-thank/);
  } finally {
    cleanup();
  }
});

test('thank: unknown --to actor fails with a validation error', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r'],
      { GUILD_ACTOR: 'alice' },
    );
    const { status, stderr } = runGate(
      root,
      ['thank', 'ghost', '--for', rid(1)],
      { GUILD_ACTOR: 'alice' },
    );
    assert.equal(status, 1);
    assert.match(stderr, /ghost/);
  } finally {
    cleanup();
  }
});

test('thank --dry-run: preview without persist', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(
      root,
      ['fast-track', '--from', 'alice', '--action', 'x', '--reason', 'r', '--executors', 'bob'],
      { GUILD_ACTOR: 'alice' },
    );
    const { stdout, status } = runGate(
      root,
      ['thank', 'bob', '--for', rid(1), '--reason', 'preview', '--dry-run'],
      { GUILD_ACTOR: 'alice' },
    );
    assert.equal(status, 0);
    const p = JSON.parse(stdout);
    assert.equal(p.dry_run, true);
    assert.equal(p.verb, 'thank');
    assert.equal(p.preview.thanks.length, 1);
    // Real record has no thanks yet.
    const after = JSON.parse(
      runGate(root, ['show', rid(1)]).stdout,
    );
    assert.ok(after.thanks === undefined || after.thanks.length === 0);
  } finally {
    cleanup();
  }
});

