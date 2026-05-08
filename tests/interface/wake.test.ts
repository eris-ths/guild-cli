// gate wake — pairing verb to gate rest (#36 Phase 2 step 2).
//
// Pins:
//   - JSON envelope shape (kind: 'wake', suggested_next → 'boot')
//   - text mode prints the success line and the optional note
//   - same storage path as rest (sessions/<id>.yaml, kind discriminator)
//   - decoupled from rest: wake works WITHOUT a prior rest record
//   - per-day sequence shares the same allocator as rest (one
//     `sessions/` namespace, all kinds count toward the same seq)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = makeTempRoot('gate-wake-');
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
  );
  mkdirSync(join(root, 'members'));
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

interface RunResult { stdout: string; stderr: string; status: number; }
function runGate(cwd: string, args: string[], env: Record<string, string> = {}): RunResult {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? -1 };
}

test('gate wake: writes a session event YAML with kind: wake', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const r = runGate(root, ['wake', '--by', 'alice']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /✓ woke: \d{4}-\d{2}-\d{2}-\d{3,4} by alice/);

  const file = readdirSync(join(root, 'sessions'))[0]!;
  const yaml = readFileSync(join(root, 'sessions', file), 'utf8');
  assert.match(yaml, /kind: wake/);
  assert.match(yaml, /by: alice/);
});

test('gate wake --format json: emits envelope with suggested_next → boot', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const r = runGate(root, ['wake', '--by', 'alice', '--format', 'json']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.kind, 'wake');
  assert.equal(payload.by, 'alice');
  // Wake → boot: the agent just returned; boot is the orientation
  // lense for what changed during the rest.
  assert.equal(payload.suggested_next.verb, 'boot');
  assert.match(payload.suggested_next.reason, /just woke/);
});

test('gate wake: works without a prior rest record (decoupled by design)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  // No rest call before this wake — should still succeed.
  const r = runGate(root, ['wake', '--by', 'alice']);
  assert.equal(r.status, 0, r.stderr);
});

test('gate wake: rest + wake share the same per-day sequence allocator', (t) => {
  // Both verbs write to the same sessions/ directory, so the
  // sequence is contiguous across kinds — first rest gets 001,
  // following wake gets 002, etc. This keeps the on-disk ordering
  // chronological by id without a kind-aware tiebreaker.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const r1 = JSON.parse(runGate(root, ['rest', '--by', 'alice', '--format', 'json']).stdout);
  const r2 = JSON.parse(runGate(root, ['wake', '--by', 'alice', '--format', 'json']).stdout);
  const seq1 = parseInt(r1.id.slice(11), 10);
  const seq2 = parseInt(r2.id.slice(11), 10);
  assert.equal(seq2, seq1 + 1);
  assert.equal(r1.kind, 'rest');
  assert.equal(r2.kind, 'wake');
});

test('gate wake --note: stamps the note in YAML and prints it in text mode', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const r = runGate(root, ['wake', '--by', 'alice', '--note', 'back from coffee']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /note: back from coffee/);

  const file = readdirSync(join(root, 'sessions'))[0]!;
  const yaml = readFileSync(join(root, 'sessions', file), 'utf8');
  assert.match(yaml, /note: back from coffee/);
});

test('gate wake: missing --by + missing GUILD_ACTOR fails closed', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const r = runGate(root, ['wake'], { GUILD_ACTOR: '' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--by/);
});

test('gate wake --note: rejected when > 240 chars', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const longNote = 'x'.repeat(241);
  const r = runGate(root, ['wake', '--by', 'alice', '--note', longNote]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /note too long \(max 240 chars\)/);
});
