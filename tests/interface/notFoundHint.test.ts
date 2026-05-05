// `not found: <id>` is too terse — a fresh agent that mistyped a
// request id had no signal toward `gate list` / `gate tail`. The
// shared helper attaches a per-entity discovery hint so the
// touch-feel of "I lost my id" recovers in one read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { notFoundMessage } from '../../src/interface/shared/notFoundHint.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');
const GUILD = resolve(here, '../../../bin/guild.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-not-found-hint-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: []\n',
  );
  mkdirSync(join(root, 'members'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(
  bin: string,
  cwd: string,
  args: string[],
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    env: { ...process.env, GUILD_ACTOR: 'alice' },
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

// --- unit: the helper formats per-entity ---

test('notFoundMessage: request gains gate-list hint', () => {
  const out = notFoundMessage('request', '2026-05-05-9999');
  assert.match(out, /^not found: 2026-05-05-9999\n/);
  assert.match(out, /try 'gate list' or 'gate tail'/);
});

test('notFoundMessage: issue uses the issue-list hint and prefix', () => {
  const out = notFoundMessage('issue', 'i-2026-05-05-0001');
  // Issue keeps the historical "issue not found:" prefix so any
  // operator grepping for it across runbooks still matches.
  assert.match(out, /^issue not found: i-2026-05-05-0001\n/);
  assert.match(out, /try 'gate issues list'/);
});

test('notFoundMessage: member uses the guild-list hint', () => {
  const out = notFoundMessage('member', 'ghost');
  assert.match(out, /^not found: ghost\n/);
  assert.match(out, /try 'guild list'/);
});

// --- e2e: the helper is wired into the user-facing read paths ---

test('gate show <bad-id>: emits the discovery hint', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice']);
  const r = run(GATE, root, ['show', '2026-05-05-9999']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not found: 2026-05-05-9999/);
  assert.match(r.stderr, /try 'gate list' or 'gate tail'/);
});

test('guild show <bad-name>: emits the member discovery hint', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice']);
  const r = run(GUILD, root, ['show', 'ghost']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not found: ghost/);
  assert.match(r.stderr, /try 'guild list'/);
});
