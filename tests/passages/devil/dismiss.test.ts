// devil-review — `devil dismiss` verb tests.

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
  const root = mkdtempSync(join(tmpdir(), 'devil-dismiss-'));
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

function addFinding(root: string, reviewId: string, lense = 'injection'): string {
  const r = runDevil(
    root,
    [
      'entry', reviewId,
      '--persona', 'red-team',
      '--lense', lense,
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

test('dismiss: status flips to dismissed with reason captured', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const entryId = addFinding(root, reviewId);
  const r = runDevil(
    root,
    [
      'dismiss', reviewId, entryId,
      '--reason', 'false-positive',
      '--note', 'sink was a stub used in the test harness',
      '--format', 'json',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.review_id, reviewId);
  assert.equal(payload.entry_id, entryId);
  assert.equal(payload.status, 'dismissed');
  assert.equal(payload.dismissal_reason, 'false-positive');
  assert.equal(payload.dismissal_note, 'sink was a stub used in the test harness');
  assert.equal(payload.dismissed_by, 'alice');
  // alternation-neutral per #122
  assert.equal(payload.suggested_next.args.by, undefined);
});

test('dismiss: persists across processes (round-trip via show)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const entryId = addFinding(root, reviewId);
  runDevil(
    root,
    ['dismiss', reviewId, entryId, '--reason', 'accepted-risk', '--note', 'risk owner: alice'],
    { GUILD_ACTOR: 'alice' },
  );
  const r = runDevil(root, ['show', reviewId, '--format', 'json']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  const e = payload.review.entries.find((x: { id: string }) => x.id === entryId);
  assert.equal(e.status, 'dismissed');
  assert.equal(e.dismissal_reason, 'accepted-risk');
  assert.equal(e.dismissal_note, 'risk owner: alice');
});

test('dismiss without --reason fails', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const entryId = addFinding(root, reviewId);
  const r = runDevil(
    root,
    ['dismiss', reviewId, entryId],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--reason required/);
});

test('dismiss with invalid --reason fails with enum list', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const entryId = addFinding(root, reviewId);
  const r = runDevil(
    root,
    ['dismiss', reviewId, entryId, '--reason', 'made-up-reason'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /dismissal_reason must be one of/);
});

test('dismiss without --note (optional) succeeds and omits dismissal_note from json', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const entryId = addFinding(root, reviewId);
  const r = runDevil(
    root,
    [
      'dismiss', reviewId, entryId,
      '--reason', 'not-applicable',
      '--format', 'json',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.dismissal_reason, 'not-applicable');
  assert.equal(payload.dismissal_note, undefined);
});

test('dismiss refuses non-finding kinds', (t) => {
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
    ['dismiss', reviewId, entryId, '--reason', 'false-positive'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /only kind='finding' entries can be dismissed/);
  assert.match(r2.stderr, /got kind='resistance'/);
});

test('dismiss refuses re-dismiss (status already dismissed)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const entryId = addFinding(root, reviewId);
  const first = runDevil(
    root,
    ['dismiss', reviewId, entryId, '--reason', 'false-positive'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(first.status, 0, `first stderr: ${first.stderr}`);
  const second = runDevil(
    root,
    ['dismiss', reviewId, entryId, '--reason', 'accepted-risk'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(second.status, 1);
  assert.match(second.stderr, /status is 'dismissed', not 'open'/);
  assert.match(second.stderr, /file a new entry that --addresses/);
});

test('dismiss refuses missing review (DevilReviewNotFound)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runDevil(
    root,
    ['dismiss', 'rev-2099-12-31-001', 'e-001', '--reason', 'false-positive'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /DevilReview "rev-2099-12-31-001" not found/);
});

test('dismiss refuses missing entry within an existing review', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const r = runDevil(
    root,
    ['dismiss', reviewId, 'e-099', '--reason', 'false-positive'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /entry "e-099" not found in/);
});

test('dismiss missing positionals fails with usage hint', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runDevil(root, ['dismiss', '--reason', 'false-positive'], {
    GUILD_ACTOR: 'alice',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /<rev-id> AND <entry-id> required/);
});

test('dismiss text-mode prints dismissal trail and next: hint', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const entryId = addFinding(root, reviewId);
  const r = runDevil(
    root,
    ['dismiss', reviewId, entryId, '--reason', 'false-positive', '--note', 'mock sink'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  assert.match(r.stdout, new RegExp(`✓ entry ${entryId} dismissed in`));
  assert.match(r.stdout, /reason=false-positive/);
  assert.match(r.stdout, /note: mock sink/);
  assert.match(r.stdout, /next: devil show/);
});

test('dismiss refuses after conclude (terminal-state refusal)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const entryId = addFinding(root, reviewId);
  // Fill remaining lenses so conclude can fire.
  const ALL_LENSES = [
    'injection', 'injection-parser', 'path-network', 'auth-access',
    'memory-safety', 'crypto', 'deserialization', 'protocol-encoding',
    'supply-chain', 'composition', 'temporal', 'coherence',
  ];
  for (const lense of ALL_LENSES) {
    if (lense === 'injection') continue; // already covered by addFinding
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
  runDevil(
    root,
    ['conclude', reviewId, '--synthesis', 'closed with finding open'],
    { GUILD_ACTOR: 'alice' },
  );
  const r = runDevil(
    root,
    ['dismiss', reviewId, entryId, '--reason', 'false-positive'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already concluded — terminal state/);
});
