// agora play — start a play session against an existing Game.
//
// Pins:
//   - JSON envelope shape (snake_case, where_written + config_file +
//     suggested_next pointing at next verb)
//   - text mode mirrors gate / agora new conventions
//   - file lands at <content_root>/agora/plays/<slug>/<play-id>.yaml
//   - play id format YYYY-MM-DD-NNN derived from runtime clock
//   - sequence allocation per game per day
//   - initial state is 'playing' with empty moves[]
//   - missing game slug fails closed (GameNotFoundForPlay)
//   - missing actor fails closed
//   - principle 11 contract: no camelCase in output

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const AGORA = resolve(here, '../../../../bin/agora.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'agora-play-'));
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

// Seed a game so play has something to attach to.
function seedGame(root: string, slug: string, kind = 'sandbox'): void {
  runAgora(
    root,
    ['new', '--slug', slug, '--kind', kind, '--title', `${slug} game`],
    { GUILD_ACTOR: 'alice' },
  );
}

test('agora play: text mode starts a play session and writes the YAML at expected path', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedGame(root, 'first-game');

  const r = runAgora(
    root,
    ['play', '--slug', 'first-game'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  assert.match(r.stdout, /✓ play started: \d{4}-\d{2}-\d{2}-\d{3} \[playing\] on game=first-game/);
  assert.match(r.stderr, /^notice: wrote /);

  // Find the play file (id is dynamic — derive today and 001).
  const today = new Date().toISOString().slice(0, 10);
  const expectedPath = join(root, 'agora', 'plays', 'first-game', `${today}-001.yaml`);
  assert.ok(existsSync(expectedPath), `expected play YAML at ${expectedPath}`);
  const yaml = readFileSync(expectedPath, 'utf8');
  assert.match(yaml, new RegExp(`id: ${today}-001`));
  assert.match(yaml, /game: first-game/);
  assert.match(yaml, /state: playing/);
  assert.match(yaml, /started_by: alice/);
  // Empty moves array — initial state, no moves yet.
  assert.match(yaml, /moves: \[\]/);
});

test('agora play: JSON mode emits snake_case envelope', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedGame(root, 'sandbox-game');

  const r = runAgora(
    root,
    ['play', '--slug', 'sandbox-game', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.match(payload.play_id, /^\d{4}-\d{2}-\d{2}-\d{3}$/);
  assert.equal(payload.game, 'sandbox-game');
  assert.equal(payload.state, 'playing');
  assert.equal(payload.config_file, join(root, 'guild.config.yaml'));
  assert.match(payload.where_written, /agora\/plays\/sandbox-game\/\d{4}-\d{2}-\d{2}-\d{3}\.yaml$/);
  // suggested_next points at 'move' (the next verb in the lifecycle)
  assert.equal(payload.suggested_next.verb, 'move');
  // No camelCase keys (principle 11 + #109)
  for (const key of Object.keys(payload)) {
    assert.ok(!/[A-Z]/.test(key), `envelope key "${key}" must be snake_case`);
  }
});

test('agora play: sequence increments per game per day', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedGame(root, 'game-a');
  seedGame(root, 'game-b');

  // Three plays on game-a, one on game-b. game-a sequence should
  // walk 001/002/003; game-b should be 001 (separate counter).
  const r1 = runAgora(root, ['play', '--slug', 'game-a', '--format', 'json'], {
    GUILD_ACTOR: 'alice',
  });
  const r2 = runAgora(root, ['play', '--slug', 'game-a', '--format', 'json'], {
    GUILD_ACTOR: 'alice',
  });
  const r3 = runAgora(root, ['play', '--slug', 'game-a', '--format', 'json'], {
    GUILD_ACTOR: 'alice',
  });
  const rb = runAgora(root, ['play', '--slug', 'game-b', '--format', 'json'], {
    GUILD_ACTOR: 'alice',
  });

  assert.match(JSON.parse(r1.stdout).play_id, /-001$/);
  assert.match(JSON.parse(r2.stdout).play_id, /-002$/);
  assert.match(JSON.parse(r3.stdout).play_id, /-003$/);
  assert.match(JSON.parse(rb.stdout).play_id, /-001$/, 'separate game has its own counter');
});

test('agora play: nonexistent game fails closed with create-it-first hint', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);

  const r = runAgora(
    root,
    ['play', '--slug', 'no-such-game'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Game "no-such-game" does not exist/);
  // Hint at how to fix forward — agent reads stderr and creates the
  // game via the suggested command.
  assert.match(r.stderr, /agora new --slug no-such-game/);
});

test('agora play: missing actor fails closed', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedGame(root, 'unauth-test');

  const r = runAgora(
    root,
    ['play', '--slug', 'unauth-test'],
    { GUILD_ACTOR: '' },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--by required/);
});

test('agora play: rejects unknown flag (principle 10 input contract)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedGame(root, 'reject-test');

  const r = runAgora(
    root,
    ['play', '--slug', 'reject-test', '--bogus', 'x'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown flag.*--bogus/);
});

test('agora play: yaml file directory layout matches passage convention', (t) => {
  // Pin the structural decision: plays live under
  // <content_root>/agora/plays/<game-slug>/<play-id>.yaml.
  // Per-game subdirectories scope plays to their definition and
  // give each game its own sequence counter.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedGame(root, 'layout-game');
  runAgora(root, ['play', '--slug', 'layout-game'], { GUILD_ACTOR: 'alice' });

  const playsDir = join(root, 'agora', 'plays');
  assert.ok(existsSync(playsDir), 'plays directory should exist');
  const games = readdirSync(playsDir);
  assert.deepEqual(games, ['layout-game'], 'plays/<slug>/ subdir per game');

  const playFiles = readdirSync(join(playsDir, 'layout-game'));
  assert.equal(playFiles.length, 1);
  assert.match(playFiles[0]!, /^\d{4}-\d{2}-\d{2}-\d{3}\.yaml$/);
});
