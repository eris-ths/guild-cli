// gate boot — profile-aware text projection (#323, axis 1 of solo/swarm coexistence).
//
// Solo users on profile=standard should not see swarm-only signals in
// `gate boot --format text`. The JSON envelope is unchanged regardless
// of profile so orchestrators keep their contract.
//
// Signals suppressed under profile=standard text:
//   - session_id_unset hint
//   - active_overlapping_targets section
//   - parallel_session_authors warn
//
// JSON stays full-fidelity on every profile (regression guard).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(profile: 'standard' | 'swarm'): { root: string; cleanup: () => void } {
  const root = makeTempRoot('guild-boot-profile-');
  writeFileSync(
    join(root, 'guild.config.yaml'),
    `content_root: .\nhost_names: [human]\nprofile: ${profile}\n`,
  );
  mkdirSync(join(root, 'members'));
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  writeFileSync(
    join(root, 'members', 'leysia.yaml'),
    'name: leysia\ncategory: professional\nactive: true\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runGate(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; status: number } {
  const result = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { stdout: result.stdout, status: result.status ?? -1 };
}

function makeRequestWithTarget(
  root: string,
  from: string,
  action: string,
  target: string,
  sessionId?: string,
): string {
  const env: Record<string, string> = {};
  if (sessionId !== undefined) env.GUILD_SESSION_ID = sessionId;
  const r = spawnSync(
    process.execPath,
    [
      GATE, 'request',
      '--from', from,
      '--action', action,
      '--reason', 'profile projection test',
      '--target', target,
      '--format', 'json',
    ],
    { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`gate request failed: ${r.stderr}`);
  return JSON.parse(r.stdout).id as string;
}

// ---- session_id_unset hint (text mode) ----------------------------

test('gate boot text: profile=standard suppresses session_id_unset notice', () => {
  const { root, cleanup } = bootstrap('standard');
  try {
    const { stdout, status } = runGate(
      root,
      ['boot', '--format', 'text'],
      { GUILD_ACTOR: 'alice', GUILD_SESSION_ID: '' },
    );
    assert.equal(status, 0);
    assert.doesNotMatch(stdout, /no session_id resolved/);
    assert.doesNotMatch(stdout, /GUILD_SESSION_ID unset/);
  } finally {
    cleanup();
  }
});

test('gate boot text: profile=swarm shows session_id_unset notice', () => {
  const { root, cleanup } = bootstrap('swarm');
  try {
    const { stdout, status } = runGate(
      root,
      ['boot', '--format', 'text'],
      { GUILD_ACTOR: 'alice', GUILD_SESSION_ID: '' },
    );
    assert.equal(status, 0);
    assert.match(stdout, /no session_id resolved/);
    assert.match(stdout, /GUILD_SESSION_ID unset/);
  } finally {
    cleanup();
  }
});

// ---- active_overlapping_targets (text mode) -----------------------

test('gate boot text: profile=standard suppresses overlap section even when present', () => {
  const { root, cleanup } = bootstrap('standard');
  try {
    makeRequestWithTarget(root, 'alice', 'work A', 'src/shared');
    makeRequestWithTarget(root, 'leysia', 'work B', 'src/shared');

    const { stdout, status } = runGate(root, ['boot', '--format', 'text']);
    assert.equal(status, 0);
    assert.doesNotMatch(stdout, /active waves with overlapping target/);
    assert.doesNotMatch(stdout, /coordinate via .gate witness/);
  } finally {
    cleanup();
  }
});

test('gate boot text: profile=swarm shows overlap section when present', () => {
  const { root, cleanup } = bootstrap('swarm');
  try {
    makeRequestWithTarget(root, 'alice', 'work A', 'src/shared');
    makeRequestWithTarget(root, 'leysia', 'work B', 'src/shared');

    const { stdout, status } = runGate(root, ['boot', '--format', 'text']);
    assert.equal(status, 0);
    assert.match(stdout, /active waves with overlapping target:/);
    assert.match(stdout, /target: src\/shared/);
  } finally {
    cleanup();
  }
});

// ---- JSON envelope unchanged (regression) -------------------------

test('gate boot JSON: profile=standard preserves all fields (envelope unchanged)', () => {
  const { root, cleanup } = bootstrap('standard');
  try {
    // Trigger overlap so active_overlapping_targets is non-empty.
    makeRequestWithTarget(root, 'alice', 'work A', 'src/shared', 'alice-tmux-1');
    makeRequestWithTarget(root, 'alice', 'work B', 'src/shared', 'alice-tmux-2');

    const { stdout, status } = runGate(
      root,
      ['boot'],
      { GUILD_ACTOR: 'alice', GUILD_SESSION_ID: '' },
    );
    assert.equal(status, 0);
    const payload = JSON.parse(stdout);

    // session_id_unset hint still present in JSON
    assert.equal(payload.hints.session_id_unset, true);
    // overlap still present in JSON
    assert.equal(Array.isArray(payload.active_overlapping_targets), true);
    assert.equal(payload.active_overlapping_targets.length, 1);
    assert.equal(payload.active_overlapping_targets[0].target, 'src/shared');
    // parallel_session_authors still present in JSON
    const entry = payload.active_overlapping_targets[0];
    assert.ok(entry.parallel_session_authors);
    assert.deepEqual(
      entry.parallel_session_authors.alice,
      ['alice-tmux-1', 'alice-tmux-2'],
    );
  } finally {
    cleanup();
  }
});

test('gate boot JSON: profile=swarm preserves all fields (envelope unchanged)', () => {
  const { root, cleanup } = bootstrap('swarm');
  try {
    makeRequestWithTarget(root, 'alice', 'work A', 'src/shared', 'alice-tmux-1');
    makeRequestWithTarget(root, 'alice', 'work B', 'src/shared', 'alice-tmux-2');

    const { stdout, status } = runGate(
      root,
      ['boot'],
      { GUILD_ACTOR: 'alice', GUILD_SESSION_ID: '' },
    );
    assert.equal(status, 0);
    const payload = JSON.parse(stdout);

    assert.equal(payload.hints.session_id_unset, true);
    assert.equal(payload.active_overlapping_targets.length, 1);
    assert.equal(payload.active_overlapping_targets[0].target, 'src/shared');
    const entry = payload.active_overlapping_targets[0];
    assert.ok(entry.parallel_session_authors);
    assert.deepEqual(
      entry.parallel_session_authors.alice,
      ['alice-tmux-1', 'alice-tmux-2'],
    );
  } finally {
    cleanup();
  }
});

// ---- parallel_session_authors warn (text mode) --------------------

test('gate boot text: profile=standard suppresses parallel-session warning', () => {
  const { root, cleanup } = bootstrap('standard');
  try {
    makeRequestWithTarget(root, 'alice', 'work A', 'src/shared', 'alice-tmux-1');
    makeRequestWithTarget(root, 'alice', 'work B', 'src/shared', 'alice-tmux-2');

    const { stdout, status } = runGate(root, ['boot', '--format', 'text']);
    assert.equal(status, 0);
    assert.doesNotMatch(stdout, /same-actor parallel sessions/);
  } finally {
    cleanup();
  }
});

test('gate boot text: profile=swarm shows parallel-session warning', () => {
  const { root, cleanup } = bootstrap('swarm');
  try {
    makeRequestWithTarget(root, 'alice', 'work A', 'src/shared', 'alice-tmux-1');
    makeRequestWithTarget(root, 'alice', 'work B', 'src/shared', 'alice-tmux-2');

    const { stdout, status } = runGate(root, ['boot', '--format', 'text']);
    assert.equal(status, 0);
    assert.match(stdout, /same-actor parallel sessions: alice/);
  } finally {
    cleanup();
  }
});
