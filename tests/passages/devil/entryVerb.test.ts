// devil-review — `devil entry` verb tests.
//
// Pin per-kind validation, persona/lense catalog lookup,
// state-machine refusals, sequence allocation, and the json/text
// output shape. Real CLI via spawn (same shape as open.test).

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
  const root = mkdtempSync(join(tmpdir(), 'devil-entry-'));
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

test('entry: finding (with severity + rationale) succeeds', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const r = runDevil(
    root,
    [
      'entry', reviewId,
      '--persona', 'red-team',
      '--lense', 'injection',
      '--kind', 'finding',
      '--text', 'concatenated user input in raw SQL',
      '--severity', 'high',
      '--severity-rationale', 'public endpoint, no preceding sanitization',
      '--format', 'json',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.review_id, reviewId);
  assert.equal(payload.entry_id, 'e-001');
  assert.equal(payload.persona, 'red-team');
  assert.equal(payload.lense, 'injection');
  assert.equal(payload.kind, 'finding');
  // alternation-neutral per #122
  assert.equal(payload.suggested_next.args.by, undefined);
});

test('entry: finding without --severity fails', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const r = runDevil(
    root,
    [
      'entry', reviewId,
      '--persona', 'red-team',
      '--lense', 'injection',
      '--kind', 'finding',
      '--text', 'x',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--severity required when --kind=finding/);
});

test('entry: finding without --severity-rationale fails', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const r = runDevil(
    root,
    [
      'entry', reviewId,
      '--persona', 'red-team',
      '--lense', 'injection',
      '--kind', 'finding',
      '--text', 'x',
      '--severity', 'high',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--severity-rationale required when --kind=finding/);
});

test('entry: assumption with --severity fails (finding-only flag)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const r = runDevil(
    root,
    [
      'entry', reviewId,
      '--persona', 'author-defender',
      '--lense', 'auth-access',
      '--kind', 'assumption',
      '--text', 'auth() is correct',
      '--severity', 'high',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--severity only valid when --kind=finding/);
});

test('entry: skip (declared irrelevance) succeeds', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const r = runDevil(
    root,
    [
      'entry', reviewId,
      '--persona', 'mirror',
      '--lense', 'memory-safety',
      '--kind', 'skip',
      '--text', 'irrelevant: pure TypeScript, no native or unsafe code',
      '--format', 'json',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.kind, 'skip');
});

test('entry: kind=gate is rejected (use ingest)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const r = runDevil(
    root,
    [
      'entry', reviewId,
      '--persona', 'red-team',
      '--lense', 'supply-chain',
      '--kind', 'gate',
      '--text', 'manual gate',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /kind='gate' is rejected by `devil entry`/);
  assert.match(r.stderr, /devil ingest/);
});

test('entry: unknown persona surfaces PersonaNotFound', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const r = runDevil(
    root,
    [
      'entry', reviewId,
      '--persona', 'ghost',
      '--lense', 'injection',
      '--kind', 'resistance',
      '--text', 'x',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Persona not found in catalog: ghost/);
});

test('entry: unknown lense surfaces LenseNotFound', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const r = runDevil(
    root,
    [
      'entry', reviewId,
      '--persona', 'red-team',
      '--lense', 'made-up',
      '--kind', 'resistance',
      '--text', 'x',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Lense not found in catalog: made-up/);
});

test('entry: review not found returns DevilReviewNotFound', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runDevil(
    root,
    [
      'entry', 'rev-2099-12-31-001',
      '--persona', 'red-team',
      '--lense', 'injection',
      '--kind', 'resistance',
      '--text', 'x',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /DevilReview "rev-2099-12-31-001" not found/);
});

test('entry: sequential entry ids increment (e-001, e-002, e-003)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const r = runDevil(
      root,
      [
        'entry', reviewId,
        '--persona', 'red-team',
        '--lense', 'composition',
        '--kind', 'resistance',
        '--text', `entry ${i}`,
        '--format', 'json',
      ],
      { GUILD_ACTOR: 'alice' },
    );
    assert.equal(r.status, 0, `iteration ${i} stderr: ${r.stderr}`);
    ids.push(JSON.parse(r.stdout).entry_id);
  }
  assert.deepEqual(ids, ['e-001', 'e-002', 'e-003']);
});

test('entry: text-mode output includes next: hint', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const r = runDevil(
    root,
    [
      'entry', reviewId,
      '--persona', 'mirror',
      '--lense', 'composition',
      '--kind', 'synthesis',
      '--text', 'red-team and author-defender both ignored the cache layer',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(r.stdout, /✓ entry e-001 appended to/);
  assert.match(r.stdout, /next: devil entry/);
  assert.match(r.stdout, /devil conclude .* --synthesis/);
});

test('entry: --addresses validates as entry id format', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  // first entry e-001
  runDevil(
    root,
    [
      'entry', reviewId,
      '--persona', 'red-team',
      '--lense', 'injection',
      '--kind', 'resistance',
      '--text', 'first',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  // second entry e-002 addressing e-001 — succeeds
  const ok = runDevil(
    root,
    [
      'entry', reviewId,
      '--persona', 'mirror',
      '--lense', 'injection',
      '--kind', 'synthesis',
      '--text', 'closing the thread',
      '--addresses', 'e-001',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(ok.status, 0, `stderr: ${ok.stderr}`);
  // malformed addresses — fails at domain
  const bad = runDevil(
    root,
    [
      'entry', reviewId,
      '--persona', 'mirror',
      '--lense', 'injection',
      '--kind', 'synthesis',
      '--text', 'addressing nothing valid',
      '--addresses', 'not-an-id',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /entry id must match e-NNN/);
});
