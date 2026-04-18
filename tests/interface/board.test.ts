// gate board — "what's in flight" view.
//
// Verbs around state already exist in two shapes: `gate status` gives
// counts, `gate list --state <s>` gives contents of one state. What
// was missing is "show me the board" — pending + approved + executing
// in one view, grouped.
//
// Tests pin:
//   1. All three sections render with headers + counts, even empty.
//   2. Terminal states (completed/failed/denied) are OUT of scope.
//   3. `--for <m>` filters each section to rows naming that actor.
//   4. `--format json` emits all three keys unconditionally.

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
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-board-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  for (const dir of ['members', 'requests', 'issues', 'inbox']) {
    mkdirSync(join(root, dir));
  }
  for (const name of ['eris', 'claude', 'sentinel']) {
    writeFileSync(
      join(root, 'members', `${name}.yaml`),
      `name: ${name}\ncategory: professional\nactive: true\n`,
    );
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runGate(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status ?? -1,
  };
}

function seedBoard(root: string): void {
  // 2 pending, 1 approved, 1 executing, 1 completed.
  // The completed one must NOT appear on the board.
  runGate(
    root,
    ['request', '--action', 'pending-A', '--reason', 'r'],
    { GUILD_ACTOR: 'eris' },
  );
  runGate(
    root,
    [
      'request',
      '--executor',
      'claude',
      '--action',
      'pending-B',
      '--reason',
      'r',
    ],
    { GUILD_ACTOR: 'eris' },
  );
  runGate(
    root,
    [
      'request',
      '--executor',
      'sentinel',
      '--action',
      'approved-C',
      '--reason',
      'r',
    ],
    { GUILD_ACTOR: 'eris' },
  );
  runGate(root, ['approve', '2026-04-18-0003', '--by', 'eris'], {
    GUILD_ACTOR: 'eris',
  });
  runGate(
    root,
    [
      'request',
      '--executor',
      'claude',
      '--action',
      'executing-D',
      '--reason',
      'r',
    ],
    { GUILD_ACTOR: 'eris' },
  );
  runGate(root, ['approve', '2026-04-18-0004', '--by', 'eris'], {
    GUILD_ACTOR: 'eris',
  });
  runGate(root, ['execute', '2026-04-18-0004', '--by', 'claude'], {
    GUILD_ACTOR: 'claude',
  });
  runGate(
    root,
    ['fast-track', '--action', 'completed-E', '--reason', 'r'],
    { GUILD_ACTOR: 'eris' },
  );
}

test('gate board: text output groups rows under pending/approved/executing headers', () => {
  const { root, cleanup } = bootstrap();
  try {
    seedBoard(root);
    const { stdout, status } = runGate(root, ['board']);
    assert.equal(status, 0);
    assert.match(stdout, /^pending \(2\):/m);
    assert.match(stdout, /^approved \(1\):/m);
    assert.match(stdout, /^executing \(1\):/m);
    // Content rows appear under their headers.
    assert.match(stdout, /pending-A/);
    assert.match(stdout, /approved-C/);
    assert.match(stdout, /executing-D/);
  } finally {
    cleanup();
  }
});

test('gate board: completed/failed/denied requests do NOT appear on the board', () => {
  // The fast-tracked completed-E must not leak in. "In flight"
  // means "someone could still act on this"; closed records belong
  // to gate tail / gate show / gate voices.
  const { root, cleanup } = bootstrap();
  try {
    seedBoard(root);
    const { stdout } = runGate(root, ['board']);
    assert.equal(/completed-E/.test(stdout), false);
    assert.equal(/completed \(/.test(stdout), false);
  } finally {
    cleanup();
  }
});

test('gate board: empty sections still render their header (board shape is stable)', () => {
  const { root, cleanup } = bootstrap();
  try {
    // Nothing on the board at all.
    const { stdout } = runGate(root, ['board']);
    assert.match(stdout, /pending \(0\):/);
    assert.match(stdout, /approved \(0\):/);
    assert.match(stdout, /executing \(0\):/);
    // Each empty section shows "(none)" so the reader knows there
    // are no rows (not that rendering is broken).
    const noneCount = (stdout.match(/\(none\)/g) ?? []).length;
    assert.equal(noneCount, 3);
  } finally {
    cleanup();
  }
});

test('gate board --for <m>: narrows each section to rows naming that actor', () => {
  const { root, cleanup } = bootstrap();
  try {
    seedBoard(root);
    const { stdout } = runGate(root, ['board', '--for', 'claude']);
    // claude appears as executor on pending-B and executing-D; not
    // on pending-A (no executor) nor approved-C (exec=sentinel).
    assert.match(stdout, /pending-B/);
    assert.match(stdout, /executing-D/);
    assert.equal(/pending-A/.test(stdout), false);
    assert.equal(/approved-C/.test(stdout), false);
    // Counts reflect the filtered rows.
    assert.match(stdout, /pending \(1\):/);
    assert.match(stdout, /approved \(0\):/);
    assert.match(stdout, /executing \(1\):/);
  } finally {
    cleanup();
  }
});

test('gate board --format json: always emits all three keys, even when empty', () => {
  // Stable key set lets consumers rely on `payload.executing`
  // existing as an array without guarding for undefined.
  const { root, cleanup } = bootstrap();
  try {
    const { stdout, status } = runGate(root, ['board', '--format', 'json']);
    assert.equal(status, 0);
    const payload = JSON.parse(stdout);
    assert.ok(Array.isArray(payload.pending));
    assert.ok(Array.isArray(payload.approved));
    assert.ok(Array.isArray(payload.executing));
    assert.equal(payload.pending.length, 0);
    assert.equal(payload.approved.length, 0);
    assert.equal(payload.executing.length, 0);
    // Terminal-state keys MUST NOT appear.
    assert.equal('completed' in payload, false);
    assert.equal('failed' in payload, false);
    assert.equal('denied' in payload, false);
  } finally {
    cleanup();
  }
});
