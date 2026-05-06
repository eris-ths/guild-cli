// Partial-dist-staleness detector tests.
//
// Pins the contract for `bin/_lib/checkDistFreshness.mjs`:
//   - silent when src and dist are in sync (within grace)
//   - silent when either dir is missing (installed-via-npm or
//     pre-build state — the existing dist-missing guard handles
//     the latter; this helper stays out of its way)
//   - emits a stderr notice when src has a .ts file newer than
//     the newest .js under dist by more than the 2s grace
//   - never blocks execution (notice only, not exit-1)
//
// The helper is plain ESM .mjs so the test imports it directly
// rather than spawning a bin script. Spawning would fold the
// staleness signal into stderr beside other notices and require
// rebuilding dist between cases, which is slow and brittle.
//
// Why this matters: the dist-missing guard at #139/#140 catches
// "no dist at all" but not "dist exists but lags src". A May 2026
// dogfood pass hit the lag case — a `git pull` brought new src
// files (`agora last`, `agora cliff`) but dist still held the
// previous dispatcher, so the new verbs returned `unknown verb`
// without a clue about staleness. This helper closes that gap.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// dist/tests/interface/ → repo root is three levels up.
const HELPER = resolve(here, '../../../bin/_lib/checkDistFreshness.mjs');

interface Helper {
  checkDistFreshness: (srcDir: string, distDir: string) => void;
}

async function loadHelper(): Promise<Helper> {
  return (await import(HELPER)) as Helper;
}

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'dist-freshness-'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Capture stderr writes during a synchronous call. */
function captureStderr(fn: () => void): string {
  const orig = process.stderr.write.bind(process.stderr);
  let captured = '';
  // Override only for the duration of the call. Node's typing for
  // process.stderr.write is overloaded; cast through unknown to
  // satisfy the assignment without disturbing the production type.
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    captured += chunk.toString();
    return true;
  }) as unknown as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stderr.write = orig;
  }
  return captured;
}

function setMtime(path: string, secondsAgo: number): void {
  const t = (Date.now() - secondsAgo * 1000) / 1000;
  utimesSync(path, t, t);
}

test('checkDistFreshness: silent when src and dist mtimes match', async (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const { checkDistFreshness } = await loadHelper();
  const src = join(root, 'src');
  const dist = join(root, 'dist', 'src');
  mkdirSync(src, { recursive: true });
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(src, 'a.ts'), '// src');
  writeFileSync(join(dist, 'a.js'), '// dist');
  // Pin both files to the same mtime — within-grace, no signal.
  setMtime(join(src, 'a.ts'), 100);
  setMtime(join(dist, 'a.js'), 100);

  const stderr = captureStderr(() => checkDistFreshness(src, dist));
  assert.equal(stderr, '', `expected no notice; got: ${stderr}`);
});

test('checkDistFreshness: silent when src dir is missing (installed-via-npm)', async (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const { checkDistFreshness } = await loadHelper();
  const src = join(root, 'src'); // never created
  const dist = join(root, 'dist', 'src');
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'a.js'), '// dist');

  const stderr = captureStderr(() => checkDistFreshness(src, dist));
  assert.equal(stderr, '', 'no src/ → installed-via-npm shape; helper must stay silent');
});

test('checkDistFreshness: silent when dist dir is missing (existing guard handles it)', async (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const { checkDistFreshness } = await loadHelper();
  const src = join(root, 'src');
  const dist = join(root, 'dist', 'src'); // never created
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, 'a.ts'), '// src');

  const stderr = captureStderr(() => checkDistFreshness(src, dist));
  assert.equal(stderr, '', 'no dist/ → existing #139/#140 guard fires; this helper stays silent');
});

test('checkDistFreshness: emits notice when src is newer than dist beyond the grace', async (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const { checkDistFreshness } = await loadHelper();
  const src = join(root, 'src');
  const dist = join(root, 'dist', 'src');
  mkdirSync(src, { recursive: true });
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(src, 'a.ts'), '// src');
  writeFileSync(join(dist, 'a.js'), '// dist');
  // dist 60s old; src now → 60s gap, well past the 2s grace.
  setMtime(join(dist, 'a.js'), 60);
  setMtime(join(src, 'a.ts'), 0);

  const stderr = captureStderr(() => checkDistFreshness(src, dist));
  assert.match(stderr, /dist\/ is stale relative to src\//);
  assert.match(stderr, /npm run build/);
});

test('checkDistFreshness: silent when src is only marginally newer (within the 2s grace)', async (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const { checkDistFreshness } = await loadHelper();
  const src = join(root, 'src');
  const dist = join(root, 'dist', 'src');
  mkdirSync(src, { recursive: true });
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(src, 'a.ts'), '// src');
  writeFileSync(join(dist, 'a.js'), '// dist');
  // 1s gap — inside the 2s grace, treated as in-sync.
  setMtime(join(dist, 'a.js'), 2);
  setMtime(join(src, 'a.ts'), 1);

  const stderr = captureStderr(() => checkDistFreshness(src, dist));
  assert.equal(stderr, '', `expected no notice within grace; got: ${stderr}`);
});

test('checkDistFreshness: walks nested directories (newest mtime wins per tree)', async (t) => {
  // Pins the recursive walk: a deeply-nested .ts that's fresher
  // than every .js triggers the notice. Mirrors the real-world
  // case (a single `agora last.ts` newer than the dispatcher).
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const { checkDistFreshness } = await loadHelper();
  const src = join(root, 'src');
  const nestedSrc = join(src, 'passages', 'agora', 'interface', 'handlers');
  const dist = join(root, 'dist', 'src');
  mkdirSync(nestedSrc, { recursive: true });
  mkdirSync(dist, { recursive: true });
  // Most of dist + the top-level .ts are old; one nested .ts is new.
  writeFileSync(join(src, 'top.ts'), '// top');
  writeFileSync(join(nestedSrc, 'last.ts'), '// new');
  writeFileSync(join(dist, 'a.js'), '// dist');
  setMtime(join(src, 'top.ts'), 100);
  setMtime(join(dist, 'a.js'), 100);
  setMtime(join(nestedSrc, 'last.ts'), 0);

  const stderr = captureStderr(() => checkDistFreshness(src, dist));
  assert.match(stderr, /dist\/ is stale/);
});
