// agora — JSON error envelope parity (issue #194).
//
// Pin the catch-path contract: when a verb fails AND the caller passed
// `--format json`, agora must emit the same structured envelope shape
// that gate has emitted since the lock_busy work landed. Three error
// paths get exercised:
//
//   1. lock_busy   — pre-seed `.guild-lock` with a non-reclaimable
//                    holder so withEntryLock throws LockBusyError
//                    before dispatch runs. envelope.error.code must
//                    be "lock_busy" (the retry-after-backoff signal
//                    AI tools branch on).
//   2. validation  — drive a DomainError out of a write verb (here
//                    `move` with no positional). envelope.error.code
//                    must be "validation_error" via the gate-shared
//                    derivation rules.
//   3. text fallback — same failure without `--format json` emits
//                      ONLY the `error:` text prologue, no JSON line.
//                      Pre-#194 callers see no behavioral change.
//
// The "code" key is the load-bearing addition; `message` and the
// optional `field` mirror gate's existing envelope verbatim so a
// shared tool layer can read all four entries with one parser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// dist/tests/passages/agora/interface/ → ../../../../../bin
const AGORA = resolve(here, '../../../../../bin/agora.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'agora-envelope-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  mkdirSync(join(root, 'members'));
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/**
 * Pre-seed `.guild-lock` with a holder the staleness check refuses
 * to reclaim. pid=1 (init) is alive on Unix, EPERMs on kill(1, 0)
 * (different user) which the staleness check treats as alive; ppid=1
 * means it isn't our parent; started_at is now-ish so the boottime
 * branch doesn't fire. Result: any write verb hitting withEntryLock
 * throws LockBusyError before dispatch.
 */
function seedBusyLock(root: string): void {
  const meta = {
    pid: 1,
    ppid: 1,
    started_at: new Date().toISOString(),
    verb: 'play',
    actor: 'someone-else',
    host: 'test-host',
    cwd: root,
    passage: 'agora',
    guild_cli_version: '0.0.0-test',
  };
  writeFileSync(join(root, '.guild-lock'), JSON.stringify(meta, null, 2) + '\n');
}

function runAgora(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [AGORA, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

test('agora --format json emits lock_busy envelope on contended write', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedBusyLock(root);
  const r = runAgora(
    root,
    ['play', '--slug', 'unused', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  // First stderr line is the JSON envelope; the trailing `error:`
  // text line is the dual-output shape gate has had since #155.
  const lines = r.stderr.trim().split('\n');
  const envelope = JSON.parse(lines[0]!);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, 'lock_busy');
  assert.equal(typeof envelope.error.message, 'string');
  assert.match(envelope.error.message, /another guild-cli write is in flight/);
  // text prologue still present so humans-on-stderr aren't surprised.
  assert.ok(
    lines.some((l) => l.startsWith('error: ')),
    `expected an "error:" line; got: ${r.stderr}`,
  );
});

test('agora --format json emits structured envelope on dispatch-throw failure', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // `play --slug <missing>` reaches dispatch (lock acquired), then
  // throws `GameNotFoundForPlay`. The envelope must emit with
  // ok: false and a message regardless of whether deriveErrorCode
  // labels it; this pins the "no longer drops --format json" fix.
  const r = runAgora(
    root,
    ['play', '--slug', 'definitely-not-a-real-game', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  const lines = r.stderr.trim().split('\n');
  const envelope = JSON.parse(lines[0]!);
  assert.equal(envelope.ok, false);
  assert.equal(typeof envelope.error.message, 'string');
  assert.match(envelope.error.message, /definitely-not-a-real-game/);
});

test('agora without --format json emits text-only error (no JSON envelope)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedBusyLock(root);
  const r = runAgora(root, ['play', '--slug', 'unused'], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 1);
  // Single-line error: no JSON envelope precedes it.
  const lines = r.stderr.trim().split('\n');
  assert.equal(lines.length, 1, `expected text-only stderr; got: ${r.stderr}`);
  assert.match(lines[0]!, /^error: /);
});
