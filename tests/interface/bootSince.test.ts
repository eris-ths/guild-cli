// gate boot --since <ISO-timestamp> — delta-filter contract.
//
// The token-cost lever: agents pass the previous boot's
// `last_activity` to receive only new utterances + inbox messages.
// This pins:
//   1. valid ISO timestamps are accepted and echoed back
//   2. malformed inputs are rejected with the "next: " hint
//   3. tail / your_recent / inbox_unread filter strictly on `at > since`
//   4. status.inbox_unread SCALAR stays truthful even when surface
//      entries are filtered out (orientation accuracy)
//   5. last_activity itself is NOT filtered (so the chain works)

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
  const root = makeTempRoot('guild-boot-since-');
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

test('boot --since: omitted → since=null and full payload', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(root, ['fast-track', '--from', 'alice', '--action', 'a', '--reason', 'r']);
    const { stdout, status } = runGate(root, ['boot'], { GUILD_ACTOR: 'alice' });
    assert.equal(status, 0);
    const payload = JSON.parse(stdout);
    assert.equal(payload.since, null);
    assert.ok(Array.isArray(payload.tail));
    assert.ok(payload.tail.length >= 1, 'fast-track utterance should appear in tail');
  } finally {
    cleanup();
  }
});

test('boot --since: malformed ISO is rejected with "next: " hint', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stderr, status } = runGate(root, ['boot', '--since', 'yesterday'], { GUILD_ACTOR: 'alice' });
    assert.notEqual(status, 0);
    assert.match(stderr, /--since/);
    assert.match(stderr, /ISO-8601/);
    assert.match(stderr, /next:/);
  } finally {
    cleanup();
  }
});

test('boot --since: future ISO filters out all tail entries', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(root, ['fast-track', '--from', 'alice', '--action', 'a', '--reason', 'r']);
    const future = '2099-01-01T00:00:00.000Z';
    const { stdout, status } = runGate(root, ['boot', '--since', future], { GUILD_ACTOR: 'alice' });
    assert.equal(status, 0);
    const payload = JSON.parse(stdout);
    assert.equal(payload.since, future);
    assert.deepEqual(payload.tail, []);
    assert.deepEqual(payload.your_recent, []);
  } finally {
    cleanup();
  }
});

test('boot --since: past ISO keeps tail intact', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(root, ['fast-track', '--from', 'alice', '--action', 'a', '--reason', 'r']);
    const past = '1970-01-01T00:00:00.000Z';
    const { stdout, status } = runGate(root, ['boot', '--since', past], { GUILD_ACTOR: 'alice' });
    assert.equal(status, 0);
    const payload = JSON.parse(stdout);
    assert.equal(payload.since, past);
    assert.ok(payload.tail.length >= 1, 'past --since must not filter out historical entries');
  } finally {
    cleanup();
  }
});

test('boot --since: last_activity is NOT filtered (chain semantic)', () => {
  const { root, cleanup } = bootstrap();
  try {
    runGate(root, ['fast-track', '--from', 'alice', '--action', 'a', '--reason', 'r']);
    const future = '2099-01-01T00:00:00.000Z';
    const { stdout } = runGate(root, ['boot', '--since', future], { GUILD_ACTOR: 'alice' });
    const payload = JSON.parse(stdout);
    assert.notEqual(payload.last_activity, null,
      'last_activity must survive --since so the next boot can chain --since=last_activity');
  } finally {
    cleanup();
  }
});

test('boot --since: status.inbox_unread scalar stays truthful when entries filter out', () => {
  const { root, cleanup } = bootstrap();
  try {
    // bob sends alice a message — gives alice an unread entry to filter against.
    runGate(root, ['message', '--from', 'bob', '--to', 'alice', '--text', 'hi']);
    const future = '2099-01-01T00:00:00.000Z';
    const { stdout, status } = runGate(root, ['boot', '--since', future], { GUILD_ACTOR: 'alice' });
    assert.equal(status, 0);
    const payload = JSON.parse(stdout);
    // Scalar reflects truth (1 unread); surfaced entries filtered to none.
    assert.equal(payload.status.inbox_unread, 1, 'scalar must NOT undercount due to --since');
    assert.deepEqual(payload.inbox_unread, [], 'surfaced entries respect --since');
  } finally {
    cleanup();
  }
});
