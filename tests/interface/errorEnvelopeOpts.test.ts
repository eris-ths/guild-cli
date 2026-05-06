// errorEnvelope helper — opts {prefix, field, code} contract (#205).
//
// Pin the helper-level invariants the handler-internal call sites
// depend on:
//   1. caught DomainError + opts.prefix → field/code preserved from
//      the original; prefix concatenated; sanitizer runs on prefixed.
//   2. caught LockBusyError + opts.prefix → code='lock_busy', .holder
//      intact, no message duplication. (Devil v1 BLOCKER: the earlier
//      Object.assign(new ctor()) wrap pattern lost holder + duped
//      message; the prefix-on-helper design is precisely the fix.)
//   3. synthetic non-DomainError + opts.field/opts.code → fallback
//      lands in envelope.
//   4. precedence: err.field wins over opts.field; deriveErrorCode(err)
//      wins over opts.code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

// We invoke a small helper-runner in a child process so that
// `process.stderr.write` actually emits to a captured stream. Doing
// this inline would require monkey-patching process.stderr, which
// the test runner is opinionated about. The runner just imports
// emitErrorEnvelope from the built dist and exercises one path.
//
// Paths are converted to file:// URLs because Windows absolute paths
// (e.g. `D:\...\errorEnvelope.js`) trip ESM's url-scheme guard
// (`ERR_UNSUPPORTED_ESM_URL_SCHEME`). pathToFileURL is the portable form.
const here = dirname(fileURLToPath(import.meta.url));
// dist/tests/interface/ → ../../src + ../../bin.
const HELPER_PATH = pathToFileURL(
  resolve(here, '../../src/interface/shared/errorEnvelope.js'),
).href;
const DOMAIN_ERROR_PATH = pathToFileURL(
  resolve(here, '../../src/domain/shared/DomainError.js'),
).href;
const LOCK_PATH = pathToFileURL(
  resolve(here, '../../src/infrastructure/lock/guildLock.js'),
).href;

interface RunResult {
  envelope: { ok: boolean; error: { message: string; code?: string; field?: string } };
  errLine: string;
  raw: string;
}

function runScenario(script: string): RunResult {
  const r = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { emitErrorEnvelope } from ${JSON.stringify(HELPER_PATH)};
       import { DomainError } from ${JSON.stringify(DOMAIN_ERROR_PATH)};
       import { LockBusyError } from ${JSON.stringify(LOCK_PATH)};
       ${script}`,
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0 && r.stderr.startsWith('node:')) {
    throw new Error(`scenario script crashed: ${r.stderr}`);
  }
  const lines = r.stderr.split('\n').filter((l) => l.length > 0);
  // first JSON line = envelope
  let envelope: RunResult['envelope'] | null = null;
  let errLine = '';
  for (const l of lines) {
    if (envelope === null && l.startsWith('{')) {
      envelope = JSON.parse(l);
    } else if (l.startsWith('error: ')) {
      errLine = l;
    }
  }
  if (!envelope) throw new Error(`no envelope in stderr: ${r.stderr}`);
  return { envelope, errLine, raw: r.stderr };
}

test('emitErrorEnvelope: caught DomainError + prefix preserves field + applies prefix', () => {
  const { envelope, errLine } = runScenario(`
    const err = new DomainError('slug must be lowercase', 'slug');
    emitErrorEnvelope(err, 'json', '/tmp/root', { prefix: 'failed to create: ' });
  `);
  assert.equal(envelope.error.field, 'slug');
  assert.equal(envelope.error.code, 'validation_error');
  assert.match(envelope.error.message, /^failed to create: slug must be lowercase$/);
  assert.match(errLine, /^error: failed to create: slug must be lowercase$/);
});

test('emitErrorEnvelope: caught LockBusyError + prefix keeps code=lock_busy + holder intact', () => {
  const { envelope } = runScenario(`
    const holder = { pid: 42, ppid: 1, started_at: '2026-05-06T00:00:00.000Z', verb: 'play', actor: 'someone-else', host: 'h', cwd: '/tmp/root', passage: 'agora', guild_cli_version: '0.0.0-test' };
    const err = new LockBusyError('/tmp/root/.guild-lock', holder);
    if (err.holder?.actor !== 'someone-else') throw new Error('holder lost pre-emit');
    // Pre-#205 wrap proposal would've consumed prefix as lockPath ctor arg
    // and lost .holder. Helper-prefix avoids the clone entirely; this
    // pins that path is intact.
    emitErrorEnvelope(err, 'json', '/tmp/root', { prefix: 'release-then-retry: ' });
  `);
  assert.equal(envelope.error.code, 'lock_busy');
  // No message duplication: prefix appears exactly once.
  const matches = envelope.error.message.match(/release-then-retry: /g) ?? [];
  assert.equal(matches.length, 1, `prefix should appear once, got: ${envelope.error.message}`);
});

test('emitErrorEnvelope: synthetic non-DomainError + opts.field/opts.code fallback', () => {
  const { envelope } = runScenario(`
    const err = new Error('something opaque happened');
    emitErrorEnvelope(err, 'json', '/tmp/root', { field: 'verb', code: 'validation_error' });
  `);
  assert.equal(envelope.error.field, 'verb');
  assert.equal(envelope.error.code, 'validation_error');
  assert.equal(envelope.error.message, 'something opaque happened');
});

test('emitErrorEnvelope: precedence — err.field wins over opts.field', () => {
  const { envelope } = runScenario(`
    const err = new DomainError('msg', 'real_field');
    emitErrorEnvelope(err, 'json', '/tmp/root', { field: 'opts_field' });
  `);
  assert.equal(envelope.error.field, 'real_field');
});

test('emitErrorEnvelope: precedence — deriveErrorCode wins over opts.code', () => {
  const { envelope } = runScenario(`
    // DomainError → deriveErrorCode returns 'validation_error', opts.code ignored.
    const err = new DomainError('msg', 'f');
    emitErrorEnvelope(err, 'json', '/tmp/root', { code: 'opts_code' });
  `);
  assert.equal(envelope.error.code, 'validation_error');
});

test('emitErrorEnvelope: text-mode emits no JSON envelope, just error: line', () => {
  // Don't go through runScenario (which expects an envelope).
  const r = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { emitErrorEnvelope } from ${JSON.stringify(HELPER_PATH)};
       import { DomainError } from ${JSON.stringify(DOMAIN_ERROR_PATH)};
       const err = new DomainError('msg', 'f');
       emitErrorEnvelope(err, 'text', '/tmp/root', { prefix: 'pfx: ' });`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0);
  for (const line of r.stderr.split('\n')) {
    assert.ok(!line.startsWith('{'), `text-mode leaked JSON envelope: ${line}`);
  }
  assert.match(r.stderr, /^error: pfx: msg\n$/);
});
