// agora list — enumerate games and plays.
//
// Pins:
//   - default lists every game and every play (sorted)
//   - --game filter narrows plays to one game (drops games list)
//   - --state filter narrows plays to one state
//   - cross-game play-id collision (each game has its own
//     sequence) does NOT lose plays — both 2026-05-02-001s show
//   - JSON envelope is snake_case (principle 11)
//   - empty content root produces a graceful empty listing

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const AGORA = resolve(here, '../../../../bin/agora.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'agora-list-'));
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

test('agora list: empty content root shows graceful empty listing', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runAgora(root, ['list'], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /games \(0\):/);
  assert.match(r.stdout, /plays \(0\):/);
  assert.match(r.stdout, /agora new/);
  assert.match(r.stdout, /agora play/);
});

test('agora list: shows games and plays with state tags', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runAgora(
    root,
    ['new', '--slug', 'g1', '--kind', 'quest', '--title', 'Game 1'],
    { GUILD_ACTOR: 'alice' },
  );
  runAgora(root, ['play', '--slug', 'g1'], { GUILD_ACTOR: 'alice' });

  const r = runAgora(root, ['list'], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /games \(1\):/);
  assert.match(r.stdout, /g1\s+\[quest\]\s+— Game 1/);
  assert.match(r.stdout, /plays \(1\):/);
  assert.match(r.stdout, /\[playing\]\s+game=g1/);
});

test('agora list: cross-game play-id collision is preserved (no plays lost)', (t) => {
  // Each game has its own sequence counter; two games started
  // with no prior plays both produce `<today>-001`. listAll must
  // surface BOTH plays, not collapse them via findById's
  // first-match behavior.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runAgora(
    root,
    ['new', '--slug', 'a-game', '--kind', 'quest', '--title', 'A'],
    { GUILD_ACTOR: 'alice' },
  );
  runAgora(
    root,
    ['new', '--slug', 'b-game', '--kind', 'sandbox', '--title', 'B'],
    { GUILD_ACTOR: 'alice' },
  );
  runAgora(root, ['play', '--slug', 'a-game'], { GUILD_ACTOR: 'alice' });
  runAgora(root, ['play', '--slug', 'b-game'], { GUILD_ACTOR: 'alice' });

  const r = runAgora(
    root,
    ['list', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.plays.length, 2, 'both plays should appear despite shared id');
  const games = payload.plays.map((p: { game: string }) => p.game).sort();
  assert.deepEqual(games, ['a-game', 'b-game']);
});

test('agora list: --game filters plays to one game and drops games list', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runAgora(
    root,
    ['new', '--slug', 'a', '--kind', 'quest', '--title', 'A'],
    { GUILD_ACTOR: 'alice' },
  );
  runAgora(
    root,
    ['new', '--slug', 'b', '--kind', 'sandbox', '--title', 'B'],
    { GUILD_ACTOR: 'alice' },
  );
  runAgora(root, ['play', '--slug', 'a'], { GUILD_ACTOR: 'alice' });
  runAgora(root, ['play', '--slug', 'b'], { GUILD_ACTOR: 'alice' });

  const r = runAgora(
    root,
    ['list', '--game', 'a', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.games.length, 0, 'games dropped when --game specified');
  assert.equal(payload.plays.length, 1);
  assert.equal(payload.plays[0].game, 'a');
});

test('agora list: --state filters plays', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runAgora(
    root,
    ['new', '--slug', 'g', '--kind', 'quest', '--title', 'g'],
    { GUILD_ACTOR: 'alice' },
  );
  // Three plays — one stays playing, one suspended.
  runAgora(root, ['play', '--slug', 'g'], { GUILD_ACTOR: 'alice' });
  runAgora(root, ['play', '--slug', 'g'], { GUILD_ACTOR: 'alice' });
  runAgora(
    root,
    ['suspend', '2026-05-02-002'.replace('2026-05-02', new Date().toISOString().slice(0, 10)), '--cliff', 'c', '--invitation', 'i'],
    { GUILD_ACTOR: 'alice' },
  );

  const playing = JSON.parse(
    runAgora(root, ['list', '--state', 'playing', '--format', 'json'], {
      GUILD_ACTOR: 'alice',
    }).stdout,
  );
  const suspended = JSON.parse(
    runAgora(root, ['list', '--state', 'suspended', '--format', 'json'], {
      GUILD_ACTOR: 'alice',
    }).stdout,
  );
  assert.equal(playing.plays.length, 1);
  assert.equal(playing.plays[0].state, 'playing');
  assert.equal(suspended.plays.length, 1);
  assert.equal(suspended.plays[0].state, 'suspended');
});

test('agora list: --state with invalid value rejects', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runAgora(
    root,
    ['list', '--state', 'bogus'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--state must be one of playing\|suspended\|concluded/);
});

test('agora list: JSON envelope is snake_case (principle 11)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runAgora(
    root,
    ['new', '--slug', 'g', '--kind', 'quest', '--title', 'g'],
    { GUILD_ACTOR: 'alice' },
  );
  runAgora(root, ['play', '--slug', 'g'], { GUILD_ACTOR: 'alice' });

  const r = runAgora(
    root,
    ['list', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  const payload = JSON.parse(r.stdout);
  for (const key of Object.keys(payload)) {
    assert.ok(!/[A-Z]/.test(key), `top-level "${key}" must be snake_case`);
  }
  for (const g of payload.games) {
    for (const k of Object.keys(g)) {
      assert.ok(!/[A-Z]/.test(k), `games[].${k} must be snake_case`);
    }
  }
  for (const p of payload.plays) {
    for (const k of Object.keys(p)) {
      assert.ok(!/[A-Z]/.test(k), `plays[].${k} must be snake_case`);
    }
  }
});

test('agora list: rejects unknown flag (principle 10 input contract)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runAgora(
    root,
    ['list', '--bogus', 'x'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown flag.*--bogus/);
});
