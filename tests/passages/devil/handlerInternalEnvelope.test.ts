// devil-review — handler-internal envelope parity (issue #205).
//
// Mirrors the agora-side coverage: pin that handler-internal error
// paths emit the JSON envelope when `--format json` is set, instead
// of writing plain `error: ...` text and silently dropping the flag.
// 7 must-fix devil sites (per Devil v3 ratify): entry.ts kind=gate,
// missing/invalid severity, missing/invalid severity-rationale, plus
// the dismiss/resolve/conclude/ingest synthetic sites and schema
// unknown-verb.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// dist/tests/passages/devil/ → ../../../../bin
const DEVIL = resolve(here, '../../../../bin/devil.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'devil-h205-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  mkdirSync(join(root, 'members'));
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
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

function parseEnvelope(stderr: string): {
  ok: boolean;
  error: { message: string; code?: string; field?: string };
} {
  const lines = stderr.split('\n');
  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && obj.ok === false) return obj;
    } catch {
      // not the envelope line
    }
  }
  throw new Error(`no envelope in stderr: ${stderr}`);
}

/** Open a fresh review and return its id. devil opens via `devil open <target>`. */
function openReview(root: string): string {
  const r = spawnSync(
    process.execPath,
    [DEVIL, 'open', 'src/foo.ts', '--type', 'file', '--format', 'json'],
    {
      cwd: root,
      env: { ...process.env, GUILD_ACTOR: 'alice' },
      encoding: 'utf8',
    },
  );
  if (r.status !== 0) {
    throw new Error(`setup: devil open failed: ${r.stderr}`);
  }
  const out = JSON.parse(r.stdout) as { review_id: string };
  return out.review_id;
}

// --- entry.ts: kind=gate (post-format synthetic) -------------------

test('devil entry --kind=gate --format json emits field=kind envelope', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const r = runDevil(
    root,
    [
      'entry', reviewId,
      '--persona', 'red-team',
      '--lense', 'memory-safety',
      '--kind', 'gate',
      '--text', 'irrelevant',
      '--format', 'json',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  const env = parseEnvelope(r.stderr);
  assert.equal(env.error.field, 'kind');
  assert.equal(env.error.code, 'validation_error');
  assert.match(env.error.message, /kind='gate' is rejected/);
});

// --- entry.ts: missing --severity for kind=finding ------------------

test('devil entry --kind=finding without --severity --format json emits field=severity', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const r = runDevil(
    root,
    [
      'entry', reviewId,
      '--persona', 'red-team',
      '--lense', 'memory-safety',
      '--kind', 'finding',
      '--text', 'irrelevant',
      '--format', 'json',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  const env = parseEnvelope(r.stderr);
  assert.equal(env.error.field, 'severity');
  assert.match(env.error.message, /--severity required/);
});

// --- entry.ts: --severity on non-finding kind -----------------------

test('devil entry --kind=skip --severity x --format json emits field=severity', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const r = runDevil(
    root,
    [
      'entry', reviewId,
      '--persona', 'red-team',
      '--lense', 'memory-safety',
      '--kind', 'skip',
      '--text', 'irrelevant for this PR',
      '--severity', 'medium',
      '--format', 'json',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  const env = parseEnvelope(r.stderr);
  assert.equal(env.error.field, 'severity');
  assert.match(env.error.message, /only valid when --kind=finding/);
});

// --- dismiss.ts: entry not found (post-format synthetic) -----------

test('devil dismiss <missing-entry> --format json emits field=entry_id', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  const r = runDevil(
    root,
    [
      'dismiss', reviewId, 'e-999',
      '--reason', 'false-positive',
      '--format', 'json',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  const env = parseEnvelope(r.stderr);
  assert.equal(env.error.field, 'entry_id');
  assert.match(env.error.message, /entry "e-999" not found/);
});

// --- text-mode hint preservation: dismiss kind=non-finding ---------

test('devil dismiss wrong-kind text mode: hint stays on stderr', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const reviewId = openReview(root);
  // Add a kind=skip entry, then try to dismiss it (wrong kind).
  const add = runDevil(
    root,
    [
      'entry', reviewId,
      '--persona', 'red-team',
      '--lense', 'memory-safety',
      '--kind', 'skip',
      '--text', 'irrelevant',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(add.status, 0, `setup: ${add.stderr}`);
  const r = runDevil(
    root,
    ['dismiss', reviewId, 'e-001', '--reason', 'false-positive'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  // No JSON envelope leaked into text mode.
  for (const line of r.stderr.split('\n')) {
    assert.ok(!line.startsWith('{'), `text-mode leaked JSON envelope: ${line}`);
  }
  assert.match(r.stderr, /only kind='finding' entries can be dismissed/);
  // Multi-line text hint still present.
  assert.match(r.stderr, /substrate, not transitioned/);
});

// --- devil schema unknown verb (synthetic site, throws DomainError) ---

test('devil schema --verb <unknown> --format json emits field=verb', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runDevil(
    root,
    ['schema', '--verb', 'no-such-verb', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 1);
  const env = parseEnvelope(r.stderr);
  assert.equal(env.error.field, 'verb');
  assert.match(env.error.message, /no devil verb named "no-such-verb"/);
});
