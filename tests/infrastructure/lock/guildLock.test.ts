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
  readHolder,
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

test('withGuildLock: reclaims a lock whose started_at predates OS boot', async () => {
  // Boottime branch (PR-B): if a lock file's started_at is older
  // than the current OS uptime, the recorded pid by definition
  // cannot be the original holder regardless of whether a colliding
  // pid happens to be alive now. This test plants a lock with a
  // started_at far in the past (epoch + 1s) and a pid that *is*
  // alive (our own ppid). Without the boottime branch, the
  // ancestor-safety valve would refuse to reclaim. With it, the
  // pre-boot timestamp short-circuits the ancestor check.
  const { root, cleanup } = makeRoot();
  try {
    // Pid we know is alive AND would normally be refused by the
    // ancestor guard — pick our parent. This proves the boottime
    // branch fires BEFORE the ancestor check.
    const livePid = process.ppid;
    const ancientHolder = {
      pid: livePid,
      ppid: 1,
      // 1970-01-01T00:00:01Z — guaranteed predates any plausible
      // current boot time.
      started_at: new Date(1000).toISOString(),
      verb: 'old',
      actor: 'ghost',
      host: 'pre-boot',
      cwd: '/tmp',
      passage: 'gate',
      guild_cli_version: '0.0.0',
    };
    writeFileSync(
      join(root, '.guild-lock'),
      JSON.stringify(ancientHolder, null, 2) + '\n',
      'utf8',
    );
    const result = await withGuildLock(
      { contentRoot: root },
      META,
      async () => 'reclaimed-via-boottime',
    );
    assert.equal(result, 'reclaimed-via-boottime');
    assert.equal(existsSync(join(root, '.guild-lock')), false);
  } finally {
    cleanup();
  }
});

test('withGuildLock: does NOT reclaim when started_at is post-boot and pid is alive', async () => {
  // Inverse of the boottime test: a lock with a recent (post-boot)
  // timestamp and an alive pid (our own ppid) must NOT be reclaimed.
  // This pins the boottime branch so it doesn't accidentally green-
  // light reclaim of legitimate in-flight locks within the same
  // process tree.
  const { root, cleanup } = makeRoot();
  const prev = process.env['GUILD_LOCK_MAX_AGE_MS'];
  try {
    delete process.env['GUILD_LOCK_MAX_AGE_MS']; // disable age branch
    const liveAncestorHolder = {
      pid: process.ppid,
      ppid: 1,
      started_at: new Date().toISOString(), // post-boot
      verb: 'live',
      actor: 'parent',
      host: 'h',
      cwd: '/tmp',
      passage: 'gate',
      guild_cli_version: '0.0.0',
    };
    writeFileSync(
      join(root, '.guild-lock'),
      JSON.stringify(liveAncestorHolder, null, 2) + '\n',
      'utf8',
    );
    let caught: unknown = null;
    try {
      await withGuildLock(
        { contentRoot: root },
        META,
        async () => 'should-not-run',
      );
    } catch (e) {
      caught = e;
    }
    assert.ok(
      caught instanceof LockBusyError,
      `expected LockBusyError, got ${String(caught)}`,
    );
    // Lock file must still be on disk (we did NOT reclaim it).
    assert.equal(existsSync(join(root, '.guild-lock')), true);
  } finally {
    if (prev === undefined) delete process.env['GUILD_LOCK_MAX_AGE_MS'];
    else process.env['GUILD_LOCK_MAX_AGE_MS'] = prev;
    // Manually clean since we left the lock in place.
    cleanup();
  }
});

// #197: readHolder TOCTOU pin. The previous all-errors-to-null
// behavior conflated ENOENT (release race) with parse failure
// (corrupt file), forcing acquire to surface a confusing "unreadable
// holder" busy message instead of retrying. The discriminated union
// makes the two paths distinguishable. We only need to pin the
// ENOENT → 'gone' edge here; the corrupt path is exercised by the
// stale-recovery test below.
test('readHolder: ENOENT returns kind=gone (TOCTOU release race)', () => {
  const { root, cleanup } = makeRoot();
  try {
    // No lock file written — readHolder should report 'gone' rather
    // than 'corrupt' or null. acquire's #197 retry path depends on
    // this discriminator.
    const result = readHolder(join(root, '.guild-lock'));
    assert.equal(result.kind, 'gone');
  } finally {
    cleanup();
  }
});

// #195: malformed holder file is treated as stale. Without this,
// any unparseable .guild-lock would wedge writers indefinitely
// (readHolder returns null → not reclaimable → LockBusyError forever
// until a human deletes the file). We pre-write a single '{' so
// JSON.parse fails, then assert acquire recovers.
test('withGuildLock: corrupt holder file is treated as stale and reclaimed', async () => {
  const { root, cleanup } = makeRoot();
  try {
    writeFileSync(join(root, '.guild-lock'), '{', 'utf8');
    const result = await withGuildLock(
      { contentRoot: root },
      META,
      async () => 'recovered',
    );
    assert.equal(result, 'recovered');
    // Lock file should have been unlinked by the winner's release.
    assert.equal(existsSync(join(root, '.guild-lock')), false);
  } finally {
    cleanup();
  }
});

// #195 sibling: holder JSON is well-formed but missing the
// load-bearing `pid` field (or it's the wrong type). readHolder
// must classify this as 'corrupt' too, otherwise an attacker /
// hand-edit could neutralize the staleness check by writing a
// minimal `{}`.
test('withGuildLock: holder file with missing pid is treated as stale', async () => {
  const { root, cleanup } = makeRoot();
  try {
    writeFileSync(
      join(root, '.guild-lock'),
      JSON.stringify({ verb: 'no-pid', actor: 'x' }) + '\n',
      'utf8',
    );
    const result = await withGuildLock(
      { contentRoot: root },
      META,
      async () => 'recovered-missing-pid',
    );
    assert.equal(result, 'recovered-missing-pid');
    assert.equal(existsSync(join(root, '.guild-lock')), false);
  } finally {
    cleanup();
  }
});

// #196: when GUILD_ACTOR / .guild-actor are absent, lock metadata
// must record the explicit '(unset)' placeholder rather than an
// empty string. This is the in-process version of the assertion;
// the entry-point sites are smoke-checked indirectly via the
// existing CLI integration tests passing under the new placeholder.
test('withGuildLock: empty actor placeholder is recorded as-is', async () => {
  const { root, cleanup } = makeRoot();
  try {
    let snapshot: Record<string, unknown> | null = null;
    await withGuildLock(
      { contentRoot: root },
      { passage: 'gate', verb: 'request', actor: '(unset)' },
      async () => {
        const raw = readFileSync(join(root, '.guild-lock'), 'utf8');
        snapshot = JSON.parse(raw) as Record<string, unknown>;
      },
    );
    assert.ok(snapshot, 'metadata should have been read inside fn');
    assert.equal((snapshot as Record<string, unknown>)['actor'], '(unset)');
  } finally {
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
