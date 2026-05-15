// `gate execute` emits a notice when --executor was set on the
// request but the executing actor differs. Per issue #168, --executor
// is informational (not access control) — anyone may execute. The
// notice keeps the mismatch visible at the surface that did it,
// mirroring the self-approve notice on `gate approve`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-executor-mismatch-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: []\n',
  );
  mkdirSync(join(root, 'members'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(
  bin: string,
  cwd: string,
  args: string[],
  actor?: string,
): { stdout: string; stderr: string; status: number } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (actor !== undefined) env['GUILD_ACTOR'] = actor;
  else delete env['GUILD_ACTOR'];
  const r = spawnSync(process.execPath, [bin, ...args], { cwd, env, encoding: 'utf8' });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

function setupAliceBobRequest(root: string, opts: { withExecutor?: 'bob' | undefined }): string {
  run(GATE, root, ['register', '--name', 'alice']);
  run(GATE, root, ['register', '--name', 'bob']);
  const requestArgs = ['request', '--action', 'do x', '--reason', 'for y', '--format', 'json'];
  if (opts.withExecutor) requestArgs.push('--executors', opts.withExecutor);
  const r = run(GATE, root, requestArgs, 'alice');
  assert.equal(r.status, 0, `request failed: ${r.stderr}`);
  const id = (JSON.parse(r.stdout) as { id: string }).id;
  // approve before execute
  const ar = run(GATE, root, ['approve', id], 'alice');
  assert.equal(ar.status, 0, `approve failed: ${ar.stderr}`);
  return id;
}

test('gate execute: notice fires when --executor was set and actor differs', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = setupAliceBobRequest(root, { withExecutor: 'bob' });

  // alice (≠ bob) executes — notice should appear on stderr.
  const r = run(GATE, root, ['execute', id], 'alice');
  assert.equal(r.status, 0, `execute failed: ${r.stderr}`);
  assert.match(r.stdout, /✓ executing/);
  assert.match(
    r.stderr,
    /notice: alice executed request .* \(assigned to bob\); --executor records intent, not access\./,
  );
});

test('gate execute: notice silent when --executor matches the actor', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = setupAliceBobRequest(root, { withExecutor: 'bob' });

  // bob (== bob) executes — no mismatch notice.
  const r = run(GATE, root, ['execute', id], 'bob');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /✓ executing/);
  assert.equal(
    /notice:.*--executor/.test(r.stderr),
    false,
    'no mismatch notice when actor === executor',
  );
});

test('gate execute: notice silent when --executor was never set', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // No --executor on the request — there is nothing to mismatch against.
  const id = setupAliceBobRequest(root, { withExecutor: undefined });

  const r = run(GATE, root, ['execute', id], 'alice');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /✓ executing/);
  assert.equal(
    /notice:.*--executor/.test(r.stderr),
    false,
    'no notice when executor was never assigned',
  );
});
