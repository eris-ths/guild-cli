// Regression for `gate decisions` and `gate self-pattern` (eris-first
// director-role read verbs).

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
  env: NodeJS.ProcessEnv = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? -1 };
}

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-decisions-'));
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

// -------------------- decisions --------------------

test('#bC: decisions on empty substrate → entries=0, all counts zero', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['decisions', '--for', 'alice', '--format', 'json']);
  assert.equal(r.status, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.equal(p.totals.entries_counted, 0);
  assert.deepEqual(p.totals.by_transition, {
    approve: 0, deny: 0, execute: 0, complete: 0, fail: 0,
  });
  assert.equal(p.filter.actor, 'alice');
});

test('#bC: decisions reflects approve / execute / complete transitions', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const created = runGate(root, [
    'request', '--from', 'alice', '--executors', 'alice',
    '--action', 'wave 1', '--reason', 'decision test',
  ]);
  const id = extractRequestId(created.stdout + created.stderr);
  runGate(root, ['approve', id, '--by', 'critic']);
  runGate(root, ['execute', id, '--by', 'alice']);
  runGate(root, ['complete', id, '--by', 'alice', '--note', 'done']);

  // critic: 1 approve
  const cr = runGate(root, ['decisions', '--for', 'critic', '--format', 'json']);
  const cp = JSON.parse(cr.stdout);
  assert.equal(cp.totals.by_transition.approve, 1);
  assert.equal(cp.totals.by_transition.execute, 0);

  // alice: 1 execute + 1 complete
  const ar = runGate(root, ['decisions', '--for', 'alice', '--format', 'json']);
  const ap = JSON.parse(ar.stdout);
  assert.equal(ap.totals.by_transition.execute, 1);
  assert.equal(ap.totals.by_transition.complete, 1);
  assert.equal(ap.totals.by_transition.approve, 0);
});

test('#bC: decisions --for defaults to GUILD_ACTOR when flag absent', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const created = runGate(root, [
    'request', '--from', 'bob', '--executors', 'bob',
    '--action', 'default-for', '--reason', 'env default test',
  ]);
  const id = extractRequestId(created.stdout + created.stderr);
  runGate(root, ['approve', id, '--by', 'critic']);

  const r = runGate(root, ['decisions', '--format', 'json'], { GUILD_ACTOR: 'critic' });
  assert.equal(r.status, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.equal(p.filter.actor, 'critic');
  assert.equal(p.totals.by_transition.approve, 1);
});

test('#bC: decisions errors when neither --for nor GUILD_ACTOR is provided', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['decisions', '--format', 'json'], { GUILD_ACTOR: '' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--for <actor> is required/);
});

test('#bC: decisions rejects unknown flag', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['decisions', '--for', 'alice', '--bogus']);
  assert.notEqual(r.status, 0);
});

test('#bC: decisions --since rejects malformed duration', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['decisions', '--for', 'alice', '--since', '7days']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--since must match/);
});

// -------------------- self-pattern --------------------

test('#bC: self-pattern on empty substrate → zero counts, null ratios, no reviews', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['self-pattern', '--for', 'alice', '--format', 'json']);
  assert.equal(r.status, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.equal(p.decisions.total, 0);
  assert.equal(p.reviews.total, 0);
  assert.equal(p.ratios.approve_rate, null);
  assert.equal(p.ratios.ok_rate, null);
  assert.equal(p.reviews.top_lense, null);
});

test('#bC: self-pattern surfaces approve_rate + verdict distribution + top_lense', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // Two waves: critic approves one, denies one. critic also reviews
  // (layer, ok) twice and (devil, concern) once → top lense = layer.
  const r1 = runGate(root, [
    'request', '--from', 'alice', '--executors', 'alice',
    '--action', 'wave 1', '--reason', 'r1',
  ]);
  const id1 = extractRequestId(r1.stdout + r1.stderr);
  runGate(root, ['approve', id1, '--by', 'critic']);
  runGate(root, ['review', id1, '--by', 'critic', '--lense', 'layer', '--verdict', 'ok', '--note', 'ok 1']);
  runGate(root, ['review', id1, '--by', 'critic', '--lense', 'layer', '--verdict', 'ok', '--note', 'ok 2']);
  runGate(root, ['review', id1, '--by', 'critic', '--lense', 'devil', '--verdict', 'concern', '--note', 'concern 1']);

  const r2 = runGate(root, [
    'request', '--from', 'alice', '--executors', 'alice',
    '--action', 'wave 2', '--reason', 'r2',
  ]);
  const id2 = extractRequestId(r2.stdout + r2.stderr);
  runGate(root, ['deny', id2, '--by', 'critic', '--reason', 'no']);

  const r = runGate(root, ['self-pattern', '--for', 'critic', '--format', 'json']);
  assert.equal(r.status, 0, r.stderr);
  const p = JSON.parse(r.stdout);

  assert.equal(p.decisions.by_transition.approve, 1);
  assert.equal(p.decisions.by_transition.deny, 1);
  assert.equal(p.ratios.approve_rate, 0.5);

  assert.equal(p.reviews.total, 3);
  assert.equal(p.reviews.by_verdict.ok, 2);
  assert.equal(p.reviews.by_verdict.concern, 1);
  assert.equal(p.ratios.ok_rate, 2 / 3);
  assert.equal(p.reviews.top_lense, 'layer');
});

test('#bC: self-pattern hint references gate lense-stats for full breakdown', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['self-pattern', '--for', 'alice', '--since', '24h', '--format', 'json']);
  const p = JSON.parse(r.stdout);
  assert.match(p.hint, /gate lense-stats --for alice --since 24h/);
});

test('#bC: self-pattern defaults --for to GUILD_ACTOR', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['self-pattern', '--format', 'json'], {
    GUILD_ACTOR: 'critic',
  });
  assert.equal(r.status, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.equal(p.filter.actor, 'critic');
});

test('#bC: self-pattern errors when no actor resolved', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['self-pattern', '--format', 'json'], { GUILD_ACTOR: '' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--for <actor> is required/);
});

test('#bC: self-pattern text format renders decisions + reviews + hint', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['self-pattern', '--for', 'alice', '--format', 'text']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /self-pattern\s+actor=alice/);
  assert.match(r.stdout, /decisions \(0\)/);
  assert.match(r.stdout, /hint:/);
});
