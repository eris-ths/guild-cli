// gate complete --cliff <s> — forward-pointing close note contract.
//
// Pins:
//   1. --cliff persists onto the terminal status_log entry
//   2. top-level `cliff` field appears on `gate show --format json`
//   3. boot surfaces past_cliffs for the closing actor (authored OR
//      executed wave) and only for completed-with-cliff records
//   4. past_cliffs is null when no actor is resolved (global-view boot)
//   5. past_cliffs honours --since (delta-filter semantic)
//   6. v1 scope: cliff only on completed transitions — empty cliff
//      doesn't add the field (sanitize-then-omit pattern)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = makeTempRoot('guild-cliff-');
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  mkdirSync(join(root, 'members'));
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  writeFileSync(
    join(root, 'members', 'bob.yaml'),
    'name: bob\ncategory: professional\nactive: true\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runGate(cwd: string, args: string[], env: Record<string, string> = {}): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status ?? -1 };
}

function completeOneShot(root: string, from: string, action: string, opts?: { cliff?: string; note?: string }): string {
  const r = runGate(root, ['request', '--from', from, '--action', action, '--reason', 'r', '--executors', from]);
  const m = r.stdout.match(/created: (\S+)/);
  assert.ok(m, `failed to parse id from ${r.stdout}`);
  const id = m![1]!;
  runGate(root, ['approve', id, '--by', from]);
  runGate(root, ['execute', id, '--by', from]);
  const args = ['complete', id, '--by', from];
  if (opts?.note) args.push('--note', opts.note);
  if (opts?.cliff) args.push('--cliff', opts.cliff);
  const c = runGate(root, args);
  assert.equal(c.status, 0, `complete failed: ${c.stderr}`);
  return id;
}

test('gate complete --cliff: persists on terminal status_log entry + top-level projection', () => {
  const { root, cleanup } = bootstrap();
  try {
    const id = completeOneShot(root, 'alice', 'do stuff', {
      note: 'did it',
      cliff: 'next agent should verify with bob',
    });
    const { stdout } = runGate(root, ['show', id, '--format', 'json']);
    const payload = JSON.parse(stdout);
    assert.equal(payload.cliff, 'next agent should verify with bob',
      'top-level cliff projection should appear on completed request');
    const last = payload.status_log[payload.status_log.length - 1];
    assert.equal(last.state, 'completed');
    assert.equal(last.cliff, 'next agent should verify with bob',
      'cliff persists on terminal status_log entry');
  } finally {
    cleanup();
  }
});

test('gate complete: omitted --cliff means no cliff field anywhere', () => {
  const { root, cleanup } = bootstrap();
  try {
    const id = completeOneShot(root, 'alice', 'plain complete');
    const { stdout } = runGate(root, ['show', id, '--format', 'json']);
    const payload = JSON.parse(stdout);
    assert.equal(payload.cliff, undefined, 'no top-level cliff when none provided');
    const last = payload.status_log[payload.status_log.length - 1];
    assert.equal(last.cliff, undefined, 'no entry-level cliff when none provided');
  } finally {
    cleanup();
  }
});

test('boot past_cliffs: surfaces authored-actor cliffs newest first', () => {
  const { root, cleanup } = bootstrap();
  try {
    completeOneShot(root, 'alice', 'first', { cliff: 'cliff one' });
    completeOneShot(root, 'alice', 'second', { cliff: 'cliff two' });
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'alice' });
    const payload = JSON.parse(stdout);
    assert.ok(Array.isArray(payload.past_cliffs), 'past_cliffs is array for resolved actor');
    assert.equal(payload.past_cliffs.length, 2);
    // Newest first — second completion has the later closed_at.
    assert.equal(payload.past_cliffs[0].cliff, 'cliff two');
    assert.equal(payload.past_cliffs[1].cliff, 'cliff one');
    assert.equal(payload.past_cliffs[0].closed_by, 'alice');
    assert.equal(payload.past_cliffs[0].action, 'second');
  } finally {
    cleanup();
  }
});

test('boot past_cliffs: null when GUILD_ACTOR is unresolved (global-view boot)', () => {
  const { root, cleanup } = bootstrap();
  try {
    completeOneShot(root, 'alice', 'authored by alice', { cliff: 'pointer' });
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: '' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.past_cliffs, null,
      'global-view boot should not invent past_cliffs (no self to attach to)');
  } finally {
    cleanup();
  }
});

test('boot past_cliffs: empty array when actor has no cliff-stamped closures', () => {
  const { root, cleanup } = bootstrap();
  try {
    completeOneShot(root, 'alice', 'plain', { note: 'no cliff here' });
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'alice' });
    const payload = JSON.parse(stdout);
    assert.deepEqual(payload.past_cliffs, [],
      'no cliff-stamped closures → empty array, not null');
  } finally {
    cleanup();
  }
});

test('boot past_cliffs: honours --since (cliffs older than cutoff are filtered out)', () => {
  const { root, cleanup } = bootstrap();
  try {
    completeOneShot(root, 'alice', 'pre-cutoff', { cliff: 'old' });
    const future = '2099-01-01T00:00:00.000Z';
    const { stdout } = runGate(root, ['boot', '--since', future], { GUILD_ACTOR: 'alice' });
    const payload = JSON.parse(stdout);
    assert.deepEqual(payload.past_cliffs, [],
      '--since cutoff after the close should filter cliff out');
  } finally {
    cleanup();
  }
});

test('boot past_cliffs: text mode renders the section when cliffs exist', () => {
  const { root, cleanup } = bootstrap();
  try {
    completeOneShot(root, 'alice', 'rendered', { cliff: 'render-me' });
    const { stdout } = runGate(root, ['boot', '--format', 'text'], { GUILD_ACTOR: 'alice' });
    assert.match(stdout, /past selves left these cliffs/);
    assert.match(stdout, /render-me/);
  } finally {
    cleanup();
  }
});
