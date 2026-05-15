// #346 — gate swarm-status regression suite.
//
// Acceptance per the issue / design comment:
//   - returns one envelope composing wave-status across active waves
//   - --orchestrating scopes to waves authored by <actor>
//   - --for scopes to waves where <actor> participates (executor /
//     auto-review / with-partner / author)
//   - GUILD_ACTOR fallback applies orchestrating=$GUILD_ACTOR with
//     scope.for_source="env"
//   - alerts array surfaces stale_executor / overlapping_target /
//     attribution_risk with per-wave entries
//   - text and json formats both work; non-zero scope is reflected in
//     scope echo

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function runGate(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? -1 };
}

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-swarm-status-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
  );
  mkdirSync(join(root, 'members'));
  for (const name of ['alice', 'bob', 'critic']) {
    writeFileSync(
      join(root, 'members', `${name}.yaml`),
      `name: ${name}\ncategory: professional\nactive: true\n`,
    );
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function extractRequestId(output: string): string {
  const m = output.match(/\d{4}-\d{2}-\d{2}-\d{4}/);
  if (!m) throw new Error(`could not find request id in output: ${output}`);
  return m[0];
}

// -------------------- empty content_root --------------------

test('#346: swarm-status on empty content_root returns zero active waves', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['swarm-status', '--format', 'json']);
  assert.equal(r.status, 0, r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.summary.active_waves, 0);
  assert.equal(payload.summary.distinct_executors, 0);
  assert.equal(payload.summary.alerts, 0);
  assert.deepEqual(payload.waves, []);
  assert.deepEqual(payload.alerts, []);
});

// -------------------- one wave, default scope --------------------

test('#346: swarm-status surfaces one active wave with executor in JSON', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const created = runGate(root, [
    'request',
    '--from', 'alice',
    '--executors', 'alice,bob',
    '--action', 'paired work',
    '--reason', 'two executors',
  ]);
  const id = extractRequestId(created.stdout + created.stderr);
  runGate(root, ['approve', id, '--by', 'eris']);

  const r = runGate(root, ['swarm-status', '--format', 'json']);
  assert.equal(r.status, 0, r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.summary.active_waves, 1);
  assert.equal(payload.summary.distinct_executors, 2);
  assert.equal(payload.waves.length, 1);
  assert.equal(payload.waves[0].id, id);
  assert.equal(payload.waves[0].from, 'alice');
  assert.equal(payload.waves[0].state, 'approved');
  const execNames = payload.waves[0].executors.map((e: { name: string }) => e.name).sort();
  assert.deepEqual(execNames, ['alice', 'bob']);
});

// -------------------- --orchestrating filter --------------------

test('#346: --orchestrating filters to waves authored by the actor', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // Two waves, different authors.
  const a = runGate(root, [
    'request', '--from', 'alice', '--executors', 'alice',
    '--action', 'alice work', '--reason', 'a',
  ]);
  const idA = extractRequestId(a.stdout + a.stderr);
  runGate(root, ['approve', idA, '--by', 'eris']);
  const b = runGate(root, [
    'request', '--from', 'bob', '--executors', 'bob',
    '--action', 'bob work', '--reason', 'b',
  ]);
  const idB = extractRequestId(b.stdout + b.stderr);
  runGate(root, ['approve', idB, '--by', 'eris']);

  const r = runGate(root, [
    'swarm-status', '--orchestrating', 'alice', '--format', 'json',
  ]);
  assert.equal(r.status, 0, r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.summary.active_waves, 1);
  assert.equal(payload.waves[0].id, idA);
  assert.equal(payload.scope.orchestrating, 'alice');
});

// -------------------- --for filter --------------------

test('#346: --for filters to waves where actor participates', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const a = runGate(root, [
    'request', '--from', 'alice', '--executors', 'bob',
    '--action', 'work', '--reason', 'r',
  ]);
  const idA = extractRequestId(a.stdout + a.stderr);
  runGate(root, ['approve', idA, '--by', 'eris']);
  const b = runGate(root, [
    'request', '--from', 'alice', '--executors', 'critic',
    '--action', 'other', '--reason', 'r',
  ]);
  const idB = extractRequestId(b.stdout + b.stderr);
  runGate(root, ['approve', idB, '--by', 'eris']);

  const r = runGate(root, ['swarm-status', '--for', 'bob', '--format', 'json']);
  assert.equal(r.status, 0, r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.summary.active_waves, 1);
  assert.equal(payload.waves[0].id, idA);
  assert.equal(payload.scope.for, 'bob');
});

// -------------------- GUILD_ACTOR env fallback --------------------

test('#346: GUILD_ACTOR fallback applies orchestrating with for_source=env', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const a = runGate(root, [
    'request', '--from', 'alice', '--executors', 'alice',
    '--action', 'work', '--reason', 'r',
  ]);
  const idA = extractRequestId(a.stdout + a.stderr);
  runGate(root, ['approve', idA, '--by', 'eris']);

  const r = runGate(
    root,
    ['swarm-status', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.scope.orchestrating, 'alice');
  assert.equal(payload.scope.for_source, 'env');
});

// -------------------- text format --------------------

test('#346: text format renders summary line and wave list', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const a = runGate(root, [
    'request', '--from', 'alice', '--executors', 'alice,bob',
    '--action', 'work', '--reason', 'r',
  ]);
  const id = extractRequestId(a.stdout + a.stderr);
  runGate(root, ['approve', id, '--by', 'eris']);

  const r = runGate(root, ['swarm-status', '--format', 'text']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /swarm picture as of /);
  assert.match(r.stdout, /1 active wave\(s\)/);
  assert.match(r.stdout, /2 distinct executor\(s\)/);
  assert.match(r.stdout, /waves:/);
  assert.match(r.stdout, new RegExp(id));
});

// -------------------- terminal states excluded --------------------

test('#346: completed waves are excluded (active states only)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const a = runGate(root, [
    'request', '--from', 'alice', '--executors', 'alice',
    '--action', 'work', '--reason', 'r',
  ]);
  const idA = extractRequestId(a.stdout + a.stderr);
  runGate(root, ['approve', idA, '--by', 'eris']);
  runGate(root, ['execute', idA, '--by', 'alice']);
  runGate(root, ['complete', idA, '--by', 'alice']);

  const r = runGate(root, ['swarm-status', '--format', 'json']);
  assert.equal(r.status, 0, r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.summary.active_waves, 0);
});

// -------------------- unknown flag rejection --------------------

test('#346: unknown flag rejected (schema-as-contract drift guard)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['swarm-status', '--bogus', 'x']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown flag.*bogus/);
});

// -------------------- legacy / no-executor rendering --------------------

test('#346: waves with no executors render on a single line + summary hint fires', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // Two pending waves, both without executors (the pre-#230 / freshly-
  // filed-pending shape).
  for (let i = 0; i < 2; i += 1) {
    runGate(root, [
      'request', '--from', 'alice',
      '--action', `work ${i}`, '--reason', 'r',
    ]);
  }
  const r = runGate(root, ['swarm-status', '--format', 'text']);
  assert.equal(r.status, 0, r.stderr);
  // Summary-line hint surfaces the "this looks like swarm but isn't" case.
  assert.match(r.stdout, /no executor-stamped activity/);
  // Single-line rendering: each wave line ends with "(no executors)" and
  // there is no separate indented "(no executors assigned)" sub-line.
  assert.match(r.stdout, /\(no executors\)/);
  assert.doesNotMatch(r.stdout, /\(no executors assigned\)/);
});
