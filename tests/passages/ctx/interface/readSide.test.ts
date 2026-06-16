// ctx read-side (list / show) — end-to-end through the real binary.
//
// Closes the phase-1 read-side gap surfaced by dogfooding: before this,
// reading facts back meant grep over <content_root>/ctx/. Covers:
//   - list newest-first
//   - list --tag (exact) and --by filters
//   - list empty (no records) vs empty (filter matched nothing)
//   - show by id (full fact)
//   - show absent id -> not-found with structured recovery
//   - show malformed id -> domain validation error

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CTX = resolve(here, '../../../../../bin/ctx.mjs');

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'ctx-read-'));
  writeFileSync(join(root, 'guild.config.yaml'), 'content_root: .\nhost_names: [human]\n');
  return root;
}

function runCtx(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [CTX, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? -1 };
}

function seed(root: string): void {
  runCtx(root, ['record', '--fact', 'first okf fact', '--tag', 'topic:okf'], { GUILD_ACTOR: 'claude' });
  runCtx(root, ['record', '--fact', 'a dogfood note', '--tag', 'topic:dogfood'], { GUILD_ACTOR: 'eris' });
  runCtx(root, ['record', '--fact', 'second okf fact', '--tag', 'topic:okf'], { GUILD_ACTOR: 'claude' });
}

test('ctx list returns facts newest-first', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  seed(root);

  const env = JSON.parse(runCtx(root, ['list', '--format', 'json']).stdout);
  assert.equal(env.count, 3);
  // newest first: -003, -002, -001 (same day, NNN order).
  const ids = env.facts.map((f: { id: string }) => f.id);
  assert.deepEqual(ids, [...ids].sort().reverse());
});

test('ctx list --tag filters by exact tag; --by filters by author', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  seed(root);

  const byTag = JSON.parse(runCtx(root, ['list', '--tag', 'topic:okf', '--format', 'json']).stdout);
  assert.equal(byTag.count, 2);
  assert.ok(byTag.facts.every((f: { tags: string[] }) => f.tags.includes('topic:okf')));

  const byAuthor = JSON.parse(runCtx(root, ['list', '--by', 'eris', '--format', 'json']).stdout);
  assert.equal(byAuthor.count, 1);
  assert.equal(byAuthor.facts[0].created_by, 'eris');
});

test('ctx list distinguishes empty store from empty filter (text)', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const empty = runCtx(root, ['list']);
  assert.match(empty.stdout, /no ctx facts recorded yet/);
  assert.match(empty.stdout, /ctx record --fact/);

  seed(root);
  const noMatch = runCtx(root, ['list', '--tag', 'topic:absent']);
  assert.match(noMatch.stdout, /no ctx facts match the filter/);
});

test('ctx list rejects a malformed --tag at the boundary', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  seed(root);
  const r = runCtx(root, ['list', '--tag', 'nocolon']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ctx tag must match/);
});

test('ctx show <id> prints the full fact', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  seed(root);
  const today = new Date().toISOString().slice(0, 10);
  const r = runCtx(root, ['show', `ctx-${today}-002`]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /a dogfood note/);
  assert.match(r.stdout, /by eris/);
});

test('ctx show <absent> raises not-found with structured recovery', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  seed(root);
  const r = runCtx(root, ['show', 'ctx-2020-01-01-001', '--format', 'json']);
  assert.equal(r.status, 1);
  const env = JSON.parse(r.stderr.split('\n')[0]!);
  assert.equal(env.ok, false);
  assert.equal(env.error.code, 'not_found');
  assert.equal(env.error.recovery.verb, 'list');
});

test('ctx show <malformed id> is a domain validation error', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  seed(root);
  const r = runCtx(root, ['show', 'not-an-id']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ctx id must match/);
});
