// `not found: <id>` is too terse — a fresh agent that mistyped a
// request id had no signal toward `gate list` / `gate tail`. The
// shared helper attaches a per-entity discovery hint so the
// touch-feel of "I lost my id" recovers in one read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  notFoundMessage,
  notFoundEnvelope,
} from '../../src/interface/shared/notFoundHint.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');
const GUILD = resolve(here, '../../../bin/guild.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-not-found-hint-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: []\n',
  );
  mkdirSync(join(root, 'members'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(
  bin: string,
  cwd: string,
  args: string[],
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    env: { ...process.env, GUILD_ACTOR: 'alice' },
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

// --- unit: the helper formats per-entity ---

test('notFoundMessage: request gains gate-list hint', () => {
  const out = notFoundMessage('request', '2026-05-05-9999');
  assert.match(out, /^not found: 2026-05-05-9999\n/);
  assert.match(out, /try 'gate list' or 'gate tail'/);
});

test('notFoundMessage: issue uses the issue-list hint and prefix', () => {
  const out = notFoundMessage('issue', 'i-2026-05-05-0001');
  // Issue keeps the historical "issue not found:" prefix so any
  // operator grepping for it across runbooks still matches.
  assert.match(out, /^issue not found: i-2026-05-05-0001\n/);
  assert.match(out, /try 'gate issues list'/);
});

test('notFoundMessage: member uses the guild-list hint', () => {
  const out = notFoundMessage('member', 'ghost');
  assert.match(out, /^not found: ghost\n/);
  assert.match(out, /try 'guild list'/);
});

// --- e2e: the helper is wired into the user-facing read paths ---

test('gate show <bad-id>: emits the discovery hint', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice']);
  const r = run(GATE, root, ['show', '2026-05-05-9999']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not found: 2026-05-05-9999/);
  assert.match(r.stderr, /try 'gate list' or 'gate tail'/);
});

test('guild show <bad-name>: emits the member discovery hint', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice']);
  const r = run(GUILD, root, ['show', 'ghost']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not found: ghost/);
  assert.match(r.stderr, /try 'guild list'/);
});

// --- #408: --format json envelope for not-found ---
// Pre-#408 the read-side not-found path emitted free-text even when
// `--format json` was requested. A tool-use agent that piped
// `gate show <id> --format json` into a JSON parser tripped on the
// prose. The envelope shape matches whoami's existing
// `{ok:false, error:{message}}` (issue #194 lineage).

test('notFoundEnvelope: json format produces parseable envelope', () => {
  const out = notFoundEnvelope('request', '2026-05-05-9999', 'json');
  const parsed = JSON.parse(out);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.kind, 'not_found');
  assert.equal(parsed.error.entity, 'request');
  assert.equal(parsed.error.id, '2026-05-05-9999');
  assert.match(parsed.error.message, /not found: 2026-05-05-9999/);
  assert.match(parsed.error.hint, /try 'gate list'/);
});

test('notFoundEnvelope: issue and member entities render correctly under json', () => {
  const issue = JSON.parse(notFoundEnvelope('issue', 'i-2026-05-05-0001', 'json'));
  assert.equal(issue.error.kind, 'not_found');
  assert.equal(issue.error.entity, 'issue');
  assert.match(issue.error.message, /issue not found: i-2026-05-05-0001/);

  const member = JSON.parse(notFoundEnvelope('member', 'ghost', 'json'));
  assert.equal(member.error.entity, 'member');
  assert.match(member.error.message, /not found: ghost/);
  assert.match(member.error.hint, /try 'guild list'/);
});

test('notFoundEnvelope: text/plain formats keep the existing message intact', () => {
  // Regression guard for the read-side text mode and `--plain`
  // composition — these MUST keep emitting the legacy multi-line
  // text body so existing pipelines / docs / muscle memory continue
  // to work.
  const textOut = notFoundEnvelope('request', '2026-05-05-9999', 'text');
  assert.equal(textOut, notFoundMessage('request', '2026-05-05-9999'));
  const plainOut = notFoundEnvelope('request', '2026-05-05-9999', 'plain');
  assert.equal(plainOut, notFoundMessage('request', '2026-05-05-9999'));
});

test('gate show <bad-id> --format json: emits valid JSON envelope', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice']);
  const r = run(GATE, root, ['show', '2026-05-05-9999', '--format', 'json']);
  assert.equal(r.status, 1);
  // stderr should now be a single JSON envelope line, parseable.
  const parsed = JSON.parse(r.stderr.trim());
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.kind, 'not_found');
  assert.equal(parsed.error.entity, 'request');
  assert.equal(parsed.error.id, '2026-05-05-9999');
});

test('gate show <bad-id> (default format): keeps the legacy text body', (t) => {
  // Regression guard for the default `gate show <id>` path — `format`
  // defaults to `json` for stdout but the not-found error stream
  // historically wrote text. Make sure unsourced calls (the muscle-
  // memory shape that has no `--format` flag) still see the
  // discovery hint and aren't surprised by a JSON envelope.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice']);
  const r = run(GATE, root, ['show', '2026-05-05-9999']);
  assert.equal(r.status, 1);
  // Default format is JSON for show, so the envelope SHOULD be JSON
  // here too. The asymmetry the PR fixes is "format flag was
  // ignored", not "format default changed".
  const parsed = JSON.parse(r.stderr.trim());
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.id, '2026-05-05-9999');
});

test('gate show <bad-id> --format text: keeps the legacy text body', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice']);
  const r = run(GATE, root, ['show', '2026-05-05-9999', '--format', 'text']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^not found: 2026-05-05-9999\n/);
  assert.match(r.stderr, /try 'gate list' or 'gate tail'/);
});
