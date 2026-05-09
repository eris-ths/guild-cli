// #239 — `--executor` (singular) deprecation notice.
//
// Pins the contract introduced in PR #272:
//   1. Explicit `--executor <name>` on `gate request` emits a stderr
//      notice pointing at `--executors` and announcing v0.7.0 removal.
//   2. Explicit `--executor <name>` on `gate fast-track` emits the
//      same notice.
//   3. The implicit fast-track fallback (defaulting executor to
//      `--from` when neither `--executor` nor `--executors` is given)
//      stays silent — only user-supplied values trigger the notice.
//   4. The notice rides stderr, never stdout, so `--format json`
//      consumers stay clean.

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
  const root = mkdtempSync(join(tmpdir(), 'guild-deprecation-239-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
  );
  mkdirSync(join(root, 'members'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(cwd: string, args: string[]): {
  stdout: string;
  stderr: string;
  status: number;
} {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env },
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

const NOTICE_RE = /--executor \(singular\) is deprecated.*v0\.7\.0/;

test('#239: gate request --executor (singular) emits stderr deprecation notice', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(root, ['register', '--name', 'alice']);

  const r = run(root, [
    'request',
    '--from', 'eris',
    '--action', 'do',
    '--reason', 'r',
    '--executor', 'alice',
  ]);
  assert.equal(r.status, 0, `request should still succeed: ${r.stderr}`);
  assert.match(r.stderr, NOTICE_RE);
  // JSON purity — stdout must NOT contain the notice.
  assert.equal(NOTICE_RE.test(r.stdout), false,
    `notice must not leak into stdout; got: ${r.stdout}`);
});

test('#239: gate request --executors (plural) does NOT emit the notice', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(root, ['register', '--name', 'alice']);

  const r = run(root, [
    'request',
    '--from', 'eris',
    '--action', 'do',
    '--reason', 'r',
    '--executors', 'alice',
  ]);
  assert.equal(r.status, 0, `request should succeed: ${r.stderr}`);
  assert.equal(NOTICE_RE.test(r.stderr), false,
    `--executors must not trigger the notice; got: ${r.stderr}`);
});

test('#239: gate fast-track --executor (singular) emits the notice', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(root, ['register', '--name', 'alice']);

  const r = run(root, [
    'fast-track',
    '--from', 'alice',
    '--action', 'do',
    '--reason', 'r',
    '--executor', 'alice',
  ]);
  assert.equal(r.status, 0, `fast-track should succeed: ${r.stderr}`);
  assert.match(r.stderr, NOTICE_RE);
  assert.equal(NOTICE_RE.test(r.stdout), false,
    `notice must not leak into stdout; got: ${r.stdout}`);
});

test('#239: gate fast-track without --executor stays silent (implicit fallback)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(root, ['register', '--name', 'alice']);

  // Self-execute happy path: neither --executor nor --executors. The
  // handler defaults executor to `from`. This implicit fallback MUST
  // NOT trigger the deprecation notice — we only warn on user input.
  const r = run(root, [
    'fast-track',
    '--from', 'alice',
    '--action', 'do',
    '--reason', 'r',
  ]);
  assert.equal(r.status, 0, `fast-track should succeed: ${r.stderr}`);
  assert.equal(NOTICE_RE.test(r.stderr), false,
    `implicit from-fallback must stay silent; got: ${r.stderr}`);
});
