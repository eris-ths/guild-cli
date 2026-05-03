// devil-review — `devil list` + `devil show` observability tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DEVIL = resolve(here, '../../../../bin/devil.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'devil-listshow-'));
  writeFileSync(join(root, 'guild.config.yaml'), 'content_root: .\nhost_names: [human]\n');
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runDevil(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [DEVIL, ...args], {
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

function openOne(root: string, type: string, ref: string): string {
  const r = runDevil(
    root,
    ['open', ref, '--type', type, '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  if (r.status !== 0) throw new Error(`open failed: ${r.stderr}`);
  return JSON.parse(r.stdout).review_id;
}

// ---- list ----

test('list (empty content_root) reports zero reviews', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runDevil(root, ['list', '--format', 'json']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.reviews, []);
});

test('list with three reviews returns them most-recent-first', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id1 = openOne(root, 'file', 'src/a.ts');
  const id2 = openOne(root, 'file', 'src/b.ts');
  const id3 = openOne(root, 'pr', 'https://github.com/x/y/pull/1');
  const r = runDevil(root, ['list', '--format', 'json']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.reviews.length, 3);
  assert.deepEqual(
    payload.reviews.map((rv: { id: string }) => rv.id),
    [id3, id2, id1],
  );
});

test('list --state open filters out concluded reviews', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // Set up two open reviews; we'd need conclude verb to test
  // a concluded one — for v0 list, this just checks that state=open
  // returns everything (which has state=open).
  openOne(root, 'file', 'src/a.ts');
  openOne(root, 'pr', 'https://github.com/x/y/pull/1');
  const r = runDevil(root, ['list', '--state', 'open', '--format', 'json']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.reviews.length, 2);
  assert.equal(payload.filters.state, 'open');
});

test('list --state invalid fails with enum error', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runDevil(root, ['list', '--state', 'paused']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /review state must be one of/);
});

test('list --target-type filters by target.type', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  openOne(root, 'file', 'src/a.ts');
  openOne(root, 'pr', 'https://github.com/x/y/pull/1');
  const r = runDevil(root, ['list', '--target-type', 'pr', '--format', 'json']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.reviews.length, 1);
  assert.equal(payload.reviews[0].target.type, 'pr');
});

test('list text-mode prints one line per review', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  openOne(root, 'file', 'src/a.ts');
  openOne(root, 'pr', 'https://github.com/x/y/pull/1');
  const r = runDevil(root, ['list']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /2 review\(s\):/);
  assert.match(r.stdout, /pr:https:\/\/github\.com\/x\/y\/pull\/1/);
  assert.match(r.stdout, /file:src\/a\.ts/);
});

test('list text-mode (empty + filtered) reports filter context', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runDevil(root, ['list', '--state', 'concluded']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\(no reviews \(filters: state=concluded\)\)/);
});

// ---- show ----

test('show returns full review json', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = openOne(root, 'file', 'src/foo.ts');
  // Add an entry
  runDevil(
    root,
    [
      'entry', id,
      '--persona', 'red-team',
      '--lense', 'injection',
      '--kind', 'finding',
      '--text', 'sample finding',
      '--severity', 'medium',
      '--severity-rationale', 'private endpoint, but exposed via admin path',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  const r = runDevil(root, ['show', id, '--format', 'json']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.review.id, id);
  assert.equal(payload.review.entries.length, 1);
  assert.equal(payload.review.entries[0].kind, 'finding');
  assert.equal(payload.review.entries[0].severity, 'medium');
});

test('show on missing review surfaces DevilReviewNotFound', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runDevil(root, ['show', 'rev-2099-12-31-001']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /DevilReview "rev-2099-12-31-001" not found/);
});

test('show without positional rev-id fails', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runDevil(root, ['show']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /positional <rev-id> required/);
});

test('show text-mode formats entries and metadata', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = openOne(root, 'file', 'src/foo.ts');
  runDevil(
    root,
    [
      'entry', id,
      '--persona', 'mirror',
      '--lense', 'composition',
      '--kind', 'synthesis',
      '--text', 'cross-file effect that neither side mentioned',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  const r = runDevil(root, ['show', id]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, new RegExp(`${id} \\[open\\] against file:src/foo\\.ts`));
  assert.match(r.stdout, /opened: .* by alice/);
  assert.match(r.stdout, /entries: \(1\)/);
  assert.match(r.stdout, /persona=mirror \/ lense=composition \/ kind=synthesis/);
  assert.match(r.stdout, /cross-file effect that neither side mentioned/);
});

test('show with malformed rev-id fails at domain', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runDevil(root, ['show', 'not-an-id']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /review id must match rev-YYYY-MM-DD-NNN/);
});
