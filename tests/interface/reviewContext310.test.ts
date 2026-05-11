// #310 — gate review-context regression.
//
// Acceptance:
//   - shallow / standard / deep produce the matching lense recommendation
//   - missing depth on a wave surfaces a non-empty warning + empty lenses
//   - prior reviews are bundled into the payload
//   - non-existent id → exit 1 with notFoundHint

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function runGate(cwd: string, args: string[]): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], { cwd, encoding: 'utf8' });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? -1 };
}

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-review-context-'));
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

test('#310: review-context on non-existent id exits 1 with notFoundHint', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['review-context', '9999-99-99-9999']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not found: 9999-99-99-9999/);
});

test('#310: review-context on wave without depth → empty lenses + warning', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const created = runGate(root, [
    'request',
    '--from', 'alice',
    '--executors', 'alice',
    '--action', 'no-depth wave',
    '--reason', 'reviewer default test',
  ]);
  const id = extractRequestId(created.stdout + created.stderr);

  const r = runGate(root, ['review-context', id, '--format', 'json']);
  assert.equal(r.status, 0, r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.depth, null);
  assert.deepEqual(payload.recommended_lenses, []);
  assert.deepEqual(payload.recommended_extras, []);
  assert.match(payload.warning, /no depth recorded/);
  assert.deepEqual(payload.executors, ['alice']);
});

test('#310: depth=shallow → point-check lense set', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const created = runGate(root, [
    'request',
    '--from', 'alice',
    '--executors', 'alice',
    '--depth', 'shallow',
    '--action', 'shallow wave',
    '--reason', 'depth=shallow',
  ]);
  const id = extractRequestId(created.stdout + created.stderr);

  const r = runGate(root, ['review-context', id, '--format', 'json']);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.depth, 'shallow');
  assert.deepEqual(payload.recommended_lenses, ['Logic']);
  assert.deepEqual(payload.recommended_extras, []);
  assert.equal(payload.warning, '');
});

test('#310: depth=standard → 6-lense default', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const created = runGate(root, [
    'request',
    '--from', 'alice',
    '--executors', 'alice',
    '--depth', 'standard',
    '--action', 'standard wave',
    '--reason', 'depth=standard',
  ]);
  const id = extractRequestId(created.stdout + created.stderr);

  const r = runGate(root, ['review-context', id, '--format', 'json']);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.depth, 'standard');
  assert.equal(payload.recommended_lenses.length, 6);
  assert.ok(payload.recommended_lenses.includes('Logic'));
  assert.ok(payload.recommended_lenses.includes('Input'));
  assert.deepEqual(payload.recommended_extras, []);
});

test('#310: depth=deep → all 10 lenses + extras (memory MCP + state-machine + cross-check)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const created = runGate(root, [
    'request',
    '--from', 'alice',
    '--executors', 'alice',
    '--depth', 'deep',
    '--action', 'deep wave',
    '--reason', 'depth=deep',
  ]);
  const id = extractRequestId(created.stdout + created.stderr);

  const r = runGate(root, ['review-context', id, '--format', 'json']);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.depth, 'deep');
  assert.equal(payload.recommended_lenses.length, 10);
  // Spot-check the security cluster that distinguishes deep from standard.
  assert.ok(payload.recommended_lenses.includes('Injection'));
  assert.ok(payload.recommended_lenses.includes('Auth'));
  assert.ok(payload.recommended_lenses.includes('Secrets'));
  assert.ok(payload.recommended_extras.includes('memory_mcp_trap_lookup'));
  assert.ok(payload.recommended_extras.includes('state_machine_trace'));
  assert.ok(payload.recommended_extras.includes('prior_review_cross_check'));
});

test('#310: review-context bundles prior reviews into the payload', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const created = runGate(root, [
    'request',
    '--from', 'alice',
    '--executors', 'alice',
    '--depth', 'deep',
    '--action', 'reviewed wave',
    '--reason', 'prior-review bundling',
  ]);
  const id = extractRequestId(created.stdout + created.stderr);
  runGate(root, ['approve', id, '--by', 'critic']);
  const rev = runGate(root, [
    'review', id,
    '--by', 'critic',
    '--lense', 'layer',
    '--verdict', 'ok',
    '--note', 'first pass clean',
  ]);
  assert.equal(rev.status, 0, rev.stderr);

  const r = runGate(root, ['review-context', id, '--format', 'json']);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.prior_reviews.length, 1);
  assert.equal(payload.prior_reviews[0].by, 'critic');
  assert.equal(payload.prior_reviews[0].lense, 'layer');
  assert.equal(payload.prior_reviews[0].verdict, 'ok');
  assert.equal(payload.prior_reviews[0].comment, 'first pass clean');
});

test('#310: text format renders depth + lense recommendation + prior reviews', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const created = runGate(root, [
    'request',
    '--from', 'alice',
    '--executors', 'alice',
    '--depth', 'deep',
    '--action', 'text-format wave',
    '--reason', 'text rendering',
  ]);
  const id = extractRequestId(created.stdout + created.stderr);

  const r = runGate(root, ['review-context', id, '--format', 'text']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /review-context [\d-]+/);
  assert.match(r.stdout, /depth: deep/);
  assert.match(r.stdout, /recommended lenses:.*Injection/);
  assert.match(r.stdout, /recommended extras:.*memory_mcp_trap_lookup/);
});

test('#310: review-context rejects unknown flags', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const created = runGate(root, [
    'request',
    '--from', 'alice',
    '--executors', 'alice',
    '--depth', 'standard',
    '--action', 'flag test',
    '--reason', 'unknown flag',
  ]);
  const id = extractRequestId(created.stdout + created.stderr);

  const r = runGate(root, ['review-context', id, '--bogus']);
  assert.notEqual(r.status, 0);
});
