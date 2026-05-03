// devil-review — `devil conclude` verb tests.

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
  const root = mkdtempSync(join(tmpdir(), 'devil-conclude-'));
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

/**
 * Add a `kind: skip` entry per default lense so the lense-coverage
 * gate (issue #126, e-006 fix) is satisfied. Returns the next
 * available entry-id sequence so callers that add their own entries
 * after this know what number to expect (1-based, from 1 + N skips).
 *
 * Tests that genuinely care about a specific lense being touched in
 * a non-skip way should call this then add their domain-specific
 * entries on top — the skip baseline is the substrate-honest "we
 * looked at this lense and it doesn't apply" gesture.
 */
const ALL_LENSES = [
  'injection',
  'injection-parser',
  'path-network',
  'auth-access',
  'memory-safety',
  'crypto',
  'deserialization',
  'protocol-encoding',
  'supply-chain',
  'composition',
  'temporal',
  'coherence',
];

function fillAllLensesWithSkips(root: string, reviewId: string): void {
  for (const lense of ALL_LENSES) {
    const r = runDevil(
      root,
      [
        'entry', reviewId,
        '--persona', 'red-team',
        '--lense', lense,
        '--kind', 'skip',
        '--text', `test bootstrap: ${lense} not exercised in this fixture`,
      ],
      { GUILD_ACTOR: 'alice' },
    );
    if (r.status !== 0) throw new Error(`fillAllLenses(${lense}) failed: ${r.stderr}`);
  }
}

test('conclude: synthesis flips state and returns null suggested_next', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = openReview(root);
  fillAllLensesWithSkips(root, id);
  const r = runDevil(
    root,
    [
      'conclude', id,
      '--synthesis', 'all 11 lenses touched, no actionable findings beyond accepted-risk on supply-chain',
      '--format', 'json',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.review_id, id);
  assert.equal(payload.state, 'concluded');
  assert.equal(payload.from_state, 'open');
  assert.match(payload.conclusion.synthesis, /all 11 lenses touched/);
  assert.equal(payload.suggested_next, null);
});

test('conclude: missing --synthesis fails', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = openReview(root);
  const r = runDevil(root, ['conclude', id], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--synthesis required/);
});

