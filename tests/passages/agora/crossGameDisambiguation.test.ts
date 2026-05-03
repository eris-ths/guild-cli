// Pin agora move/suspend/resume/conclude cross-game ID disambiguation.
//
// Surfaced by issue i-2026-05-03-0002 (develop dogfood, going-inside-
// harness experiment): plays are sequenced per-game-per-day, so two
// games each opened on the same day both produce YYYY-MM-DD-001. The
// repository's findById walks game subdirectories and returns the
// first match — silently mis-resolving the caller's intent when the
// collision is real.
//
// agora show already disambiguates with this pattern. This test
// covers the four state-mutating verbs that previously called
// findById directly: move, suspend, resume, conclude.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const AGORA = resolve(here, '../../../../bin/agora.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'agora-cross-game-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  for (const d of ['members', 'requests', 'issues', 'inbox']) {
    mkdirSync(join(root, d));
  }
  for (const s of ['pending', 'approved', 'executing', 'completed', 'failed', 'denied']) {
    mkdirSync(join(root, 'requests', s));
  }
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runAgora(
  cwd: string,
  args: string[],
): { stdout: string; stderr: string; status: number } {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  env['GUILD_ACTOR'] = 'alice';
  const r = spawnSync(process.execPath, [AGORA, ...args], {
    cwd,
    env,
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

function seedTwoCollidingPlays(root: string): { idA: string; idB: string } {
  // Two games, each with a play started today → both get YYYY-MM-DD-001.
  runAgora(root, ['new', '--slug', 'aaa-game', '--kind', 'sandbox', '--title', 'A']);
  runAgora(root, ['new', '--slug', 'bbb-game', '--kind', 'sandbox', '--title', 'B']);
  const a = runAgora(root, ['play', '--slug', 'aaa-game']);
  const b = runAgora(root, ['play', '--slug', 'bbb-game']);
  // Both play_ids should match the same YYYY-MM-DD-001 shape; extract
  // by parsing the success line.
  const idA = (a.stdout.match(/play started: (\S+)/) ?? [])[1] ?? '';
  const idB = (b.stdout.match(/play started: (\S+)/) ?? [])[1] ?? '';
  assert.equal(idA, idB, 'collision setup: both plays should share id');
  return { idA, idB };
}

// ---- move ----

test('agora move: cross-game id collision is rejected with --game suggestion', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const { idA } = seedTwoCollidingPlays(root);
  const r = runAgora(root, ['move', idA, '--text', 'hello']);
  assert.equal(r.status, 1, `expected exit 1 on ambiguous id; stdout: ${r.stdout}`);
  assert.match(r.stderr, /multiple games have a play with id/);
  assert.match(r.stderr, /--game <slug>/);
  assert.match(r.stderr, /aaa-game/);
  assert.match(r.stderr, /bbb-game/);
});

test('agora move --game disambiguates and lands the move on the named game', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const { idA } = seedTwoCollidingPlays(root);
  const r = runAgora(root, ['move', idA, '--game', 'bbb-game', '--text', 'hi-bbb']);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  // Verify the move landed on bbb's play, not aaa's, by listing.
  const list = runAgora(root, ['list', '--game', 'bbb-game']);
  assert.match(list.stdout, /moves=1/);
  const listA = runAgora(root, ['list', '--game', 'aaa-game']);
  assert.match(listA.stdout, /moves=0/);
});

test('agora move --game with mismatched slug → not found', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const { idA } = seedTwoCollidingPlays(root);
  const r = runAgora(root, ['move', idA, '--game', 'no-such-game', '--text', 'x']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not found|PlayNotFound/);
});

// ---- suspend ----

test('agora suspend: cross-game collision rejected with --game hint', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const { idA } = seedTwoCollidingPlays(root);
  const r = runAgora(
    root,
    ['suspend', idA, '--cliff', 'c', '--invitation', 'i'],
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /multiple games have a play/);
});

test('agora suspend --game disambiguates correctly', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const { idA } = seedTwoCollidingPlays(root);
  const r = runAgora(
    root,
    ['suspend', idA, '--game', 'aaa-game', '--cliff', 'paused-aaa', '--invitation', 'next'],
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
});

// ---- resume ----

test('agora resume: cross-game collision rejected with --game hint', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const { idA } = seedTwoCollidingPlays(root);
  // Suspend both first so they're each in resumable state.
  runAgora(
    root,
    ['suspend', idA, '--game', 'aaa-game', '--cliff', 'c', '--invitation', 'i'],
  );
  runAgora(
    root,
    ['suspend', idA, '--game', 'bbb-game', '--cliff', 'c', '--invitation', 'i'],
  );
  const r = runAgora(root, ['resume', idA]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /multiple games have a play/);
});

test('agora resume --game disambiguates correctly', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const { idA } = seedTwoCollidingPlays(root);
  runAgora(
    root,
    ['suspend', idA, '--game', 'bbb-game', '--cliff', 'c', '--invitation', 'i'],
  );
  const r = runAgora(root, ['resume', idA, '--game', 'bbb-game']);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
});

// ---- conclude ----

test('agora conclude: cross-game collision rejected with --game hint', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const { idA } = seedTwoCollidingPlays(root);
  const r = runAgora(root, ['conclude', idA]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /multiple games have a play/);
});

test('agora conclude --game disambiguates correctly', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const { idA } = seedTwoCollidingPlays(root);
  const r = runAgora(root, ['conclude', idA, '--game', 'aaa-game', '--note', 'closing']);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
});

// ---- single-game (no collision) — verbs still work without --game ----

test('agora move on a single-game play_id works without --game (backward compat)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runAgora(root, ['new', '--slug', 'only-game', '--kind', 'sandbox', '--title', 'O']);
  const p = runAgora(root, ['play', '--slug', 'only-game']);
  const id = (p.stdout.match(/play started: (\S+)/) ?? [])[1] ?? '';
  const r = runAgora(root, ['move', id, '--text', 'hello']);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
});
