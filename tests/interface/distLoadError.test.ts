// Dist-load failure classifier tests.
//
// Pins the contract for `bin/_lib/handleDistLoadError.mjs`, the shared
// catch-path helper all 5 bin entries delegate to when
// `await import(ENTRY_URL)` throws.
//
// The bug this closes (May 2026 dogfood, Opus 4.8 feel-test): a fresh
// clone where `tsc` had run (dist/ exists) but `npm install` had not (no
// node_modules, so the bare `yaml` import fails) reported "dist/ not built
// (or out of date)" and pointed at `npm run build` — misdirecting the
// operator to rebuild when the real fix is installing deps. Node phrases
// the failure as `Cannot find package 'yaml' imported from <dist importer>`,
// so the old `/dist/` message scan misclassified it as a stale build.
//
// The helper is plain ESM .mjs (it must not live in dist/ — a load failure
// would take it down too), so the test imports it directly. classify* is
// pure; handle* takes injectable write/exit so we can assert without
// killing the runner via process.exit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// dist/tests/interface/ → repo root is three levels up. file:// URL for the
// dynamic import (same Windows-ESM trap distFreshness.test.ts documents).
const HELPER = pathToFileURL(
  resolve(here, '../../../bin/_lib/handleDistLoadError.mjs'),
).href;

interface DepResult {
  kind: 'dependency';
  pkg: string;
}
interface DistResult {
  kind: 'dist';
  transitiveUrl: string;
}
type ClassifyResult = DepResult | DistResult | null;

interface Helper {
  classifyDistLoadError: (err: unknown) => ClassifyResult;
  handleDistLoadError: (
    err: unknown,
    entryUrl: string,
    io?: { write?: (s: string) => void; exit?: (code: number) => void },
  ) => void;
}

async function loadHelper(): Promise<Helper> {
  return (await import(HELPER)) as Helper;
}

/** A synthetic ERR_MODULE_NOT_FOUND for a missing bare dependency. */
function depMiss(pkg: string, importer: string): Error & { code: string } {
  const err = new Error(
    `Cannot find package '${pkg}' imported from ${importer}`,
  ) as Error & { code: string };
  err.code = 'ERR_MODULE_NOT_FOUND';
  return err;
}

/** A synthetic ERR_MODULE_NOT_FOUND for a missing /dist/ module. */
function distMiss(url: string): Error & { code: string; url: string } {
  const err = new Error(
    `Cannot find module '${url}' imported from somewhere`,
  ) as Error & { code: string; url: string };
  err.code = 'ERR_MODULE_NOT_FOUND';
  err.url = url;
  return err;
}

const ENTRY = 'file:///repo/dist/src/interface/gate/index.js';

// -------------------- classify (pure) --------------------

test('classify: bare-dependency miss → kind=dependency (even when importer is in dist/)', async () => {
  const { classifyDistLoadError } = await loadHelper();
  // The "imported from" path sits under dist/ — the old scan would have
  // misread this as a build problem. The package miss must win.
  const r = classifyDistLoadError(
    depMiss('yaml', '/repo/dist/src/infrastructure/yamlStore.js'),
  );
  assert.deepEqual(r, { kind: 'dependency', pkg: 'yaml' });
});

test('classify: missing /dist/ module → kind=dist with transitiveUrl', async () => {
  const { classifyDistLoadError } = await loadHelper();
  const url = 'file:///repo/dist/src/interface/gate/handlers/boot.js';
  const r = classifyDistLoadError(distMiss(url));
  assert.deepEqual(r, { kind: 'dist', transitiveUrl: url });
});

test('classify: non-module-not-found error → null (not ours, caller re-throws)', async () => {
  const { classifyDistLoadError } = await loadHelper();
  const syntax = new Error('Unexpected token') as Error & { code: string };
  syntax.code = 'ERR_PARSE';
  assert.equal(classifyDistLoadError(syntax), null);
});

test('classify: module-not-found with no dist path and no package clue → null', async () => {
  const { classifyDistLoadError } = await loadHelper();
  const err = new Error('Cannot find module ./elsewhere') as Error & {
    code: string;
  };
  err.code = 'ERR_MODULE_NOT_FOUND';
  assert.equal(classifyDistLoadError(err), null);
});

// -------------------- handle (write + exit, injected) --------------------

interface Capture {
  out: string;
  codes: number[];
}
function run(
  helper: Helper,
  err: unknown,
  entryUrl = ENTRY,
): Capture {
  const cap: Capture = { out: '', codes: [] };
  helper.handleDistLoadError(err, entryUrl, {
    write: (s) => {
      cap.out += s;
    },
    exit: (code) => {
      cap.codes.push(code);
    },
  });
  return cap;
}

test('handle: dependency miss names the package, points at npm install, not rebuild', async () => {
  const helper = await loadHelper();
  const cap = run(helper, depMiss('yaml', '/repo/dist/src/infra/store.js'));
  assert.match(cap.out, /dependency 'yaml' is not installed/);
  assert.match(cap.out, /npm install/);
  // Must NOT misdirect to a rebuild — the build is fine, deps are not.
  assert.doesNotMatch(cap.out, /dist\/ not built/);
  assert.doesNotMatch(cap.out, /npm run build/);
  assert.deepEqual(cap.codes, [2]);
});

test('handle: dist miss keeps the build message + surfaces a transitive miss', async () => {
  const helper = await loadHelper();
  const url = 'file:///repo/dist/src/interface/gate/handlers/boot.js';
  const cap = run(helper, distMiss(url));
  assert.match(cap.out, /dist\/ not built \(or out of date\)/);
  assert.match(cap.out, /npm run build/);
  assert.match(cap.out, new RegExp(`transitive miss: ${url.replace(/[/.]/g, '\\$&')}`));
  assert.deepEqual(cap.codes, [2]);
});

test('handle: dist miss at the entry itself omits the transitive-miss line', async () => {
  const helper = await loadHelper();
  // failedUrl === entryUrl → never-built tree, not a transitive miss.
  const cap = run(helper, distMiss(ENTRY));
  assert.match(cap.out, /dist\/ not built/);
  assert.doesNotMatch(cap.out, /transitive miss/);
  assert.deepEqual(cap.codes, [2]);
});

test('handle: unrecognized error neither writes nor exits (caller re-throws)', async () => {
  const helper = await loadHelper();
  const other = new Error('boom') as Error & { code: string };
  other.code = 'ERR_OTHER';
  const cap = run(helper, other);
  assert.equal(cap.out, '');
  assert.deepEqual(cap.codes, []);
});
