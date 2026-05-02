// agora suspend / resume — the design pivot.
//
// These tests pin the substrate-side Zeigarnik effect (issue #117):
// suspend records cliff + invitation; resume reads them back. The
// substrate carries the motivation for re-entry, not the agent's
// psychology (principle 11).
//
// Pinned:
//   - suspend: state playing → suspended, suspensions[] appended,
//     cliff + invitation required (no empty suspensions allowed)
//   - resume: state suspended → playing, resumes[] appended,
//     surfaces closing cliff/invitation in success output
//   - state-machine boundaries refuse wrong-state transitions
//     (suspend on suspended, resume on playing) with structured errors
//   - move refused while suspended (covered earlier; sanity here)
//   - multi-suspend/resume preserved as separate entries in arrays
//   - JSON envelopes are snake_case (principle 11)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const AGORA = resolve(here, '../../../../bin/agora.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'agora-pivot-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  mkdirSync(join(root, 'members'));
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runAgora(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [AGORA, ...args], {
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

function seedPlayingPlay(root: string, gameSlug = 'pivot-game'): string {
  runAgora(
    root,
    ['new', '--slug', gameSlug, '--kind', 'sandbox', '--title', `${gameSlug}`],
    { GUILD_ACTOR: 'alice' },
  );
  const r = runAgora(
    root,
    ['play', '--slug', gameSlug, '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  return JSON.parse(r.stdout).play_id;
}

test('agora suspend: flips state and records cliff + invitation', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const playId = seedPlayingPlay(root);

  const r = runAgora(
    root,
    [
      'suspend', playId,
      '--cliff', 'unresolved tension',
      '--invitation', 'name it or absorb it',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  assert.match(r.stdout, /✓ play suspended/);
  assert.match(r.stdout, /cliff:\s+unresolved tension/);
  assert.match(r.stdout, /invitation:\s+name it or absorb it/);

  // YAML reflects the state transition + the suspensions[] entry
  const yaml = readFileSync(
    join(root, 'agora', 'plays', 'pivot-game', `${playId}.yaml`),
    'utf8',
  );
  assert.match(yaml, /state: suspended/);
  assert.match(yaml, /suspensions:/);
  assert.match(yaml, /cliff: unresolved tension/);
  assert.match(yaml, /invitation: name it or absorb it/);
  assert.match(yaml, /by: alice/);
});

test('agora suspend: requires both --cliff and --invitation', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const playId = seedPlayingPlay(root);

  // missing --invitation
  const r1 = runAgora(
    root,
    ['suspend', playId, '--cliff', 'something'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(r1.status, 0);
  assert.match(r1.stderr, /--invitation required/);

  // missing --cliff
  const r2 = runAgora(
    root,
    ['suspend', playId, '--invitation', 'something'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(r2.status, 0);
  assert.match(r2.stderr, /--cliff required/);
});

test('agora suspend: refuses to suspend an already-suspended play', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const playId = seedPlayingPlay(root);

  // First suspend succeeds
  runAgora(
    root,
    ['suspend', playId, '--cliff', 'c1', '--invitation', 'i1'],
    { GUILD_ACTOR: 'alice' },
  );

  // Second suspend on the now-suspended play fails
  const r = runAgora(
    root,
    ['suspend', playId, '--cliff', 'c2', '--invitation', 'i2'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /only "playing" plays can be suspended/);
});

test('agora resume: flips state back and surfaces the closing cliff/invitation', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const playId = seedPlayingPlay(root);
  runAgora(
    root,
    [
      'suspend', playId,
      '--cliff', 'unresolved tension',
      '--invitation', 'name it or absorb it',
    ],
    { GUILD_ACTOR: 'alice' },
  );

  const r = runAgora(
    root,
    ['resume', playId, '--note', 'absorbed it'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  assert.match(r.stdout, /✓ play resumed/);
  // The closing cliff/invitation surfaces in resume output —
  // substrate-side Zeigarnik (issue #117): the agent re-entering
  // sees what was paused on, no separate query needed.
  assert.match(r.stdout, /closing cliff:\s+unresolved tension/);
  assert.match(r.stdout, /closing invitation:\s+name it or absorb it/);

  // YAML: state back to playing, suspension entry preserved (not
  // mutated), resume entry appended with note
  const yaml = readFileSync(
    join(root, 'agora', 'plays', 'pivot-game', `${playId}.yaml`),
    'utf8',
  );
  assert.match(yaml, /state: playing/);
  assert.match(yaml, /suspensions:/);
  assert.match(yaml, /cliff: unresolved tension/);
  assert.match(yaml, /resumes:/);
  assert.match(yaml, /note: absorbed it/);
});

test('agora resume: refuses to resume a non-suspended play', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const playId = seedPlayingPlay(root); // playing, not suspended

  const r = runAgora(
    root,
    ['resume', playId],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /only "suspended" plays can be resumed/);
});

test('agora suspend/resume: round-trip preserves moves and accumulates history', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const playId = seedPlayingPlay(root);

  // Move 1
  runAgora(
    root,
    ['move', playId, '--text', 'm1'],
    { GUILD_ACTOR: 'alice' },
  );
  // Suspend 1
  runAgora(
    root,
    ['suspend', playId, '--cliff', 'c1', '--invitation', 'i1'],
    { GUILD_ACTOR: 'alice' },
  );
  // Resume 1
  runAgora(
    root,
    ['resume', playId, '--note', 'r1'],
    { GUILD_ACTOR: 'alice' },
  );
  // Move 2 (now playing again)
  runAgora(
    root,
    ['move', playId, '--text', 'm2'],
    { GUILD_ACTOR: 'alice' },
  );
  // Suspend 2 (different cliff)
  runAgora(
    root,
    ['suspend', playId, '--cliff', 'c2', '--invitation', 'i2'],
    { GUILD_ACTOR: 'alice' },
  );

  // Multi-cycle history all preserved
  const yaml = readFileSync(
    join(root, 'agora', 'plays', 'pivot-game', `${playId}.yaml`),
    'utf8',
  );
  assert.match(yaml, /state: suspended/); // current state
  // Two moves
  assert.match(yaml, /text: m1/);
  assert.match(yaml, /text: m2/);
  // Two suspensions, both cliffs preserved
  assert.match(yaml, /cliff: c1/);
  assert.match(yaml, /cliff: c2/);
  // One resume (the second suspend hasn't been resumed yet)
  assert.match(yaml, /note: r1/);
});

test('agora suspend: JSON envelope is snake_case (principle 11)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const playId = seedPlayingPlay(root);

  const r = runAgora(
    root,
    [
      'suspend', playId,
      '--cliff', 'c',
      '--invitation', 'i',
      '--format', 'json',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.state, 'suspended');
  assert.equal(payload.suspension_index, 0);
  assert.equal(payload.suggested_next.verb, 'resume');
  for (const key of Object.keys(payload)) {
    assert.ok(!/[A-Z]/.test(key), `envelope key "${key}" must be snake_case`);
  }
});

test('agora resume: JSON envelope surfaces resumed_suspension struct', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const playId = seedPlayingPlay(root);
  runAgora(
    root,
    ['suspend', playId, '--cliff', 'c', '--invitation', 'i'],
    { GUILD_ACTOR: 'alice' },
  );
  const r = runAgora(
    root,
    ['resume', playId, '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.state, 'playing');
  assert.equal(payload.resumed_suspension.cliff, 'c');
  assert.equal(payload.resumed_suspension.invitation, 'i');
  assert.equal(payload.suggested_next.verb, 'move');
});

test('agora suspend: nonexistent play fails closed', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const r = runAgora(
    root,
    ['suspend', '2026-05-02-999', '--cliff', 'c', '--invitation', 'i'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Play "2026-05-02-999" not found/);
});
