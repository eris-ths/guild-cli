// scripts/lore-scope.sh smoke test (#326).
//
// What this pins:
//   * `solo` filter → 14 principles (the unannotated set), and the
//     one annotated 'swarm' principle (14) is NOT in the result.
//   * `swarm` filter → all 15 (the 14 default-'all' + principle 14
//     which explicitly carries applies_to: swarm).
//   * `all` filter → all 15.
//   * Invalid audience exits non-zero (POSIX usage convention).
//
// Why a subprocess test (and not unit-testing a parser): the script is
// the contract. Reading frontmatter via shell is the deliverable, and
// the test enforces "script invocation produces this audience set" —
// not "this TypeScript helper does." If the script breaks, the test
// catches it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
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

test('lore-scope.sh solo includes 14 unannotated principles and excludes 14-', () => {
  const out = run('solo');
  assert.equal(out.status, 0, `solo should exit 0; stderr=${out.stderr}`);
  const files = lines(out.stdout).map((p) => basename(p));
  assert.equal(
    files.length,
    14,
    `expected 14 solo principles, got ${files.length}: ${files.join(', ')}`,
  );
  const annotated = files.filter((f) => f.startsWith('14-'));
  assert.equal(
    annotated.length,
    0,
    `principle 14 (applies_to: swarm) must not appear in solo set, got: ${annotated.join(', ')}`,
  );
});

test('lore-scope.sh swarm includes principle 14 plus all 14 unannotated', () => {
  const out = run('swarm');
  assert.equal(out.status, 0, `swarm should exit 0; stderr=${out.stderr}`);
  const files = lines(out.stdout).map((p) => basename(p));
  assert.equal(
    files.length,
    15,
    `expected 15 swarm principles, got ${files.length}: ${files.join(', ')}`,
  );
  const annotated = files.filter((f) => f.startsWith('14-'));
  assert.equal(
    annotated.length,
    1,
    `principle 14 must appear in swarm set exactly once, got ${annotated.length}`,
  );
});

test('lore-scope.sh all returns every principle', () => {
  const out = run('all');
  assert.equal(out.status, 0, `all should exit 0; stderr=${out.stderr}`);
  const files = lines(out.stdout);
  assert.equal(files.length, 15, `expected 15 'all' principles, got ${files.length}`);
});

test('lore-scope.sh passage:devil includes universal principles (applies_to: all is the floor)', () => {
  const out = run('passage:devil');
  assert.equal(out.status, 0, `passage:devil should exit 0; stderr=${out.stderr}`);
  const files = lines(out.stdout).map((p) => basename(p));
  // All 14 universal (no frontmatter = 'all') principles match.
  // Principle 14 (swarm-only) does not.
  assert.equal(
    files.length,
    14,
    `expected 14 universal principles for passage:devil, got ${files.length}: ${files.join(', ')}`,
  );
  assert.equal(
    files.filter((f) => f.startsWith('14-')).length,
    0,
    'swarm-only principle 14 must not appear under passage:devil',
  );
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
