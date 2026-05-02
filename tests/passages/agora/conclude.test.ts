// agora conclude — terminal state transition.
//
// Pins:
//   - conclude from playing → concluded
//   - conclude from suspended → concluded (drift-away outcome)
//   - --note prose preserved in concluded_note
//   - prior history (moves, suspensions, resumes) intact after conclude
//   - already-concluded conclude fails (terminal)
//   - concluded play refuses move / suspend / resume (state-machine)
//   - JSON envelope is snake_case + suggested_next is null (terminal)

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
  const root = mkdtempSync(join(tmpdir(), 'agora-conclude-'));
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

function seedPlayingPlay(root: string, gameSlug = 'cg'): string {
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

test('agora conclude: playing → concluded with note', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const playId = seedPlayingPlay(root);

  const r = runAgora(
    root,
    ['conclude', playId, '--note', 'shipped'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  assert.match(r.stdout, /✓ play concluded/);
  assert.match(r.stdout, /\[playing → concluded\]/);
  assert.match(r.stdout, /note: shipped/);
  assert.match(r.stdout, /terminal/);

  const yaml = readFileSync(
    join(root, 'agora', 'plays', 'cg', `${playId}.yaml`),
    'utf8',
  );
  assert.match(yaml, /state: concluded/);
  assert.match(yaml, /concluded_by: alice/);
  assert.match(yaml, /concluded_note: shipped/);
});

test('agora conclude: suspended → concluded (drift-away outcome)', (t) => {
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
    ['conclude', playId, '--note', 'never returned'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\[suspended → concluded\]/);
  // The suspension stays in the record — append-only history
  // doesn't get cleared by conclude.
  const yaml = readFileSync(
    join(root, 'agora', 'plays', 'cg', `${playId}.yaml`),
    'utf8',
  );
  assert.match(yaml, /state: concluded/);
  assert.match(yaml, /cliff: c/);
  assert.match(yaml, /invitation: i/);
});

test('agora conclude: concluded play accepts no further verbs', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const playId = seedPlayingPlay(root);
  runAgora(root, ['conclude', playId], { GUILD_ACTOR: 'alice' });

  // move on concluded → fails
  const moveR = runAgora(
    root,
    ['move', playId, '--text', 'after-conclude'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(moveR.status, 0);
  assert.match(moveR.stderr, /Concluded plays are terminal/);

  // suspend on concluded → fails
  const suspR = runAgora(
    root,
    ['suspend', playId, '--cliff', 'c', '--invitation', 'i'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(suspR.status, 0);
  // suspend uses PlayCannotSuspend wording for non-playing states
  assert.match(suspR.stderr, /only "playing" plays can be suspended/);

  // conclude on concluded → fails (PlayAlreadyConcluded)
  const concR = runAgora(
    root,
    ['conclude', playId],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(concR.status, 0);
  assert.match(concR.stderr, /already concluded/);
});

test('agora conclude: --note optional; omitted when not provided', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const playId = seedPlayingPlay(root);
  runAgora(root, ['conclude', playId], { GUILD_ACTOR: 'alice' });

  const yaml = readFileSync(
    join(root, 'agora', 'plays', 'cg', `${playId}.yaml`),
    'utf8',
  );
  assert.match(yaml, /state: concluded/);
  assert.doesNotMatch(yaml, /^concluded_note:/m);
});

test('agora conclude: JSON envelope snake_case + suggested_next null (terminal)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const playId = seedPlayingPlay(root);

  const r = runAgora(
    root,
    ['conclude', playId, '--note', 'closing', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.state, 'concluded');
  assert.equal(payload.from_state, 'playing');
  assert.equal(payload.concluded_by, 'alice');
  assert.equal(payload.concluded_note, 'closing');
  // suggested_next is null because concluded is terminal — no
  // verb to dispatch next on this play.
  assert.equal(payload.suggested_next, null);
  for (const k of Object.keys(payload)) {
    assert.ok(!/[A-Z]/.test(k), `key "${k}" must be snake_case`);
  }
});

test('agora conclude: nonexistent play fails closed', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runAgora(
    root,
    ['conclude', '2026-05-02-999'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Play "2026-05-02-999" not found/);
});

test('agora conclude: missing positional / actor / unknown flag handled', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const playId = seedPlayingPlay(root);

  const noArg = runAgora(root, ['conclude'], { GUILD_ACTOR: 'alice' });
  assert.notEqual(noArg.status, 0);
  assert.match(noArg.stderr, /positional <play-id> required/);

  const noActor = runAgora(
    root,
    ['conclude', playId],
    { GUILD_ACTOR: '' },
  );
  assert.notEqual(noActor.status, 0);
  assert.match(noActor.stderr, /--by required/);

  const bogus = runAgora(
    root,
    ['conclude', playId, '--bogus', 'x'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(bogus.status, 0);
  assert.match(bogus.stderr, /unknown flag.*--bogus/);
});

test('agora conclude: show after conclude renders the concluded state + closing note', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const playId = seedPlayingPlay(root);
  runAgora(root, ['move', playId, '--text', 'one'], { GUILD_ACTOR: 'alice' });
  runAgora(
    root,
    ['conclude', playId, '--note', 'closure prose'],
    { GUILD_ACTOR: 'alice' },
  );

  const r = runAgora(root, ['show', playId], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\[concluded ✓\]/);
  // The move history is preserved across conclude
  assert.match(r.stdout, /one/);
});
