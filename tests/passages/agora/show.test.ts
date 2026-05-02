// agora show — detail view of one game or one play.
//
// Pins:
//   - argument auto-disambiguation (play-id pattern vs game slug)
//   - game detail rendering (text + JSON)
//   - play detail rendering with full move + suspension/resume history
//   - cross-game play-id collision: error without --game, success with
//   - --game with already-game-shaped argument is refused (clarity)
//   - missing game / missing play surface clear errors

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
  const root = mkdtempSync(join(tmpdir(), 'agora-show-'));
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

test('agora show <slug>: text mode renders the game definition', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runAgora(
    root,
    [
      'new', '--slug', 'demo',
      '--kind', 'sandbox',
      '--title', 'Demo Game',
      '--description', 'a sandbox',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  const r = runAgora(root, ['show', 'demo'], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /game: demo\s+\[sandbox\]/);
  assert.match(r.stdout, /title:\s+Demo Game/);
  assert.match(r.stdout, /description: a sandbox/);
  assert.match(r.stdout, /created_by: alice/);
});

test('agora show <slug>: JSON mode emits snake_case game payload', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runAgora(
    root,
    ['new', '--slug', 'demo', '--kind', 'quest', '--title', 'Demo'],
    { GUILD_ACTOR: 'alice' },
  );
  const r = runAgora(
    root,
    ['show', 'demo', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.slug, 'demo');
  assert.equal(payload.kind, 'quest');
  for (const k of Object.keys(payload)) {
    assert.ok(!/[A-Z]/.test(k), `key "${k}" must be snake_case`);
  }
});

test('agora show <play-id>: text mode renders moves + suspension history', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runAgora(
    root,
    ['new', '--slug', 'g', '--kind', 'sandbox', '--title', 'g'],
    { GUILD_ACTOR: 'alice' },
  );
  const playId = JSON.parse(
    runAgora(root, ['play', '--slug', 'g', '--format', 'json'], {
      GUILD_ACTOR: 'alice',
    }).stdout,
  ).play_id;

  // Build a multi-cycle history: move → suspend → resume → move → suspend
  runAgora(root, ['move', playId, '--text', 'first move'], { GUILD_ACTOR: 'alice' });
  runAgora(
    root,
    ['suspend', playId, '--cliff', 'cliff one', '--invitation', 'invite one'],
    { GUILD_ACTOR: 'alice' },
  );
  runAgora(
    root,
    ['resume', playId, '--note', 'addressed'],
    { GUILD_ACTOR: 'alice' },
  );
  runAgora(root, ['move', playId, '--text', 'second move'], { GUILD_ACTOR: 'alice' });
  runAgora(
    root,
    ['suspend', playId, '--cliff', 'cliff two', '--invitation', 'invite two'],
    { GUILD_ACTOR: 'alice' },
  );

  const r = runAgora(root, ['show', playId], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, new RegExp(`play: ${playId}\\s+\\[suspended ↺\\]`));
  assert.match(r.stdout, /moves \(2\):/);
  assert.match(r.stdout, /first move/);
  assert.match(r.stdout, /second move/);
  assert.match(r.stdout, /suspensions \(2\):/);
  // First suspension: closed with resume note
  assert.match(r.stdout, /cliff:\s+cliff one/);
  assert.match(r.stdout, /↺ resumed at .* by alice/);
  assert.match(r.stdout, /note: addressed/);
  // Second suspension: still open
  assert.match(r.stdout, /cliff:\s+cliff two/);
  assert.match(r.stdout, /\(still open — agora resume/);
});

test('agora show <play-id>: cross-game collision errors without --game and lists candidates', (t) => {
  // Two games each with their own first play ⇒ same id; show must
  // refuse to silently pick one.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runAgora(root, ['new', '--slug', 'a-game', '--kind', 'quest', '--title', 'A'], {
    GUILD_ACTOR: 'alice',
  });
  runAgora(root, ['new', '--slug', 'b-game', '--kind', 'sandbox', '--title', 'B'], {
    GUILD_ACTOR: 'alice',
  });
  runAgora(root, ['play', '--slug', 'a-game'], { GUILD_ACTOR: 'alice' });
  runAgora(root, ['play', '--slug', 'b-game'], { GUILD_ACTOR: 'alice' });

  const today = new Date().toISOString().slice(0, 10);
  const playId = `${today}-001`;

  const ambiguous = runAgora(root, ['show', playId], { GUILD_ACTOR: 'alice' });
  assert.notEqual(ambiguous.status, 0);
  assert.match(ambiguous.stderr, /multiple games have a play with id/);
  assert.match(ambiguous.stderr, /Disambiguate with --game/);
  assert.match(ambiguous.stderr, /a-game.*b-game|b-game.*a-game/);

  // With --game, succeeds
  const disambiguated = runAgora(
    root,
    ['show', playId, '--game', 'a-game'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(disambiguated.status, 0);
  assert.match(disambiguated.stdout, /game:\s+a-game/);
});

test('agora show: --game with a game-slug argument is refused (clarity)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runAgora(root, ['new', '--slug', 'g', '--kind', 'quest', '--title', 'g'], {
    GUILD_ACTOR: 'alice',
  });
  const r = runAgora(
    root,
    ['show', 'g', '--game', 'g'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--game is for disambiguating play ids/);
});

test('agora show: missing game produces a clear error with create hint', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runAgora(root, ['show', 'missing'], { GUILD_ACTOR: 'alice' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /game "missing" not found/);
  assert.match(r.stderr, /agora list/);
  assert.match(r.stderr, /agora new --slug missing/);
});

test('agora show: missing play produces a clear error', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const today = new Date().toISOString().slice(0, 10);
  const r = runAgora(
    root,
    ['show', `${today}-999`],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /play .* not found/);
});

test('agora show: missing positional argument fails clearly', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runAgora(root, ['show'], { GUILD_ACTOR: 'alice' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /positional <slug-or-play-id> required/);
});

test('agora show: rejects unknown flag (principle 10 input contract)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runAgora(root, ['new', '--slug', 'g', '--kind', 'quest', '--title', 'g'], {
    GUILD_ACTOR: 'alice',
  });
  const r = runAgora(
    root,
    ['show', 'g', '--bogus', 'x'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown flag.*--bogus/);
});
