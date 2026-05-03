// gate `list` and `pending`: --format json|text contract.
//
// Pre-fix, neither verb accepted --format — text-only output, breaking
// the asymmetry vs every other gate read verb (board / status / voices
// / tail / show / why / summarize). Surfaced by the post-merge
// bird's-eye check report on 2026-05-03; PR adds the JSON envelope.
//
// JSON shape mirrors board's `_meta` convention:
//   {
//     requests: [<request.toJSON()>...],
//     _meta: { state, verb, filter? }
//   }
// `_meta.filter` is omitted when no filter applied.

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
  const root = mkdtempSync(join(tmpdir(), 'guild-list-pending-format-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  for (const dir of ['members', 'requests', 'issues', 'inbox']) {
    mkdirSync(join(root, dir));
  }
  for (const name of ['alice', 'bob']) {
    writeFileSync(
      join(root, 'members', `${name}.yaml`),
      `name: ${name}\ncategory: professional\nactive: true\n`,
    );
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runGate(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], {
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

function seedTwoPending(root: string): void {
  for (const action of ['fix one', 'fix two']) {
    runGate(
      root,
      [
        'request',
        '--from', 'alice',
        '--action', action,
        '--reason', 'r',
      ],
      {},
    );
  }
}

// ---- list ----

test('gate list --format json emits {requests, _meta} envelope', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedTwoPending(root);
  const r = runGate(
    root,
    ['list', '--state', 'pending', '--format', 'json'],
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.ok(Array.isArray(payload.requests), 'requests must be an array');
  assert.equal(payload.requests.length, 2);
  // Each request entry is a full Request.toJSON()
  for (const req of payload.requests) {
    assert.ok(req.id);
    assert.equal(req.state, 'pending');
    assert.equal(req.from, 'alice');
  }
  // _meta carries state + verb (always present)
  assert.equal(payload._meta.state, 'pending');
  assert.equal(payload._meta.verb, 'list');
  // No filter applied → no _meta.filter
  assert.equal(payload._meta.filter, undefined);
});

test('gate list --format json with --from filter echoes filter in _meta', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedTwoPending(root);
  const r = runGate(
    root,
    ['list', '--state', 'pending', '--from', 'alice', '--format', 'json'],
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.requests.length, 2);
  assert.equal(payload._meta.filter.from, 'alice');
});

test('gate list --format json with empty result returns empty requests array', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // No seed — state is empty.
  const r = runGate(
    root,
    ['list', '--state', 'pending', '--format', 'json'],
  );
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.deepEqual(payload.requests, []);
  assert.equal(payload._meta.state, 'pending');
});

test('gate list --format text preserves prior text behavior', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedTwoPending(root);
  const r = runGate(
    root,
    ['list', '--state', 'pending', '--format', 'text'],
  );
  assert.equal(r.status, 0);
  // Text output has no JSON envelope, just the per-request lines.
  assert.doesNotMatch(r.stdout, /^\{/);
  assert.match(r.stdout, /fix one/);
  assert.match(r.stdout, /fix two/);
});

test('gate list (no --format) defaults to text', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedTwoPending(root);
  const r = runGate(
    root,
    ['list', '--state', 'pending'],
  );
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /^\{/);
});

test('gate list --format invalid is rejected', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(
    root,
    ['list', '--state', 'pending', '--format', 'yaml'],
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--format must be 'json' or 'text'/);
});

// ---- pending ----

test('gate pending --format json emits the same envelope, with _meta.verb=pending', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedTwoPending(root);
  const r = runGate(root, ['pending', '--format', 'json']);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.requests.length, 2);
  assert.equal(payload._meta.state, 'pending');
  assert.equal(payload._meta.verb, 'pending');
  assert.equal(payload._meta.filter, undefined);
});

test('gate pending --format json with --for filter echoes filter source', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedTwoPending(root);
  const r = runGate(
    root,
    ['pending', '--for', 'alice', '--format', 'json'],
  );
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload._meta.filter.for, 'alice');
  assert.equal(payload._meta.filter.for_source, '--for');
});

test('gate pending --format json with GUILD_ACTOR scopes and reports source', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedTwoPending(root);
  const r = runGate(
    root,
    ['pending', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload._meta.filter.for, 'alice');
  assert.equal(payload._meta.filter.for_source, 'GUILD_ACTOR');
});

test('gate pending --format text preserves prior text behavior', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedTwoPending(root);
  const r = runGate(root, ['pending', '--format', 'text']);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /^\{/);
  assert.match(r.stdout, /fix one/);
});

test('gate pending --format invalid is rejected', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['pending', '--format', 'yaml']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--format must be 'json' or 'text'/);
});

// ---- still-rejects-unknown-flags after the format addition ----

test('gate list still rejects unknown flags (format addition is targeted)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(
    root,
    ['list', '--state', 'pending', '--bogus-flag-xyz', 'x'],
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown flag/i);
});

test('gate pending still rejects unknown flags (format addition is targeted)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['pending', '--bogus-flag-xyz', 'x']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown flag/i);
});
