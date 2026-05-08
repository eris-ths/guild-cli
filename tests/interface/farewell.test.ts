// gate farewell — ceremonial close (#36 Phase 2 step 3).
//
// Pins:
//   - JSON envelope shape (kind: 'farewell', suggested_next: null)
//   - text mode prints the success line + the next-session resume hint
//   - same storage path as rest/wake (sessions/<id>.yaml,
//     kind discriminator)
//   - --note tight-scope (≤ 240 chars, sanitised, empty → omitted)
//   - missing --by + missing GUILD_ACTOR → fail-closed

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
  const root = makeTempRoot('gate-farewell-');
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

test('gate farewell: writes a session event YAML with kind: farewell', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const r = runGate(root, ['farewell', '--by', 'alice']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /✓ farewell: \d{4}-\d{2}-\d{2}-\d{3,4} by alice/);

  const file = readdirSync(join(root, 'sessions'))[0]!;
  const yaml = readFileSync(join(root, 'sessions', file), 'utf8');
  assert.match(yaml, /kind: farewell/);
  assert.match(yaml, /by: alice/);
});

test('gate farewell text mode: prints next-session resume hint', (t) => {
  // The advisory pointer at `gate resume` lives in text mode (not
  // suggested_next) because the JSON consumer that just farewelled
  // by definition won't run resume — it's the NEXT session's first
  // call. Text mode is for the human reader who sees it as a
  // parting note.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const r = runGate(root, ['farewell', '--by', 'alice']);
  assert.match(r.stdout, /next session: `gate resume`/);
});

test('gate farewell --format json: suggested_next is null (terminal in session sense)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const r = runGate(root, ['farewell', '--by', 'alice', '--format', 'json']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.kind, 'farewell');
  assert.equal(payload.by, 'alice');
  // farewell ends the session — pre-suggesting resume here would
  // be a weird shape since the consumer that just farewelled
  // wouldn't immediately run resume. Null is the right shape.
  assert.equal(payload.suggested_next, null);
});

test('gate farewell --note: stamps note + still prints resume hint', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const r = runGate(root, [
    'farewell', '--by', 'alice',
    '--note', 'shipping the wake/farewell PR',
  ]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /note: shipping the wake\/farewell PR/);
  assert.match(r.stdout, /next session: `gate resume`/);

  const file = readdirSync(join(root, 'sessions'))[0]!;
  const yaml = readFileSync(join(root, 'sessions', file), 'utf8');
  assert.match(yaml, /note: shipping the wake\/farewell PR/);
});

test('gate farewell: rest + wake + farewell share the same per-day sequence', (t) => {
  // All three boundary verbs write to the same sessions/ directory;
  // the per-day allocator counts every kind toward one chronological
  // sequence. id ordering matches wall-clock ordering without a
  // kind-aware tiebreaker.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const r1 = JSON.parse(runGate(root, ['rest', '--by', 'alice', '--format', 'json']).stdout);
  const r2 = JSON.parse(runGate(root, ['wake', '--by', 'alice', '--format', 'json']).stdout);
  const r3 = JSON.parse(runGate(root, ['farewell', '--by', 'alice', '--format', 'json']).stdout);
  const seq1 = parseInt(r1.id.slice(11), 10);
  const seq2 = parseInt(r2.id.slice(11), 10);
  const seq3 = parseInt(r3.id.slice(11), 10);
  assert.equal(seq2, seq1 + 1);
  assert.equal(seq3, seq2 + 1);
  assert.equal(r1.kind, 'rest');
  assert.equal(r2.kind, 'wake');
  assert.equal(r3.kind, 'farewell');
});

test('gate farewell: missing --by + missing GUILD_ACTOR fails closed', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const r = runGate(root, ['farewell'], { GUILD_ACTOR: '' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--by/);
});

test('gate farewell --note: rejected when > 240 chars', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const longNote = 'x'.repeat(241);
  const r = runGate(root, ['farewell', '--by', 'alice', '--note', longNote]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /note too long \(max 240 chars\)/);
});

test('gate farewell --note: whitespace-only collapses to no-note', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const r = runGate(root, [
    'farewell', '--by', 'alice',
    '--note', '   ',
    '--format', 'json',
  ]);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.note, undefined);
});
