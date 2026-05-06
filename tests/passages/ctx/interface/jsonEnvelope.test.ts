// ctx — JSON error envelope parity (issue #194).
//
// Same contract as agora and devil's jsonEnvelope tests: pre-#194
// ctx's catch path silently dropped --format json and emitted only
// the text `error:` line. After #194 it shares gate's envelope shape
// via the `errorEnvelope` helper.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CTX = resolve(here, '../../../../../bin/ctx.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'ctx-envelope-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function seedBusyLock(root: string): void {
  const meta = {
    pid: 1,
    ppid: 1,
    started_at: new Date().toISOString(),
    verb: 'record',
    actor: 'someone-else',
    host: 'test-host',
    cwd: root,
    passage: 'ctx',
    guild_cli_version: '0.0.0-test',
  };
  writeFileSync(join(root, '.guild-lock'), JSON.stringify(meta, null, 2) + '\n');
}

function runCtx(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [CTX, ...args], {
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

test('ctx --format json emits lock_busy envelope on contended write', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedBusyLock(root);
  const r = runCtx(
    root,
    ['record', '--fact', 'a fact', '--format', 'json'],
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

test('ctx --format json emits structured envelope on plain-Error write failure', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // `record` without --fact surfaces a plain Error from
  // `requireOption` (not a DomainError). The envelope must still
  // emit with `ok: false` and a `message`; `code` is omitted because
  // deriveErrorCode only labels DomainErrors and message-pattern
  // matches. The shape consistency (always emit envelope on
  // --format json failure) is the load-bearing behavior, not the
  // presence of `code`.
  const r = runCtx(
    root,
    ['record', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  const lines = r.stderr.trim().split('\n');
  const envelope = JSON.parse(lines[0]!);
  assert.equal(envelope.ok, false);
  assert.equal(typeof envelope.error.message, 'string');
  assert.match(envelope.error.message, /Missing --fact/);
  // code is intentionally absent for non-DomainError + non-pattern
  // failures — tools branch on its absence as "unclassified".
  assert.equal(envelope.error.code, undefined);
});

test('ctx without --format json emits text-only error (no JSON envelope)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedBusyLock(root);
  const r = runCtx(root, ['record', '--fact', 'a fact'], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 1);
  const lines = r.stderr.trim().split('\n');
  assert.equal(lines.length, 1, `expected text-only stderr; got: ${r.stderr}`);
  assert.match(lines[0]!, /^error: /);
});