test('conclude: --unresolved with valid entry ids succeeds', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = openReview(root);
  fillAllLensesWithSkips(root, id); // e-001..e-011 are skips
  // Add 2 resistance entries on top so we have e-012, e-013 to
  // mark unresolved. The skips already cover lense gate; these
  // are the substantive threads being deliberately left open.
  for (const text of ['first', 'second']) {
    runDevil(
      root,
      [
        'entry', id,
        '--persona', 'red-team',
        '--lense', 'composition',
        '--kind', 'resistance',
        '--text', text,
      ],
      { GUILD_ACTOR: 'alice' },
    );
  }
  const r = runDevil(
    root,
    [
      'conclude', id,
      '--synthesis', 'two threads stay open, deliberately',
      '--unresolved', 'e-012,e-013',
      '--format', 'json',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.deepEqual(payload.conclusion.unresolved, ['e-012', 'e-013']);
});

test('conclude: --unresolved referencing missing entry fails', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = openReview(root);
  const r = runDevil(
    root,
    [
      'conclude', id,
      '--synthesis', 'x',
      '--unresolved', 'e-099',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unresolved entry id "e-099" not found in this review/);
});

test('conclude: review-not-found surfaces DevilReviewNotFound', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runDevil(
    root,
    ['conclude', 'rev-2099-12-31-001', '--synthesis', 'x'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /DevilReview "rev-2099-12-31-001" not found/);
});

test('conclude: second call surfaces DevilReviewAlreadyConcluded', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = openReview(root);
  fillAllLensesWithSkips(root, id);
  const first = runDevil(
    root,
    ['conclude', id, '--synthesis', 'first'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(first.status, 0, `first stderr: ${first.stderr}`);
  const second = runDevil(
    root,
    ['conclude', id, '--synthesis', 'second'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(second.status, 1);
  assert.match(
    second.stderr,
    /DevilReview .* is already concluded — terminal state/,
  );
});

test('concluded review refuses subsequent entries', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = openReview(root);
  fillAllLensesWithSkips(root, id);
  runDevil(
    root,
    ['conclude', id, '--synthesis', 'done'],
    { GUILD_ACTOR: 'alice' },
  );
  const r = runDevil(
    root,
    [
      'entry', id,
      '--persona', 'red-team',
      '--lense', 'injection',
      '--kind', 'resistance',
      '--text', 'too late',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already concluded/);
});

test('conclude: text-mode reports terminal status', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = openReview(root);
  fillAllLensesWithSkips(root, id);
  const r = runDevil(
    root,
    ['conclude', id, '--synthesis', 'done'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  assert.match(r.stdout, /✓ devil-review concluded:/);
  assert.match(r.stdout, /\[open → concluded\] by alice/);
  assert.match(r.stdout, /this review is now terminal/);
});

test('conclude: persists across processes (round-trip via show)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = openReview(root);
  fillAllLensesWithSkips(root, id);
  runDevil(
    root,
    ['conclude', id, '--synthesis', 'persisted'],
    { GUILD_ACTOR: 'alice' },
  );
  // Re-open via show in a separate process.
  const r = runDevil(root, ['show', id, '--format', 'json']);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.review.state, 'concluded');
  assert.equal(payload.review.conclusion.synthesis, 'persisted');
});

// ---- e-006 fix: lense-coverage gate ----

test('conclude: refuses when no lenses are touched (lense-coverage gate)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = openReview(root);
  // No fillAllLensesWithSkips call — every catalog lense is missing.
  const r = runDevil(
    root,
    ['conclude', id, '--synthesis', 'attempt without coverage'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cannot conclude — these lenses have no entries:/);
  // Names every missing lense — alphabetical or catalog order, but
  // every default lense should be in the message.
  for (const lense of ALL_LENSES) {
    assert.match(r.stderr, new RegExp(lense));
  }
  // Hint at the fix path
  assert.match(r.stderr, /devil entry .* --kind skip --text/);
});

test('conclude: refuses when a single lense is missing (names only that one)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = openReview(root);
  // Cover all but one lense.
  for (const lense of ALL_LENSES) {
    if (lense === 'crypto') continue;
    runDevil(
      root,
      [
        'entry', id,
        '--persona', 'red-team',
        '--lense', lense,
        '--kind', 'skip',
        '--text', 'irrelevant for this fixture',
      ],
      { GUILD_ACTOR: 'alice' },
    );
  }
  const r = runDevil(
    root,
    ['conclude', id, '--synthesis', 'almost there'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /these lenses have no entries: crypto\b/);
});

test('conclude: skip entries satisfy lense coverage', (t) => {
  // The whole point of the substrate-as-floor design — `kind: skip`
  // counts toward coverage as long as it explicitly declares why.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = openReview(root);
  fillAllLensesWithSkips(root, id);
  const r = runDevil(
    root,
    ['conclude', id, '--synthesis', 'all skipped, all explicit'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
});

test('conclude: lense gate fires AFTER unresolved validation (typo path)', (t) => {
  // unresolved validation comes first so a typo'd id surfaces
  // immediately, regardless of catalog coverage state. Pin this so
  // a future refactor doesn't accidentally hide the typo behind the
  // (more intimidating) lense-coverage error.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = openReview(root);
  // No lense fill — both gates would refuse, but unresolved fires first.
  const r = runDevil(
    root,
    ['conclude', id, '--synthesis', 'x', '--unresolved', 'e-099'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unresolved entry id "e-099" not found/);
  assert.doesNotMatch(r.stderr, /these lenses have no entries/);
});
