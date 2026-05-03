// devil-review — `devil suspend` + `devil resume` verb tests.
//
// Pin the cliff/invitation cycle and the softer-than-agora semantics:
// suspend appends history but does NOT block other entries; resume
// surfaces the closing cliff/invitation in the response so the
// resuming actor doesn't need a separate show.

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
  const root = mkdtempSync(join(tmpdir(), 'devil-suspres-'));
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

// ---- suspend ----

test('suspend: appends a SuspensionEntry with cliff/invitation', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const r = runDevil(
    root,
    [
      'suspend', reviewId,
      '--cliff', 'noticed something about auth before lunch',
      '--invitation', 'check whether session middleware actually validates the JWT signature',
      '--format', 'json',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.review_id, reviewId);
  // No state flip — devil-review doesn't have a 'suspended' state.
  assert.equal(payload.state, 'open');
  assert.equal(payload.suspension_index, 0);
  // alternation-neutral
  assert.equal(payload.suggested_next.args.by, undefined);
});

test('suspend: text-mode reports softer-semantics note', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const r = runDevil(
    root,
    [
      'suspend', reviewId,
      '--cliff', 'c1',
      '--invitation', 'i1',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  assert.match(r.stdout, /✓ thread suspended on/);
  assert.match(r.stdout, /cliff:      c1/);
  assert.match(r.stdout, /invitation: i1/);
  assert.match(r.stdout, /not blocked/);
});

test('suspend: missing --cliff fails', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const r = runDevil(
    root,
    ['suspend', reviewId, '--invitation', 'i'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--cliff required/);
});

test('suspend: missing --invitation fails', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const r = runDevil(
    root,
    ['suspend', reviewId, '--cliff', 'c'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--invitation required/);
});

test('suspend: refuses missing review (DevilReviewNotFound)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runDevil(
    root,
    ['suspend', 'rev-2099-12-31-001', '--cliff', 'c', '--invitation', 'i'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /DevilReview "rev-2099-12-31-001" not found/);
});

test('softer semantics: suspend does NOT block subsequent entries', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  // Suspend a thread.
  runDevil(
    root,
    ['suspend', reviewId, '--cliff', 'c', '--invitation', 'i'],
    { GUILD_ACTOR: 'alice' },
  );
  // Add an entry on a different lense — should succeed despite the
  // outstanding suspension. This is the design pivot from agora's
  // suspend (which blocks moves).
  const r = runDevil(
    root,
    [
      'entry', reviewId,
      '--persona', 'mirror',
      '--lense', 'composition',
      '--kind', 'resistance',
      '--text', 'unrelated thread',
      '--format', 'json',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
});

// ---- resume ----

test('resume: closes most recent suspension and surfaces cliff/invitation', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  runDevil(
    root,
    [
      'suspend', reviewId,
      '--cliff', 'paused on the auth thread',
      '--invitation', 'check JWT validation',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  const r = runDevil(
    root,
    ['resume', reviewId, '--note', 're-entered after lunch', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.review_id, reviewId);
  assert.equal(payload.state, 'open');
  assert.equal(payload.resumed_suspension.cliff, 'paused on the auth thread');
  assert.equal(payload.resumed_suspension.invitation, 'check JWT validation');
});

test('resume: text-mode shows closing cliff/invitation', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  runDevil(
    root,
    ['suspend', reviewId, '--cliff', 'cliff-text', '--invitation', 'invitation-text'],
    { GUILD_ACTOR: 'alice' },
  );
  const r = runDevil(
    root,
    ['resume', reviewId],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  assert.match(r.stdout, /✓ thread resumed on/);
  assert.match(r.stdout, /closing cliff:      cliff-text/);
  assert.match(r.stdout, /closing invitation: invitation-text/);
});

test('resume: refuses when no thread is paused', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const r = runDevil(
    root,
    ['resume', reviewId],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no thread is currently paused on/);
});

test('resume: after suspend+resume, second resume refuses', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  runDevil(
    root,
    ['suspend', reviewId, '--cliff', 'c', '--invitation', 'i'],
    { GUILD_ACTOR: 'alice' },
  );
  runDevil(root, ['resume', reviewId], { GUILD_ACTOR: 'alice' });
  const r = runDevil(root, ['resume', reviewId], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no thread is currently paused/);
});

// ---- multi-cycle ----

test('multi-cycle: suspend → resume → suspend → resume preserves history', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  // Cycle 1
  runDevil(root, ['suspend', reviewId, '--cliff', 'c1', '--invitation', 'i1'], { GUILD_ACTOR: 'alice' });
  runDevil(root, ['resume', reviewId, '--note', 'r1'], { GUILD_ACTOR: 'alice' });
  // Cycle 2
  runDevil(root, ['suspend', reviewId, '--cliff', 'c2', '--invitation', 'i2'], { GUILD_ACTOR: 'alice' });
  runDevil(root, ['resume', reviewId, '--note', 'r2'], { GUILD_ACTOR: 'alice' });
  const r = runDevil(root, ['show', reviewId, '--format', 'json']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.review.suspensions.length, 2);
  assert.equal(payload.review.resumes.length, 2);
  assert.equal(payload.review.suspensions[0].cliff, 'c1');
  assert.equal(payload.review.suspensions[1].cliff, 'c2');
  assert.equal(payload.review.resumes[0].note, 'r1');
  assert.equal(payload.review.resumes[1].note, 'r2');
});

// ---- terminal-state refusal ----

test('suspend refuses after conclude', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  // Fill all 11 lenses so conclude can fire.
  const ALL_LENSES = [
    'injection', 'injection-parser', 'path-network', 'auth-access',
    'memory-safety', 'crypto', 'deserialization', 'protocol-encoding',
    'supply-chain', 'composition', 'temporal',
  ];
  for (const lense of ALL_LENSES) {
    runDevil(
      root,
      [
        'entry', reviewId,
        '--persona', 'red-team',
        '--lense', lense,
        '--kind', 'skip',
        '--text', 'irrelevant for fixture',
      ],
      { GUILD_ACTOR: 'alice' },
    );
  }
  runDevil(root, ['conclude', reviewId, '--synthesis', 'closed'], { GUILD_ACTOR: 'alice' });
  const r = runDevil(
    root,
    ['suspend', reviewId, '--cliff', 'c', '--invitation', 'i'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already concluded — terminal state/);
});

test('resume refuses after conclude', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  runDevil(
    root,
    ['suspend', reviewId, '--cliff', 'c', '--invitation', 'i'],
    { GUILD_ACTOR: 'alice' },
  );
  // Fill remaining lenses so conclude can fire.
  const REMAINING_LENSES = [
    'injection', 'injection-parser', 'path-network', 'auth-access',
    'memory-safety', 'crypto', 'deserialization', 'protocol-encoding',
    'supply-chain', 'composition', 'temporal',
  ];
  for (const lense of REMAINING_LENSES) {
    runDevil(
      root,
      [
        'entry', reviewId,
        '--persona', 'red-team',
        '--lense', lense,
        '--kind', 'skip',
        '--text', 'irrelevant',
      ],
      { GUILD_ACTOR: 'alice' },
    );
  }
  // Resume the suspension first (so concluded review has paired
  // suspension/resume — clean state).
  runDevil(root, ['resume', reviewId], { GUILD_ACTOR: 'alice' });
  runDevil(root, ['conclude', reviewId, '--synthesis', 'closed'], { GUILD_ACTOR: 'alice' });
  // Now try to resume a non-existent paused thread on a concluded
  // review. Conclude refusal fires first.
  const r = runDevil(root, ['resume', reviewId], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already concluded — terminal state/);
});
