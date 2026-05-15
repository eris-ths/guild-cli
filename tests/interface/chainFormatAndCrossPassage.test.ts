// gate chain — read-verb symmetry catchup:
//   (1) --format text|json (previously rejected --format outright)
//   (2) cross-passage: request-shaped ids resolving to agora plays
//       no longer render as "referenced but not found"; they label
//       the agora play instead.
//
// Surfaces this test pins:
//   - --format json emits the structured payload
//   - --format text remains the default
//   - an agora play id referenced from a request resolves to the
//     play (game + state) in both formats
//   - multi-game match: same play id in two games surfaces both

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');
const AGORA = resolve(here, '../../../bin/agora.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-chain-xpass-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
  );
  for (const d of ['members', 'requests', 'issues', 'inbox']) {
    mkdirSync(join(root, d));
  }
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    `name: alice\ncategory: professional\nactive: true\n`,
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runBin(
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

function seedAgoraPlay(root: string, slug: string, title: string): string {
  // Create game then play. Returns the play id (today + 001 for a
  // fresh content_root scoped to this slug).
  runBin(AGORA, root, [
    'new', '--slug', slug, '--kind', 'sandbox',
    '--title', title, '--by', 'eris',
  ]);
  runBin(AGORA, root, [
    'play', '--slug', slug, '--by', 'eris',
  ]);
  const today = new Date().toISOString().slice(0, 10);
  return `${today}-001`;
}

function seedGateRequestMentioning(root: string, mentionId: string): string {
  // Fast-track a request whose reason text mentions the given id.
  // Chain's extractor pulls the request-id-shaped substring out of
  // free text — this is what real cross-passage references look like.
  runBin(GATE, root, [
    'fast-track',
    '--from', 'eris',
    '--action', 'cross-passage smoke',
    '--reason', `see agora play ${mentionId} for the deliberation`,
    '--executors', 'alice',
  ]);
  const today = new Date().toISOString().slice(0, 10);
  return `${today}-0001`;
}

test('gate chain <id> --format text remains the default tree render', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const playId = seedAgoraPlay(root, 'a-game', 'a game');
  const reqId = seedGateRequestMentioning(root, playId);
  const r = runBin(GATE, root, ['chain', reqId]);
  assert.equal(r.status, 0);
  // Tree characters present.
  assert.match(r.stdout, /referenced requests/);
  assert.match(r.stdout, new RegExp(playId));
  // The agora play id should label as a cross-passage hit instead of
  // bare "referenced but not found".
  assert.match(r.stdout, /agora play \(game=a-game/);
  assert.doesNotMatch(r.stdout, /referenced but not found/);
});

test('gate chain <id> --format json emits the structured payload', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const playId = seedAgoraPlay(root, 'b-game', 'b game');
  const reqId = seedGateRequestMentioning(root, playId);
  const r = runBin(GATE, root, ['chain', reqId, '--format', 'json']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.root.id, reqId);
  assert.equal(payload.root.kind, 'request');
  // Forward request section has the agora-resolved id.
  const fwd = payload.forward.requests;
  assert.ok(Array.isArray(fwd));
  assert.equal(fwd.length, 1);
  assert.equal(fwd[0].id, playId);
  assert.equal(fwd[0].found, false); // not found in gate request store
  // Cross-passage marker present and well-shaped.
  assert.ok(fwd[0].cross_passage);
  assert.equal(fwd[0].cross_passage.passage, 'agora');
  assert.equal(fwd[0].cross_passage.matches.length, 1);
  assert.equal(fwd[0].cross_passage.matches[0].gameSlug, 'b-game');
});

test('gate chain --format unknown is rejected with a clear error', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const playId = seedAgoraPlay(root, 'c-game', 'c game');
  const reqId = seedGateRequestMentioning(root, playId);
  const r = runBin(GATE, root, ['chain', reqId, '--format', 'yaml']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--format must be 'json' or 'text'/);
});

test('agora play id present in multiple games surfaces every match', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // Two games created on the same day, each plays starts at -001 in
  // its own per-game sequence space. So both end up with the same
  // play id but different game slugs.
  const playId = seedAgoraPlay(root, 'd-game', 'd game');
  const playId2 = seedAgoraPlay(root, 'e-game', 'e game');
  assert.equal(playId, playId2, 'sanity: per-game seq starts at 001 so ids collide');
  const reqId = seedGateRequestMentioning(root, playId);
  const r = runBin(GATE, root, ['chain', reqId, '--format', 'json']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  const matches = payload.forward.requests[0].cross_passage.matches;
  assert.equal(matches.length, 2);
  const slugs = matches.map((m: { gameSlug: string }) => m.gameSlug).sort();
  assert.deepEqual(slugs, ['d-game', 'e-game']);
});
