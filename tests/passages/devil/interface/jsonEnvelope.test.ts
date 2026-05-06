// devil-review — JSON error envelope parity (issue #194).
//
// Same contract as agora's jsonEnvelope test: when a verb fails AND
// the caller passed `--format json`, the catch path must emit the
// gate-shaped {ok, error: {message, code, field?}} envelope on stderr.
// Pre-#194 devil silently dropped --format json in the catch and
// emitted only the text `error:` line.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DEVIL = resolve(here, '../../../../../bin/devil.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'devil-envelope-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function seedBusyLock(root: string): void {
  // pid=1 alive + ppid=1 not-our-parent + recent started_at →
  // staleness check refuses to reclaim. See agora envelope test.
  const meta = {
    pid: 1,
    ppid: 1,
    started_at: new Date().toISOString(),
    verb: 'open',
    actor: 'someone-else',
    host: 'test-host',
    cwd: root,
    passage: 'devil',
    guild_cli_version: '0.0.0-test',
  };
  writeFileSync(join(root, '.guild-lock'), JSON.stringify(meta, null, 2) + '\n');
}

function runDevil(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [DEVIL, ...args], {
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

test('devil --format json emits lock_busy envelope on contended write', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedBusyLock(root);
  const r = runDevil(
    root,
    [
      'open', 'src/foo.ts',
      '--type', 'file',
      '--format', 'json',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  const lines = r.stderr.trim().split('\n');
  const envelope = JSON.parse(lines[0]!);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, 'lock_busy');
  assert.match(envelope.error.message, /another guild-cli write is in flight/);
  assert.ok(lines.some((l) => l.startsWith('error: ')));
});

test('devil --format json emits structured envelope on dispatch-throw failure', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // `open` against an unknown --type drives an error past the
  // lock-acquire step. The envelope must emit with ok: false and a
  // message; pinning the "no longer drops --format json" fix.
  const r = runDevil(
    root,
    [
      'open', 'src/foo.ts',
      '--type', 'not-a-real-type',
      '--format', 'json',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  const lines = r.stderr.trim().split('\n');
  const envelope = JSON.parse(lines[0]!);
  assert.equal(envelope.ok, false);
  assert.equal(typeof envelope.error.message, 'string');
});

test('devil without --format json emits text-only error (no JSON envelope)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedBusyLock(root);
  const r = runDevil(
    root,
    ['open', 'src/foo.ts', '--type', 'file'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  // The catch path emits a text `error:` line. devil also surfaces
  // `did you mean` hints for catalog-miss errors (lense / persona),
  // but lock_busy is neither, so the stderr is the bare text line.
  const lines = r.stderr.trim().split('\n');
  assert.equal(lines.length, 1, `expected text-only stderr; got: ${r.stderr}`);
  assert.match(lines[0]!, /^error: /);
});
