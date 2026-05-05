// Touch-feel cleanups from P3 dogfood C/A:
//
// 1. `gate list --state all` is sugar for "every state, no filter" —
//    parity with `gate issues list --state all`. Pre-fix this errored
//    `Invalid state: all`, breaking muscle memory between the two
//    sibling list verbs.
//
// 2. The trailing `(field)` tag on DomainError messages
//    (`error: Invalid lense: "bogus" ... (lense)`) is dropped from the
//    human-readable output. For domain-internal fields it read as
//    debug noise; for user-typed fields the message already names the
//    flag in prose. JSON envelope retains `error.field` so
//    programmatic consumers don't lose the structured info.
//
// 3. The `DomainError:` class-name prefix is removed from agora /
//    devil / ctx / guild dispatchers (gate had already dropped it);
//    it leaked an internal class name into user-facing output.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');
const AGORA = resolve(here, '../../../bin/agora.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-touchfeel-cleanup-'));
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

function setupActorAndRequests(root: string): void {
  run(GATE, root, ['register', '--name', 'alice']);
  run(GATE, root, ['register', '--name', 'bob']);
  // One pending, one approved, one denied — three states for --state all.
  run(GATE, root, ['request', '--action', 'a1', '--reason', 'r1'], { GUILD_ACTOR: 'alice' });
  run(GATE, root, ['request', '--action', 'a2', '--reason', 'r2'], { GUILD_ACTOR: 'alice' });
  run(GATE, root, ['request', '--action', 'a3', '--reason', 'r3'], { GUILD_ACTOR: 'alice' });
  // Approve the second, deny the third — leaves a mix.
  run(GATE, root, ['approve', '2026-05-05-0002'], { GUILD_ACTOR: 'alice' });
  run(GATE, root, ['deny', '2026-05-05-0003', '--reason', 'no'], { GUILD_ACTOR: 'alice' });
}

// --- (1) `gate list --state all` sugar ---

test('gate list --state all: returns requests across every state (text)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  setupActorAndRequests(root);

  const r = run(GATE, root, ['list', '--state', 'all'], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}; stderr=${r.stderr}`);
  // All three requests should appear, regardless of state.
  assert.match(r.stdout, /2026-05-05-0001/);
  assert.match(r.stdout, /2026-05-05-0002/);
  assert.match(r.stdout, /2026-05-05-0003/);
});

test('gate list --state all: works in --format json (sugar handled at interface)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  setupActorAndRequests(root);

  const r = run(GATE, root, ['list', '--state', 'all', '--format', 'json'], {
    GUILD_ACTOR: 'alice',
  });
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout) as {
    requests: Array<{ id: string; state: string }>;
    _meta: { state: string; verb: string };
  };
  assert.equal(payload.requests.length, 3);
  assert.equal(payload._meta.state, 'all');
  // The set of states should include at least two distinct values
  // (we created one of each: pending, approved, denied — but the
  // deny may move 0003 to denied; just check we got mixed states).
  const states = new Set(payload.requests.map((r) => r.state));
  assert.ok(states.size >= 2, `expected mixed states, got: ${[...states].join(',')}`);
});

test('gate list (no --state): hint mentions --state all as an option', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice']);

  const r = run(GATE, root, ['list'], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\| all\)/);
  assert.match(r.stderr, /gate list --state all/);
});

// --- (2) Trailing (field) tag dropped from human-readable errors ---

test('error message: trailing (field) tag is dropped (gate)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  setupActorAndRequests(root);

  const r = run(
    GATE,
    root,
    ['review', '2026-05-05-0001', '--lense', 'bogus', '--verdict', 'ok', '--comment', 'x'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Invalid lense: "bogus"/);
  // Pre-fix the error ended `... (lense)\n`. The cleanup drops it.
  assert.equal(
    / \(lense\)\n/.test(r.stderr),
    false,
    `expected no '(lense)' debug tag, got stderr:\n${r.stderr}`,
  );
});

test('error message: trailing (field) tag is dropped (agora)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice']);

  // Bad `--kind` triggers a DomainError with field set internally.
  const r = run(
    AGORA,
    root,
    ['new', '--slug', 't', '--kind', 'invalid', '--title', 'x'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  // No DomainError prefix anymore.
  assert.equal(/^error: DomainError:/m.test(r.stderr), false);
  // No trailing `(<field>)` debug tag.
  assert.equal(/ \([a-z_]+\)\n/.test(r.stderr), false);
});

// --- (3) JSON envelope still carries error.field ---

test('error JSON envelope: error.field preserved when dropped from text', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  setupActorAndRequests(root);

  const r = run(
    GATE,
    root,
    [
      'review', '2026-05-05-0001',
      '--lense', 'bogus',
      '--verdict', 'ok',
      '--comment', 'x',
      '--format', 'json',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  // Stderr has TWO lines: a JSON envelope first, then `error: ...` prose.
  // Parse only the first line as JSON.
  const firstLine = r.stderr.split('\n').find((l) => l.startsWith('{'));
  assert.ok(firstLine, 'expected a JSON envelope on stderr');
  const payload = JSON.parse(firstLine!) as {
    ok: boolean;
    error: { message: string; field?: string };
  };
  assert.equal(payload.ok, false);
  assert.equal(payload.error.field, 'lense');
  assert.match(payload.error.message, /Invalid lense/);
});
