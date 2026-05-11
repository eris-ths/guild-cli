// #295 — gate wave-status regression suite.
//
// Acceptance per the issue:
//   - works on any state (pending / approved / executing / completed / failed / denied)
//   - single-executor renders compact form (one summary line)
//   - multi-executor with witnesses renders the per-executor block
//   - multi-executor with no witnesses + age threshold:
//       fresh (<5min)        → no warning
//       in-progress (5-30m)  → "(in progress — no recent attributable write)"
//       stale (≥30m, never)  → "⚠ stale — no in-flight progress note recorded"
//   - non-existent id → exit 1 with notFoundHint
//
// Time-sensitive bands are exercised by injecting a stale approve
// timestamp via direct YAML edit — the alternative (waiting real
// 30 minutes) would be hostile to CI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function runGate(cwd: string, args: string[]): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], { cwd, encoding: 'utf8' });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? -1 };
}

function bootstrap(extraConfig = ''): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-wave-status-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n' + extraConfig,
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

// -------------------- non-existent id --------------------

test('#295: wave-status on non-existent id exits 1 with notFoundHint', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['wave-status', '9999-99-99-9999']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not found: 9999-99-99-9999/);
});

// -------------------- single-executor compact form --------------------

test('#295: single-executor wave renders compact form (one line)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const created = runGate(root, [
    'request',
    '--from', 'alice',
    '--executors', 'alice',
    '--action', 'single-actor work',
    '--reason', 'solo slice',
  ]);
  const id = extractRequestId(created.stdout + created.stderr);
  runGate(root, ['approve', id, '--by', 'eris']);

  const text = runGate(root, ['wave-status', id, '--format', 'text']);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /wave [\d-]+\s+\[approved\]\s+from=alice/);
  assert.match(text.stdout, /executor: alice/);
  // The "executors:" header is the multi-executor surface; single-
  // actor compact form must NOT use it.
  assert.doesNotMatch(text.stdout, /\nexecutors:\n/);
});

// -------------------- multi-executor with witnesses --------------------

test('#295: multi-executor with witnesses renders the per-executor block', (t) => {
  const { root, cleanup } = bootstrap('profile: swarm\n');
  t.after(cleanup);
  const created = runGate(root, [
    'request',
    '--from', 'eris',
    '--executors', 'alice,bob',
    '--action', 'parallel work',
    '--reason', 'two slices',
  ]);
  const id = extractRequestId(created.stdout + created.stderr);
  runGate(root, ['approve', id, '--by', 'critic']);
  runGate(root, ['witness', id, '--by', 'alice', '--note', 'claim slice 1']);
  runGate(root, ['witness', id, '--by', 'bob', '--note', 'claim slice 2']);

  const r = runGate(root, ['wave-status', id, '--format', 'json']);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.state, 'approved');
  assert.equal(payload.executors.length, 2);

  const alice = payload.executors.find((e: { name: string }) => e.name === 'alice');
  const bob = payload.executors.find((e: { name: string }) => e.name === 'bob');
  assert.equal(alice.witness_note, 'claim slice 1');
  assert.equal(bob.witness_note, 'claim slice 2');

  const text = runGate(root, ['wave-status', id, '--format', 'text']);
  assert.match(text.stdout, /executors:/);
  assert.match(text.stdout, /alice/);
  assert.match(text.stdout, /witness: claim slice 1/);
  assert.match(text.stdout, /bob/);
  assert.match(text.stdout, /witness: claim slice 2/);
});

// -------------------- fresh wave: no warning --------------------

test('#295: fresh wave (<5min) suppresses stale warning even with no witness', (t) => {
  const { root, cleanup } = bootstrap('profile: swarm\n');
  t.after(cleanup);
  const created = runGate(root, [
    'request',
    '--from', 'eris',
    '--executors', 'alice,bob',
    '--action', 'fresh wave',
    '--reason', 'no witnesses yet',
  ]);
  const id = extractRequestId(created.stdout + created.stderr);
  runGate(root, ['approve', id, '--by', 'critic']);

  const r = runGate(root, ['wave-status', id, '--format', 'json']);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.age_band, 'fresh');
  // No witnesses, no claims — but age is fresh so no stale warning.
  const text = runGate(root, ['wave-status', id, '--format', 'text']);
  assert.doesNotMatch(text.stdout, /⚠ stale/);
  assert.doesNotMatch(text.stdout, /in progress — no recent/);
});

// -------------------- stale wave: ⚠ surfaces --------------------

test('#295: stale wave (≥30min approved, no witnesses) surfaces ⚠ stale rendering', (t) => {
  const { root, cleanup } = bootstrap('profile: swarm\n');
  t.after(cleanup);
  const created = runGate(root, [
    'request',
    '--from', 'eris',
    '--executors', 'alice,bob',
    '--action', 'stale ceremony',
    '--reason', 'witnesses never came',
  ]);
  const id = extractRequestId(created.stdout + created.stderr);
  runGate(root, ['approve', id, '--by', 'critic']);

  // Sabotage the approved_at timestamp to push wave age past 30 min.
  // Direct YAML edit — same approach the boot malformed-records test
  // uses. The file lives under requests/approved/<id>.yaml after the
  // approve transition.
  const approvedDir = join(root, 'requests', 'approved');
  const fname = `${id}.yaml`;
  const path = join(approvedDir, fname);
  const yaml = readFileSync(path, 'utf8');
  // Push the approved entry back by 45 minutes.
  const oldTime = new Date(Date.now() - 45 * 60 * 1000).toISOString();
  const patched = yaml.replace(
    /(state: approved\n\s+by: critic\n\s+at: )[^\n]+/,
    `$1${oldTime}`,
  );
  writeFileSync(path, patched);

  const r = runGate(root, ['wave-status', id, '--format', 'json']);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.age_band, 'stale', `expected stale band, got: ${payload.age_band} (age_ms=${payload.age_ms})`);
  for (const e of payload.executors) {
    assert.equal(e.activity_band, 'stale');
  }

  const text = runGate(root, ['wave-status', id, '--format', 'text']);
  assert.match(text.stdout, /⚠ stale — no in-flight progress note recorded/);
});

// -------------------- terminal-state still works --------------------

test('#295: terminal-state wave (completed) still renders without crashing', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const created = runGate(root, [
    'request',
    '--from', 'alice',
    '--executors', 'alice',
    '--action', 'completed wave',
    '--reason', 'lifecycle through',
  ]);
  const id = extractRequestId(created.stdout + created.stderr);
  runGate(root, ['approve', id, '--by', 'eris']);
  runGate(root, ['execute', id, '--by', 'alice']);
  runGate(root, ['complete', id, '--by', 'alice', '--note', 'done']);

  const r = runGate(root, ['wave-status', id, '--format', 'json']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.state, 'completed');
  // The executor `alice` has attributable status_log entries
  // (execute + complete) — `last_attributable_at` should be set even
  // though witnesses were auto-released on terminal transition.
  assert.equal(payload.executors.length, 1);
  assert.ok(payload.executors[0].last_attributable_at !== null,
    `expected alice's last_attributable_at to be populated from status_log; got: ${JSON.stringify(payload.executors[0])}`);
  // #309: activity_band is now time-graded per-executor (fresh/in-
  // progress/stale) rather than the deprecated 'active' sentinel.
  // Just-completed wave has lastAt seconds ago → 'fresh'.
  assert.equal(payload.executors[0].activity_band, 'fresh');
});
