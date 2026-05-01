// gate unresponded — read verb wrapping UnrespondedConcernsQuery.
//
// The detector is deliberately coarse (existence-only follow-up
// detection; does not infer whether a follow-up actually addresses
// a concern). These tests pin the verb's contract rather than the
// underlying detector logic — that's covered by
// tests/application/UnrespondedConcernsQuery.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-unresponded-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  for (const d of ['members', 'requests', 'issues', 'inbox']) {
    mkdirSync(join(root, d));
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

function extractId(stdout: string): string | null {
  const m = stdout.match(/\b(\d{4}-\d{2}-\d{2}-\d+)\b/);
  return m ? m[1]! : null;
}

test('unresponded: empty content_root returns count=0', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(root, ['register', '--name', 'alice', '--category', 'professional']);
  const out = runGate(
    root,
    ['unresponded', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(out.status, 0);
  const p = JSON.parse(out.stdout);
  assert.equal(p.actor, 'alice');
  assert.equal(p.count, 0);
  assert.deepEqual(p.entries, []);
});

test('unresponded: surfaces concern with no follow-up', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(root, ['register', '--name', 'alice', '--category', 'professional']);
  runGate(root, ['register', '--name', 'bob', '--category', 'professional']);
  const created = runGate(root, [
    'fast-track',
    '--from', 'alice',
    '--action', 'has a concern',
    '--reason', 'r',
    '--executor', 'alice',
  ]);
  const id = extractId(created.stdout)!;
  runGate(root, [
    'review', id,
    '--by', 'bob',
    '--lense', 'devil',
    '--verdict', 'concern',
    '--comment', 'something to think about',
  ]);
  const out = runGate(
    root,
    ['unresponded', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  const p = JSON.parse(out.stdout);
  assert.equal(p.count, 1);
  assert.equal(p.entries[0].request_id, id);
  assert.equal(p.entries[0].concerns[0].by, 'bob');
  assert.equal(p.entries[0].concerns[0].verdict, 'concern');
});

test('unresponded: filters out concerns that have a follow-up referencing them', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(root, ['register', '--name', 'alice', '--category', 'professional']);
  runGate(root, ['register', '--name', 'bob', '--category', 'professional']);
  const created = runGate(root, [
    'fast-track',
    '--from', 'alice',
    '--action', 'first',
    '--reason', 'r',
    '--executor', 'alice',
  ]);
  const id = extractId(created.stdout)!;
  runGate(root, [
    'review', id,
    '--by', 'bob',
    '--lense', 'devil',
    '--verdict', 'concern',
    '--comment', 'concern raised',
  ]);
  // file a follow-up authored by alice that mentions the id
  runGate(root, [
    'fast-track',
    '--from', 'alice',
    '--action', `addresses ${id}`,
    '--reason', `responding to ${id}'s concern`,
    '--executor', 'alice',
  ]);
  const out = runGate(
    root,
    ['unresponded', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  const p = JSON.parse(out.stdout);
  assert.equal(
    p.count,
    0,
    'follow-up referencing the id removes the concern from the unresponded set',
  );
});

test('unresponded: --for overrides GUILD_ACTOR', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(root, ['register', '--name', 'alice', '--category', 'professional']);
  runGate(root, ['register', '--name', 'bob', '--category', 'professional']);
  const created = runGate(root, [
    'fast-track',
    '--from', 'alice',
    '--action', 'a',
    '--reason', 'r',
    '--executor', 'alice',
  ]);
  const id = extractId(created.stdout)!;
  runGate(root, [
    'review', id,
    '--by', 'bob',
    '--lense', 'devil',
    '--verdict', 'concern',
    '--comment', 'c',
  ]);
  // bob asks for alice's unresponded set explicitly
  const out = runGate(
    root,
    ['unresponded', '--for', 'alice', '--format', 'json'],
    { GUILD_ACTOR: 'bob' },
  );
  const p = JSON.parse(out.stdout);
  assert.equal(p.actor, 'alice');
  assert.equal(p.count, 1);
});

test('unresponded: missing actor (no GUILD_ACTOR, no --for) is an error', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const out = runGate(root, ['unresponded', '--format', 'json']);
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /actor/i);
});

test('unresponded: rejects unknown flags', (t) => {
  // Read-verb strict-flag discipline: a typo like `--max-age-day 7`
  // (singular) silently falling back to the 30-day default would be
  // the exact fail-open shape rejectUnknownFlags exists to prevent.
  // Mirrors the behavior of gate tail / doctor / repair.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(root, ['register', '--name', 'alice', '--category', 'professional']);
  const out = runGate(
    root,
    ['unresponded', '--max-age-day', '7'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /unknown flag/i);
  assert.match(out.stderr, /--max-age-days/);
});
