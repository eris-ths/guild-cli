// gate boot — JSON shape stability snapshot.
//
// The boot payload is the contract agents depend on for orientation.
// This test pins the top-level keys; field additions are allowed
// (they're forward-compatible), but renames/removals must bump the
// version per POLICY.md's strict 0.x.

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

// At runtime this file lives under dist/tests/interface/, so we walk
// three levels up (interface → tests → dist → repo root) to reach bin/.
const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-boot-'));
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

function runGate(cwd: string, args: string[], env: Record<string, string> = {}): { stdout: string; status: number } {
  const result = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { stdout: result.stdout, status: result.status ?? -1 };
}

test('gate boot: JSON top-level keys are stable', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout, status } = runGate(root, ['boot']);
    assert.equal(status, 0);
    const payload = JSON.parse(stdout);
    // Sorted so the failure diff is stable when a key is added/removed.
    const keys = Object.keys(payload).sort();
    assert.deepEqual(
      keys,
      [
        'actor',
        'inbox_unread',
        'last_activity',
        'role',
        'status',
        'tail',
        'your_recent',
      ],
      'boot payload top-level keys changed — agents depend on this contract',
    );
  } finally {
    cleanup();
  }
});

test('gate boot: actor=null when GUILD_ACTOR is not set', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: '' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.actor, null);
    assert.equal(payload.role, null);
    assert.equal(payload.your_recent, null);
  } finally {
    cleanup();
  }
});

test('gate boot: actor identity resolved when GUILD_ACTOR is a member', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'alice' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.actor, 'alice');
    assert.equal(payload.role, 'member');
    assert.ok(Array.isArray(payload.your_recent));
  } finally {
    cleanup();
  }
});

test('gate boot: role=host when GUILD_ACTOR is in host_names', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout } = runGate(root, ['boot'], { GUILD_ACTOR: 'human' });
    const payload = JSON.parse(stdout);
    assert.equal(payload.actor, 'human');
    assert.equal(payload.role, 'host');
  } finally {
    cleanup();
  }
});

test('gate boot: --format text renders a human-readable summary', () => {
  const { root, cleanup } = bootstrap();
  try {
    const { stdout, status } = runGate(root, ['boot', '--format', 'text']);
    assert.equal(status, 0);
    assert.match(stdout, /boot|queues:/);
  } finally {
    cleanup();
  }
});
