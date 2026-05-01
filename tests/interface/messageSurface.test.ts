// gate message + gate inbox surface fixes.
//
// Pins three behaviours surfaced by fresh-agent dogfood:
//   - self-message emits a stderr notice (mirrors self-approve)
//   - message to inactive recipient emits a stderr notice
//     (broadcast already filters them; DM was silent — asymmetric)
//   - gate inbox --format json emits an array of snake_case entries
//     with optional fields omitted when undefined
//
// Pre-fix: all three were silent / missing. Each is fail-open by
// design — the act is allowed, the writer is told what edge they
// crossed. Mirrors the pattern lore/principles/02 names: weak
// signals at principle-edges, not policy enforcement.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-msg-surface-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  for (const d of ['members', 'requests', 'issues', 'inbox']) {
    mkdirSync(join(root, d));
  }
  for (const name of ['alice', 'bob', 'carol']) {
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
  const r = spawnSync(process.execPath, [GATE, ...args], {
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

function deactivate(root: string, name: string): void {
  const p = join(root, 'members', `${name}.yaml`);
  writeFileSync(
    p,
    readFileSync(p, 'utf8').replace('active: true', 'active: false'),
  );
}

// ── self-message notice ──────────────────────────────────────────

test('gate message --from X --to X emits a self-message notice on stderr', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(
    root,
    ['message', '--from', 'alice', '--to', 'alice', '--text', 'self note'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, 'self-message is allowed (fail-open)');
  assert.match(r.stderr, /notice: alice messaged themselves/);
  assert.match(r.stderr, /self-message recorded/);
  // The success line still goes to stdout — pipelines stay clean.
  assert.match(r.stdout, /✓ message sent: alice → alice/);
});

test('gate message --from X --to Y (different actors) emits no self-message notice', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(
    root,
    ['message', '--from', 'alice', '--to', 'bob', '--text', 'hi'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stderr, /messaged themselves/);
});

// ── inactive-recipient notice ────────────────────────────────────

test('gate message --to <inactive> emits an inactive notice', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  deactivate(root, 'carol');
  const r = runGate(
    root,
    ['message', '--from', 'alice', '--to', 'carol', '--text', 'hi'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, 'delivery still succeeds (fail-open)');
  assert.match(r.stderr, /notice: carol is inactive/);
  // The phrasing names the consequence the reader cares about, not
  // a policy choice (deliver-or-block) we are not making here.
  assert.match(r.stderr, /landed in their inbox/);
  assert.match(r.stderr, /may not be reading it/);
});

test('gate message --to <active> emits no inactive notice', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(
    root,
    ['message', '--from', 'alice', '--to', 'bob', '--text', 'hi'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stderr, /is inactive/);
});

test('gate message --from X --to X (self-message) skips the inactive check', (t) => {
  // The writer just messaged themselves; pestering them about their
  // own active flag is noise. The self-message notice carries the
  // "edge crossed" signal already.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  deactivate(root, 'alice');
  const r = runGate(
    root,
    ['message', '--from', 'alice', '--to', 'alice', '--text', 'self'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  assert.match(r.stderr, /messaged themselves/);
  assert.doesNotMatch(r.stderr, /alice is inactive/);
});

// ── inbox --format json ──────────────────────────────────────────

test('gate inbox --format json emits array of snake_case entries', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(
    root,
    ['message', '--from', 'alice', '--to', 'bob', '--text', 'hello'],
    { GUILD_ACTOR: 'alice' },
  );
  const r = runGate(
    root,
    ['inbox', '--for', 'bob', '--format', 'json'],
    { GUILD_ACTOR: 'bob' },
  );
  assert.equal(r.status, 0);
  const items = JSON.parse(r.stdout);
  assert.ok(Array.isArray(items));
  assert.equal(items.length, 1);
  const m = items[0];
  // Required fields all present, snake_case.
  assert.equal(m.from, 'alice');
  assert.equal(m.to, 'bob');
  assert.equal(m.type, 'message');
  assert.equal(m.text, 'hello');
  assert.equal(typeof m.at, 'string');
  assert.equal(m.read, false);
  // Optional fields OMITTED (not null) when undefined. Pinned in
  // 2026-05-01-0001/0002 design review (devil B1).
  assert.equal('read_at' in m, false);
  assert.equal('read_by' in m, false);
  assert.equal('invoked_by' in m, false);
  assert.equal('related' in m, false);
});

test('gate inbox --format json includes optional fields when present', (t) => {
  // After mark-read, read_at + read_by populate. Verifies the
  // omit-when-undefined rule cleanly inverts: present-when-defined.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(
    root,
    ['message', '--from', 'alice', '--to', 'bob', '--text', 'hello'],
    { GUILD_ACTOR: 'alice' },
  );
  runGate(root, ['inbox', 'mark-read', '1', '--for', 'bob'], {
    GUILD_ACTOR: 'bob',
  });
  const r = runGate(
    root,
    ['inbox', '--for', 'bob', '--format', 'json'],
    { GUILD_ACTOR: 'bob' },
  );
  assert.equal(r.status, 0);
  const items = JSON.parse(r.stdout);
  const m = items[0];
  assert.equal(m.read, true);
  assert.equal(typeof m.read_at, 'string');
  assert.equal(m.read_by, 'bob');
});

test('gate inbox --format json --unread filters and still emits json', (t) => {
  // The --unread filter applies before serialisation; json shape
  // stays an array regardless.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(
    root,
    ['message', '--from', 'alice', '--to', 'bob', '--text', 'one'],
    { GUILD_ACTOR: 'alice' },
  );
  runGate(
    root,
    ['message', '--from', 'alice', '--to', 'bob', '--text', 'two'],
    { GUILD_ACTOR: 'alice' },
  );
  runGate(root, ['inbox', 'mark-read', '1', '--for', 'bob'], {
    GUILD_ACTOR: 'bob',
  });
  const r = runGate(
    root,
    ['inbox', '--for', 'bob', '--unread', '--format', 'json'],
    { GUILD_ACTOR: 'bob' },
  );
  assert.equal(r.status, 0);
  const items = JSON.parse(r.stdout);
  assert.equal(items.length, 1);
  assert.equal(items[0].text, 'two');
  assert.equal(items[0].read, false);
});

test('gate inbox --format json on an empty inbox emits []', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(
    root,
    ['inbox', '--for', 'alice', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), []);
});

test('gate inbox --format bogus errors with format validation', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(
    root,
    ['inbox', '--for', 'alice', '--format', 'yaml'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--format must be 'text' or 'json'/);
});
