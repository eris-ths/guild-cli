// agora last + agora cliff — sugar verbs that answer the daily-use
// questions "which play am I in?" and "what was I about to do?".
//
// Pins the contract:
//   - last: actor scoped, defaults to open (playing|suspended), sorts by
//     started_at desc, exits 0 with a null payload when nothing matches
//   - cliff: read-only peek of the closing cliff/invitation, distinguishes
//     active (next-resume-closes-it) vs historical (already-resumed)
//   - both verbs match agora's JSON envelope conventions: snake_case,
//     ok-flag, no surprise stdout in failure paths

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const AGORA = resolve(here, '../../../../bin/agora.mjs');
const GATE = resolve(here, '../../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'agora-sugar-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  mkdirSync(join(root, 'members'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(
  bin: string,
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [bin, ...args], {
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

function seedAlice(root: string): void {
  run(GATE, root, ['register', '--name', 'alice', '--category', 'professional']);
}

// --- agora last ---

test('agora last: empty content_root returns null payload (no error)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedAlice(root);
  const r = run(AGORA, root, ['last', '--format', 'json'], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.play, null);
});

test('agora last: returns the most recently started open play for the actor', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedAlice(root);
  // Two plays in the same game; the second is the most recent.
  run(AGORA, root, ['new', '--slug', 'g1', '--kind', 'sandbox', '--title', 'g1'], {
    GUILD_ACTOR: 'alice',
  });
  const first = run(AGORA, root, ['play', '--slug', 'g1', '--format', 'json'], {
    GUILD_ACTOR: 'alice',
  });
  const firstPayload = JSON.parse(first.stdout);
  // Sleep a millisecond to guarantee different started_at.
  // Tiny but enough; agora plays are sequenced per-game-per-day so
  // the id collides — we need started_at to differ for the sort.
  const wait = run(process.execPath, root, [
    '-e',
    'setTimeout(()=>{},10); require("fs").writeFileSync("/dev/null","x")',
  ]);
  void wait;
  const r = run(AGORA, root, ['last', '--format', 'json'], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.play.id, firstPayload.play_id);
  assert.equal(payload.play.game, 'g1');
  assert.equal(payload.play.state, 'playing');
  assert.equal(payload.play.started_by, 'alice');
});

test('agora last: surfaces closing cliff/invitation when state=suspended', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedAlice(root);
  run(AGORA, root, ['new', '--slug', 'g2', '--kind', 'sandbox', '--title', 'g2'], {
    GUILD_ACTOR: 'alice',
  });
  const play = JSON.parse(
    run(AGORA, root, ['play', '--slug', 'g2', '--format', 'json'], {
      GUILD_ACTOR: 'alice',
    }).stdout,
  );
  run(AGORA, root, [
    'suspend', play.play_id, '--by', 'alice',
    '--cliff', 'paused mid-thought',
    '--invitation', 'pick up from the contradiction',
  ]);
  const r = run(AGORA, root, ['last', '--format', 'json'], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.play.state, 'suspended');
  assert.equal(payload.play.closing_cliff, 'paused mid-thought');
  assert.equal(payload.play.closing_invitation, 'pick up from the contradiction');
});

test('agora last: excludes concluded plays by default; --include-concluded surfaces them', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedAlice(root);
  run(AGORA, root, ['new', '--slug', 'g3', '--kind', 'sandbox', '--title', 'g3'], {
    GUILD_ACTOR: 'alice',
  });
  const play = JSON.parse(
    run(AGORA, root, ['play', '--slug', 'g3', '--format', 'json'], {
      GUILD_ACTOR: 'alice',
    }).stdout,
  );
  run(AGORA, root, ['conclude', play.play_id, '--by', 'alice', '--note', 'done']);

  // Default: no open play exists → null
  const r1 = run(AGORA, root, ['last', '--format', 'json'], { GUILD_ACTOR: 'alice' });
  assert.equal(JSON.parse(r1.stdout).play, null);

  // --include-concluded: surfaces the concluded play
  const r2 = run(
    AGORA,
    root,
    ['last', '--include-concluded', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  const p = JSON.parse(r2.stdout).play;
  assert.equal(p.state, 'concluded');
  assert.equal(p.id, play.play_id);
});

test('agora last: --by overrides GUILD_ACTOR; missing actor errors clearly', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedAlice(root);
  run(GATE, root, ['register', '--name', 'bob', '--category', 'professional']);
  run(AGORA, root, ['new', '--slug', 'gb', '--kind', 'sandbox', '--title', 'gb'], {
    GUILD_ACTOR: 'bob',
  });
  run(AGORA, root, ['play', '--slug', 'gb'], { GUILD_ACTOR: 'bob' });

  // --by bob picks up bob's play even though caller is alice
  const r = run(AGORA, root, ['last', '--by', 'bob', '--format', 'json'], {
    GUILD_ACTOR: 'alice',
  });
  assert.equal(JSON.parse(r.stdout).play.started_by, 'bob');

  // No --by, no GUILD_ACTOR → error
  const r2 = run(AGORA, root, ['last']);
  assert.notEqual(r2.status, 0);
  assert.match(r2.stderr, /--by required/);
});

test('agora last: text mode renders one-line summary + cliff lines when suspended', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedAlice(root);
  run(AGORA, root, ['new', '--slug', 'gt', '--kind', 'sandbox', '--title', 'gt'], {
    GUILD_ACTOR: 'alice',
  });
  const play = JSON.parse(
    run(AGORA, root, ['play', '--slug', 'gt', '--format', 'json'], {
      GUILD_ACTOR: 'alice',
    }).stdout,
  );
  run(AGORA, root, [
    'suspend', play.play_id, '--by', 'alice',
    '--cliff', 'C', '--invitation', 'I',
  ]);
  const r = run(AGORA, root, ['last'], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\[suspended ↺\]/);
  assert.match(r.stdout, /closing cliff:/);
  assert.match(r.stdout, /closing invitation:/);
});

// --- agora cliff ---

test('agora cliff: never-suspended play returns helpful "no cliff" message', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedAlice(root);
  run(AGORA, root, ['new', '--slug', 'gc1', '--kind', 'sandbox', '--title', 'gc1'], {
    GUILD_ACTOR: 'alice',
  });
  const play = JSON.parse(
    run(AGORA, root, ['play', '--slug', 'gc1', '--format', 'json'], {
      GUILD_ACTOR: 'alice',
    }).stdout,
  );
  const r = run(AGORA, root, ['cliff', play.play_id, '--format', 'json']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.cliff, null);
  assert.equal(payload.invitation, null);
  assert.match(payload.note, /never been suspended/);
});

