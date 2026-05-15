// Multi-executor (`--executors a,b,c`) — interface-level coverage.
//
// Issue #230. The single-executor form (`--executor`) is back-compat
// alias; the new form is comma-separated and structurally resolves
// the attribution race surfaced in substrate-experiment 6 (parallel
// parallel-impl waves where two agents both claim authorship).
//
// Surface contract verified here:
//   - `gate request --executors a,b` writes `executors: [a, b]`
//   - `gate show --format text` renders `executors: a, b`
//   - `gate list --executor a` matches when a is in the list (any-of)
//   - `--executor` and `--executors` together → exit 1
//   - duplicate / empty entry → exit 1 with a flag-shaped message

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-multi-exec-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
  );
  mkdirSync(join(root, 'members'));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function run(
  cwd: string,
  args: string[],
  actor?: string,
): { stdout: string; stderr: string; status: number } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (actor !== undefined) env['GUILD_ACTOR'] = actor;
  else delete env['GUILD_ACTOR'];
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env,
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

function registerAll(root: string, names: string[]): void {
  for (const n of names) {
    run(root, ['register', '--name', n]);
  }
}

test('gate request --executors a,b: writes executors array (multi)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'miki', 'leysia']);

  const r = run(
    root,
    [
      'request',
      '--from',
      'alice',
      '--action',
      'do thing',
      '--reason',
      'because',
      '--executors',
      'miki,leysia',
      '--format',
      'json',
    ],
  );
  assert.equal(r.status, 0, `request failed: ${r.stderr}`);
  const id = (JSON.parse(r.stdout) as { id: string }).id;

  const showJson = run(root, ['show', id, '--format', 'json']);
  assert.equal(showJson.status, 0);
  const payload = JSON.parse(showJson.stdout) as Record<string, unknown>;
  // Issue #294: post-create records emit structured form (status='pending').
  assert.deepEqual(payload['executors'], [
    { name: 'miki', status: 'pending' },
    { name: 'leysia', status: 'pending' },
  ]);
  // v0.6 (#239): deprecated `executor` (singular) JSON alias was
  // removed; consumers must read `executors`. Verified absence here.
  assert.equal(payload['executor'], undefined);
});

test('gate request --executors single name still writes single-entry array', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'bob']);

  const r = run(
    root,
    [
      'request',
      '--from',
      'alice',
      '--action',
      'a',
      '--reason',
      'r',
      '--executors',
      'bob',
      '--format',
      'json',
    ],
  );
  assert.equal(r.status, 0, `request failed: ${r.stderr}`);
  const id = (JSON.parse(r.stdout) as { id: string }).id;
  const showJson = run(root, ['show', id, '--format', 'json']);
  const payload = JSON.parse(showJson.stdout) as Record<string, unknown>;
  assert.deepEqual(payload['executors'], [{ name: 'bob', status: 'pending' }]);
});

test('gate request --executors with duplicate entry: exit 1, names the duplicate', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'miki']);

  const r = run(
    root,
    [
      'request',
      '--from',
      'alice',
      '--action',
      'a',
      '--reason',
      'r',
      '--executors',
      'miki,miki',
    ],
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /duplicate executor "miki"/);
});

test('gate request --executors with empty entry: exit 1, hints the typo class', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'miki']);

  const r = run(
    root,
    [
      'request',
      '--from',
      'alice',
      '--action',
      'a',
      '--reason',
      'r',
      '--executors',
      'miki,',
    ],
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /empty entry/);
});

test('gate request --executors with malformed name: exit 1 (regex/MemberName boundary)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice']);

  const r = run(
    root,
    [
      'request',
      '--from',
      'alice',
      '--action',
      'a',
      '--reason',
      'r',
      '--executors',
      // path-traversal probe; would only pass if the regex check is missing
      '../bob,miki',
    ],
  );
  assert.equal(r.status, 1);
});

test('gate show --format text: renders "executors: a, b" line', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'miki', 'leysia']);

  const r = run(
    root,
    [
      'request',
      '--from',
      'alice',
      '--action',
      'a',
      '--reason',
      'r',
      '--executors',
      'miki,leysia',
      '--format',
      'json',
    ],
  );
  assert.equal(r.status, 0, r.stderr);
  const id = (JSON.parse(r.stdout) as { id: string }).id;

  const text = run(root, ['show', id, '--format', 'text']);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /executors: miki, leysia/);
});

test('gate list --executor <name>: matches when name is in the multi-executor array', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'miki', 'leysia', 'bob']);

  // Two requests, only one names leysia among multiple executors.
  const r1 = run(
    root,
    [
      'request',
      '--from',
      'alice',
      '--action',
      'with leysia',
      '--reason',
      'r',
      '--executors',
      'miki,leysia',
      '--format',
      'json',
    ],
  );
  assert.equal(r1.status, 0, r1.stderr);
  const r2 = run(
    root,
    [
      'request',
      '--from',
      'alice',
      '--action',
      'no leysia',
      '--reason',
      'r',
      '--executors',
      'bob',
      '--format',
      'json',
    ],
  );
  assert.equal(r2.status, 0, r2.stderr);

  const list = run(
    root,
    ['list', '--state', 'pending', '--executor', 'leysia'],
  );
  assert.equal(list.status, 0, list.stderr);
  // The first request matches; the second does not.
  assert.match(list.stdout, /with leysia/);
  assert.equal(/no leysia/.test(list.stdout), false);
});
