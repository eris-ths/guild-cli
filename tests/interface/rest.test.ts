// gate rest — boundary record (#36 Phase 2).
//
// Pins:
//   - JSON envelope shape (snake_case, suggested_next slot for the
//     future wake/farewell pair)
//   - text mode prints the success line and the optional note
//   - file lands at <content_root>/sessions/<id>.yaml
//   - id format YYYY-MM-DD-NNN per-day sequence
//   - --note is sanitised and capped at 240 chars
//   - missing --by + missing GUILD_ACTOR fails closed
//   - hydrate tolerance: a future kind ('wake' / 'farewell') in the
//     domain enum hydrates today without throwing

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = makeTempRoot('gate-rest-');
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

test('gate rest: writes a session event YAML under <content_root>/sessions/', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const r = runGate(root, ['rest', '--by', 'alice']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /✓ rested: \d{4}-\d{2}-\d{2}-\d{3,4} by alice/);

  const sessionsDir = join(root, 'sessions');
  assert.ok(existsSync(sessionsDir), 'sessions/ directory exists');
  const files = readdirSync(sessionsDir);
  assert.equal(files.length, 1);
  const file = files[0]!;
  assert.match(file, /^\d{4}-\d{2}-\d{2}-\d{3,4}\.yaml$/);
  const yaml = readFileSync(join(sessionsDir, file), 'utf8');
  assert.match(yaml, /kind: rest/);
  assert.match(yaml, /by: alice/);
  assert.match(yaml, /at: \d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(yaml, /note:/, 'no --note → field omitted (byte-stable)');
});

test('gate rest --note: stamps the note in YAML and prints it in text mode', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const r = runGate(root, ['rest', '--by', 'alice', '--note', 'stepping away for lunch']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /✓ rested: \d{4}-\d{2}-\d{2}-\d{3,4} by alice/);
  assert.match(r.stdout, /note: stepping away for lunch/);

  const file = readdirSync(join(root, 'sessions'))[0]!;
  const yaml = readFileSync(join(root, 'sessions', file), 'utf8');
  assert.match(yaml, /note: stepping away for lunch/);
});

test('gate rest --format json: emits the structured envelope', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const r = runGate(root, ['rest', '--by', 'alice', '--note', 'hello', '--format', 'json']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.kind, 'rest');
  assert.equal(payload.by, 'alice');
  assert.equal(payload.note, 'hello');
  assert.match(payload.id, /^\d{4}-\d{2}-\d{2}-\d{3,4}$/);
  assert.match(payload.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(payload.message, /✓ rested:/);
  // suggested_next is null until `gate wake` ships — no fake
  // prescription of a verb that doesn't exist.
  assert.equal(payload.suggested_next, null);
});

test('gate rest: GUILD_ACTOR fallback when --by omitted', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const r = runGate(root, ['rest'], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /by alice/);
});

test('gate rest: missing --by and missing GUILD_ACTOR fails closed', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const r = runGate(root, ['rest'], { GUILD_ACTOR: '' });
  assert.equal(r.status, 1);
  // Standard "actor required" surface from requireOption.
  assert.match(r.stderr, /--by/);
});

test('gate rest: per-day sequence increments', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const r1 = JSON.parse(runGate(root, ['rest', '--by', 'alice', '--format', 'json']).stdout);
  const r2 = JSON.parse(runGate(root, ['rest', '--by', 'alice', '--format', 'json']).stdout);
  // Same date prefix, sequential suffix.
  const date1 = r1.id.slice(0, 10);
  const date2 = r2.id.slice(0, 10);
  assert.equal(date1, date2);
  const seq1 = parseInt(r1.id.slice(11), 10);
  const seq2 = parseInt(r2.id.slice(11), 10);
  assert.equal(seq2, seq1 + 1);
});

test('gate rest --note: rejected when > 240 chars', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const longNote = 'x'.repeat(241);
  const r = runGate(root, ['rest', '--by', 'alice', '--note', longNote]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /note too long \(max 240 chars\)/);
});

test('gate rest --note: whitespace-only collapses to no-note (omit-when-empty)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const r = runGate(root, ['rest', '--by', 'alice', '--note', '   ', '--format', 'json']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.note, undefined);
});

test('gate rest: rejects unknown actor (canonical actor-validation surface)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const r = runGate(root, ['rest', '--by', 'nobody']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /nobody/);
});

test('gate rest: hydrate tolerance — wake / farewell records load without error', (t) => {
  // Forge two records on disk that future `gate wake` / `gate farewell`
  // would write. The current binary doesn't expose those verbs yet,
  // but the domain enum already accepts them; reading must not throw.
  // Pre-#36-Phase-2 records are simply absent (no `sessions/` dir at
  // all); this test covers the OPPOSITE direction: a future writer's
  // record reaches an older reader. Records-outlive-writers
  // (principle 04).
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  mkdirSync(join(root, 'sessions'));
  writeFileSync(
    join(root, 'sessions', '2099-01-01-001.yaml'),
    'id: 2099-01-01-001\nkind: wake\nby: alice\nat: 2099-01-01T00:00:00.000Z\n',
  );
  writeFileSync(
    join(root, 'sessions', '2099-01-01-002.yaml'),
    'id: 2099-01-01-002\nkind: farewell\nby: alice\nat: 2099-01-01T01:00:00.000Z\nnote: see you tomorrow\n',
  );

  // gate doctor must read every YAML under content_root and not crash
  // on the future kinds. A well-formed but unknown-kind record would
  // surface via parseSessionKind throwing — we expect it to PASS today
  // because wake / farewell are already in the enum.
  const doctor = runGate(root, ['doctor', '--format', 'json']);
  assert.equal(doctor.status, 0);
  // No plugin-area finding referencing the session files.
  const report = JSON.parse(doctor.stdout);
  const sessionFinding = (report.findings as Array<{ source: string }>).find(
    (f) => f.source.includes('sessions/'),
  );
  assert.equal(sessionFinding, undefined, 'session events must hydrate cleanly');
});