test('agora cliff: suspended play surfaces active=true with cliff/invitation/timestamps', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedAlice(root);
  run(AGORA, root, ['new', '--slug', 'gc2', '--kind', 'sandbox', '--title', 'gc2'], {
    GUILD_ACTOR: 'alice',
  });
  const play = JSON.parse(
    run(AGORA, root, ['play', '--slug', 'gc2', '--format', 'json'], {
      GUILD_ACTOR: 'alice',
    }).stdout,
  );
  run(AGORA, root, [
    'suspend', play.play_id, '--by', 'alice',
    '--cliff', 'C2', '--invitation', 'I2',
  ]);
  const r = run(AGORA, root, ['cliff', play.play_id, '--format', 'json']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.cliff, 'C2');
  assert.equal(payload.invitation, 'I2');
  assert.equal(payload.active, true);
  assert.equal(typeof payload.suspended_at, 'string');
  assert.equal(payload.suspended_by, 'alice');
  assert.equal(payload.resumed_at, undefined, 'no resume yet');
});

test('agora cliff: resumed play surfaces active=false with both timestamps', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedAlice(root);
  run(AGORA, root, ['new', '--slug', 'gc3', '--kind', 'sandbox', '--title', 'gc3'], {
    GUILD_ACTOR: 'alice',
  });
  const play = JSON.parse(
    run(AGORA, root, ['play', '--slug', 'gc3', '--format', 'json'], {
      GUILD_ACTOR: 'alice',
    }).stdout,
  );
  run(AGORA, root, [
    'suspend', play.play_id, '--by', 'alice',
    '--cliff', 'C3', '--invitation', 'I3',
  ]);
  run(AGORA, root, ['resume', play.play_id, '--by', 'alice']);

  const r = run(AGORA, root, ['cliff', play.play_id, '--format', 'json']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.cliff, 'C3');
  assert.equal(payload.active, false);
  assert.equal(typeof payload.resumed_at, 'string');
  assert.equal(payload.resumed_by, 'alice');
});

test('agora cliff: missing positional surfaces a clear error', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedAlice(root);
  const r = run(AGORA, root, ['cliff']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /requires a play-id positional/);
});

test('agora cliff: unknown play-id errors with not-found', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedAlice(root);
  const r = run(AGORA, root, ['cliff', '2099-01-01-001']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not found/);
});
