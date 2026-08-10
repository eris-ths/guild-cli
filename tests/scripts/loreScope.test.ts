// scripts/lore-scope.sh smoke test (#326).
//
// What this pins: for each audience, the **exact set of files** the
// script emits — compared against an independent reading of the same
// frontmatter, not against a hardcoded count.
//
// ## Why it no longer counts (2026-08-10)
//
// This file used to assert `files.length === 14` / `=== 16`, and its
// header said: "Counts shift when a new principle lands. If you add
// principle 17, bump the swarm/all asserts here."
//
// Principle 17 landed. Bumping is exactly what principle 17 forbids —
// it is a restatement of the directory, maintained by hand, checked
// against nothing. The numbers went stale the moment the principle
// that says so was written, which is as clean a demonstration as this
// repo is likely to get.
//
// The expectation now derives from `lore/principles/*.md`: read each
// file's `applies_to:` frontmatter (absent = 'all') and compute
// membership. That is a *second, independent* implementation of the
// same rule — the script parses with sh + sed, this parses with a
// regex — so agreement is a differential check rather than a copy
// agreeing with itself. Set equality also catches what counting
// cannot: the right number of the wrong files.
//
// Floors are pinned before use (`reachability-audit`'s empty green): a
// derivation that silently returns nothing would make every assertion
// vacuous.
//
// Why a subprocess test (and not unit-testing a parser): the script is
// the contract. Reading frontmatter via shell is the deliverable, and
// the test enforces "script invocation produces this audience set" —
// not "this TypeScript helper does." If the script breaks, the test
// catches it.
//
// See lore/principles/17-restatement-binds-to-structure.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Compiled location is `<repo>/dist/tests/scripts/loreScope.test.js`, so
// the repo root is three directory levels up from `here`.
const REPO_ROOT = resolve(here, '..', '..', '..');
const SCRIPT = resolve(REPO_ROOT, 'scripts', 'lore-scope.sh');

// On Windows, .sh files can't be executed directly — the OS doesn't
// read shebangs. GitHub Actions windows-latest runners ship Git Bash on
// PATH, so we invoke the script via `bash` there. POSIX hosts use the
// shebang directly.
function spawn(args: readonly string[]): SpawnSyncReturns<string> {
  if (process.platform === 'win32') {
    return spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8' });
  }
  return spawnSync(SCRIPT, [...args], { encoding: 'utf8' });
}

function run(audience: string): { status: number; stdout: string; stderr: string } {
  const result = spawn([audience]);
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function lines(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const PRINCIPLES_DIR = resolve(REPO_ROOT, 'lore', 'principles');

/**
 * Independent reading of a principle's `applies_to:` frontmatter.
 * Deliberately not sharing code with `lore-scope.sh` — the value of
 * this test is that two implementations of the same rule agree.
 * Absent frontmatter means `all` (lore/README.md § convention).
 */
function appliesTo(file: string): string[] {
  const text = readFileSync(resolve(PRINCIPLES_DIR, file), 'utf8');
  if (!text.startsWith('---')) return ['all'];
  const close = text.indexOf('\n---', 3);
  if (close === -1) return ['all'];
  const block = text.slice(3, close);
  const m = block.match(/^[ \t]*applies_to:[ \t]*(.+)$/m);
  if (!m) return ['all'];
  const raw = (m[1] as string).trim().replace(/^\[|\]$/g, '').replace(/["']/g, '');
  const tokens = raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return tokens.length > 0 ? tokens : ['all'];
}

function principleFiles(): string[] {
  return readdirSync(PRINCIPLES_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();
}

/** The set `lore-scope.sh <audience>` should emit, per the documented semantics. */
function expectedFor(audience: string): string[] {
  return principleFiles().filter((f) => {
    if (audience === 'all') return true;
    const tokens = appliesTo(f);
    if (tokens.includes('all')) return true;   // universal is the floor
    if (audience === 'solo') return false;     // solo = exactly {all}
    return tokens.includes(audience);
  });
}

/**
 * A derived expectation that comes back empty makes every set
 * comparison below trivially satisfiable by an equally-empty script
 * output — two silences agreeing. Pin the floor first.
 */
function assertDerivable(): void {
  const all = principleFiles();
  assert.ok(
    all.length > 5,
    `derived only ${all.length} principle files from ${PRINCIPLES_DIR} — ` +
      `the read is broken and every check below would pass vacuously`,
  );
  const annotated = all.filter((f) => !appliesTo(f).includes('all'));
  assert.ok(
    annotated.length > 0,
    'no principle carries a non-"all" applies_to — the audience filter ' +
      'would be an identity function and the solo/swarm split untested',
  );
}

for (const audience of ['solo', 'swarm', 'all', 'passage:devil']) {
  test(`lore-scope.sh ${audience} emits exactly the set the frontmatter implies`, () => {
    assertDerivable();
    const out = run(audience);
    assert.equal(out.status, 0, `${audience} should exit 0; stderr=${out.stderr}`);
    const got = lines(out.stdout).map((p) => basename(p)).sort();
    const want = expectedFor(audience);
    assert.deepEqual(
      got,
      want,
      `${audience}: script output disagrees with the frontmatter.\n` +
        `  only in script:     ${got.filter((f) => !want.includes(f)).join(', ') || '(none)'}\n` +
        `  only in expectation: ${want.filter((f) => !got.includes(f)).join(', ') || '(none)'}`,
    );
  });
}

test('the audience filter actually discriminates (solo ⊊ swarm ⊆ all)', () => {
  // Without this, all four checks above would still pass if the script
  // ignored its argument and printed everything — the expectation
  // would be wrong in the same direction.
  assertDerivable();
  const solo = lines(run('solo').stdout).map((p) => basename(p));
  const swarm = lines(run('swarm').stdout).map((p) => basename(p));
  const all = lines(run('all').stdout).map((p) => basename(p));
  assert.ok(
    solo.length < swarm.length,
    `solo (${solo.length}) must be a strict subset of swarm (${swarm.length}) — ` +
      'otherwise the annotation is doing nothing',
  );
  assert.ok(swarm.length <= all.length, 'swarm must not exceed all');
  for (const f of solo) {
    assert.ok(swarm.includes(f), `${f} is in solo but not swarm — 'all' is the floor`);
  }
});

test('lore-scope.sh exits non-zero on invalid audience', () => {
  const out = run('nonsense-audience');
  assert.notEqual(out.status, 0, 'invalid audience must exit non-zero');
  assert.ok(
    out.stderr.length > 0,
    'invalid audience should emit usage text on stderr',
  );
});

test('lore-scope.sh exits non-zero on missing argument', () => {
  const result = spawn([]);
  assert.notEqual(result.status ?? 0, 0, 'no-arg invocation must exit non-zero');
});
