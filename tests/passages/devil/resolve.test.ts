// devil-review — `devil resolve` verb tests.

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
  const root = mkdtempSync(join(tmpdir(), 'devil-resolve-'));
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

function openReview(root: string): string {
  const r = runDevil(
    root,
    ['open', 'src/foo.ts', '--type', 'file', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  if (r.status !== 0) throw new Error(`open failed: ${r.stderr}`);
  return JSON.parse(r.stdout).review_id;
}

function addFinding(root: string, reviewId: string): string {
  const r = runDevil(
    root,
    [
      'entry', reviewId,
      '--persona', 'red-team',
      '--lense', 'injection',
      '--kind', 'finding',
      '--text', 'sample finding',
      '--severity', 'high',
      '--severity-rationale', 'public endpoint, no preceding sanitization',
      '--format', 'json',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  if (r.status !== 0) throw new Error(`addFinding failed: ${r.stderr}`);
  return JSON.parse(r.stdout).entry_id;
}

test('resolve: status flips to resolved, with --commit captured', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const entryId = addFinding(root, reviewId);
  const r = runDevil(
    root,
    [
      'resolve', reviewId, entryId,
      '--commit', 'abc1234',
      '--format', 'json',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.review_id, reviewId);
  assert.equal(payload.entry_id, entryId);
  assert.equal(payload.status, 'resolved');
  assert.equal(payload.resolved_by_commit, 'abc1234');
  assert.equal(payload.resolved_by, 'alice');
  // alternation-neutral per #122
  assert.equal(payload.suggested_next.args.by, undefined);
});

test('resolve without --commit (optional) succeeds and omits resolved_by_commit', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const entryId = addFinding(root, reviewId);
  const r = runDevil(
    root,
    [
      'resolve', reviewId, entryId,
      '--format', 'json',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.status, 'resolved');
  assert.equal(payload.resolved_by_commit, undefined);
});

test('resolve: persists across processes (round-trip via show)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const entryId = addFinding(root, reviewId);
  runDevil(
    root,
    ['resolve', reviewId, entryId, '--commit', 'feed5af'],
    { GUILD_ACTOR: 'alice' },
  );
  const r = runDevil(root, ['show', reviewId, '--format', 'json']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  const e = payload.review.entries.find((x: { id: string }) => x.id === entryId);
  assert.equal(e.status, 'resolved');
  assert.equal(e.resolved_by_commit, 'feed5af');
});

test('resolve refuses non-finding kinds', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const r1 = runDevil(
    root,
    [
      'entry', reviewId,
      '--persona', 'mirror',
      '--lense', 'composition',
      '--kind', 'resistance',
      '--text', 'something feels off',
      '--format', 'json',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  const entryId = JSON.parse(r1.stdout).entry_id;
  const r2 = runDevil(
    root,
    ['resolve', reviewId, entryId],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /only kind='finding' entries can be resolved/);
});

test('resolve refuses re-resolve (status already resolved)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const entryId = addFinding(root, reviewId);
  const first = runDevil(
    root,
    ['resolve', reviewId, entryId],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(first.status, 0, `first stderr: ${first.stderr}`);
  const second = runDevil(
    root,
    ['resolve', reviewId, entryId, '--commit', 'def4567'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(second.status, 1);
  assert.match(second.stderr, /status is 'resolved', not 'open'/);
  assert.match(second.stderr, /file a new entry that --addresses/);
});

test('resolve refuses dismiss→resolve transition (substrate refuses status flip)', (t) => {
  // The substrate refuses to overwrite an existing transition. If a
  // dismiss was wrong, the path is to file a new entry that
  // --addresses the disputed one — not silently flip it to resolved.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const entryId = addFinding(root, reviewId);
  runDevil(
    root,
    ['dismiss', reviewId, entryId, '--reason', 'false-positive'],
    { GUILD_ACTOR: 'alice' },
  );
  const r = runDevil(
    root,
    ['resolve', reviewId, entryId, '--commit', 'abc'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /status is 'dismissed', not 'open'/);
});

test('resolve missing --commit empty string fails', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const entryId = addFinding(root, reviewId);
  const r = runDevil(
    root,
    ['resolve', reviewId, entryId, '--commit', ''],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--commit must be non-empty/);
});

test('resolve missing positionals fails', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runDevil(root, ['resolve'], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /<rev-id> AND <entry-id> required/);
});

test('resolve refuses missing review (DevilReviewNotFound)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runDevil(
    root,
    ['resolve', 'rev-2099-12-31-001', 'e-001'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /DevilReview "rev-2099-12-31-001" not found/);
});

test('resolve text-mode prints fix linkage and next: hint', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const entryId = addFinding(root, reviewId);
  const r = runDevil(
    root,
    ['resolve', reviewId, entryId, '--commit', 'abc1234'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  assert.match(r.stdout, new RegExp(`✓ entry ${entryId} resolved in`));
  assert.match(r.stdout, /commit: abc1234/);
  assert.match(r.stdout, /next: devil show/);
});
