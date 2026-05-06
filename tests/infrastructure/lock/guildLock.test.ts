// guildLock — infrastructure tests.
//
// Verifies the lock primitive's contract:
//   1. competing acquire while held → LockBusyError
//   2. successful run unlinks the lock in `finally` (success path)
//   3. throwing fn unlinks the lock in `finally` (failure path)
//   4. dead-pid stale lock is reclaimed automatically
//   5. GUILD_LOCK_MAX_AGE_MS expiry triggers age-based reclaim
//   6. lock metadata JSON has the expected shape

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  withGuildLock,
  LockBusyError,
} from '../../../src/infrastructure/lock/guildLock.js';

function makeRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-cli-lock-'));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const META = { passage: 'gate', verb: 'request', actor: 'eris' };

test('withGuildLock: competing acquire throws LockBusyError', async () => {
  const { root, cleanup } = makeRoot();
  try {
    let inner: unknown = null;
    await withGuildLock(
      { contentRoot: root },
      META,
      async () => {
        // While holding the lock, a second acquire on the same path
        // must surface as LockBusyError. We intentionally use a verb
        // distinct from the outer holder so the holder metadata
        // returned in the error is distinguishable.
        try {
          await withGuildLock(
            { contentRoot: root },
            { passage: 'gate', verb: 'approve', actor: 'noir' },
            async () => 'should-not-run',
          );
        } catch (e) {
          inner = e;
        }
      },
    );
    assert.ok(
      inner instanceof LockBusyError,
      `expected LockBusyError, got ${String(inner)}`,
    );
    if (inner instanceof LockBusyError) {
      assert.equal(inner.holder?.verb, 'request');
      assert.equal(inner.holder?.actor, 'eris');
      assert.equal(inner.holder?.passage, 'gate');
    }
  } finally {
    cleanup();
  }
});

test('withGuildLock: unlinks on success', async () => {
  const { root, cleanup } = makeRoot();
  try {
    const result = await withGuildLock({ contentRoot: root }, META, async () => 42);
    assert.equal(result, 42);
    assert.equal(
      existsSync(join(root, '.guild-lock')),
      false,
      'lock should be released after fn completes',
    );
  } finally {
    cleanup();
  }
});

test('withGuildLock: unlinks on fn failure', async () => {
  const { root, cleanup } = makeRoot();
  try {
    let caught: unknown = null;
    try {
      await withGuildLock({ contentRoot: root }, META, async () => {
        throw new Error('boom');
      });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof Error);
    assert.equal((caught as Error).message, 'boom');
    assert.equal(
      existsSync(join(root, '.guild-lock')),
      false,
      'lock should be released even when fn throws',
    );
  } finally {
    cleanup();
  }
});

test('withGuildLock: reclaims a dead-pid stale lock', async () => {
  const { root, cleanup } = makeRoot();
  try {
    // Pre-write a lock owned by an obviously-dead pid. We pick a
    // value sufficiently far above the typical pid range that
    // kill(pid, 0) will reliably return ESRCH on every supported OS.
    // (The reclaim safety valve refuses to touch our pid or ppid;
    // adding 999_999 puts us well outside that ancestry.)
    const deadPid = process.pid + 999_999;
    const fakeHolder = {
      pid: deadPid,
      ppid: 1,
      started_at: new Date().toISOString(),
      verb: 'stale',
      actor: 'ghost',
      host: 'old-host',
      cwd: '/tmp',
      passage: 'gate',
      guild_cli_version: '0.0.0',
    };
    writeFileSync(
      join(root, '.guild-lock'),
      JSON.stringify(fakeHolder, null, 2) + '\n',
      'utf8',
    );
    // Acquisition should reclaim the stale lock and run fn cleanly.
    const result = await withGuildLock(
      { contentRoot: root },
      META,
      async () => 'reclaimed',
    );
    assert.equal(result, 'reclaimed');
    assert.equal(existsSync(join(root, '.guild-lock')), false);
  } finally {
    cleanup();
  }
});

test('withGuildLock: GUILD_LOCK_MAX_AGE_MS triggers age-based reclaim', async () => {
  const { root, cleanup } = makeRoot();
  const prev = process.env['GUILD_LOCK_MAX_AGE_MS'];
  try {
    process.env['GUILD_LOCK_MAX_AGE_MS'] = '100';
    // Simulate a 200ms-old lock owned by some pid that *is* alive
    // (we use a pid near our own — but not our own and not ppid —
    // by picking process.pid + 2). The age branch should still
    // reclaim it because age > MAX_AGE_MS.
    //
    // Subtle: if process.pid + 2 happens to be a real live process,
    // isPidDead returns false and the only path to reclaim is the
    // age branch — which is exactly what this test exercises.
    const livePid = process.pid + 2;
    const stale = {
      pid: livePid,
      ppid: 1,
      started_at: new Date(Date.now() - 200).toISOString(),
      verb: 'old',
      actor: 'ghost',
      host: 'h',
      cwd: '/tmp',
      passage: 'gate',
      guild_cli_version: '0.0.0',
    };
    writeFileSync(
      join(root, '.guild-lock'),
      JSON.stringify(stale, null, 2) + '\n',
      'utf8',
    );
    const result = await withGuildLock(
      { contentRoot: root },
      META,
      async () => 'aged-out',
    );
    assert.equal(result, 'aged-out');
  } finally {
    if (prev === undefined) {
      delete process.env['GUILD_LOCK_MAX_AGE_MS'];
    } else {
      process.env['GUILD_LOCK_MAX_AGE_MS'] = prev;
    }
    cleanup();
  }
});

test('withGuildLock: writes metadata with the expected shape', async () => {
  const { root, cleanup } = makeRoot();
  try {
    let snapshot: Record<string, unknown> | null = null;
    await withGuildLock(
      { contentRoot: root },
      { passage: 'devil', verb: 'open', actor: 'miki' },
      async () => {
        const raw = readFileSync(join(root, '.guild-lock'), 'utf8');
        snapshot = JSON.parse(raw) as Record<string, unknown>;
      },
    );
    assert.ok(snapshot, 'metadata should have been read inside fn');
    const expected = [
      'pid',
      'ppid',
      'started_at',
      'verb',
      'actor',
      'host',
      'cwd',
      'passage',
      'guild_cli_version',
    ];
    for (const key of expected) {
      assert.ok(
        snapshot !== null && key in snapshot,
        `lock metadata missing field: ${key}`,
      );
    }
    assert.equal((snapshot as Record<string, unknown>)['verb'], 'open');
    assert.equal((snapshot as Record<string, unknown>)['actor'], 'miki');
    assert.equal((snapshot as Record<string, unknown>)['passage'], 'devil');
    assert.equal(
      (snapshot as Record<string, unknown>)['pid'],
      process.pid,
      'pid should be our own',
    );
  } finally {
    cleanup();
  }
});
