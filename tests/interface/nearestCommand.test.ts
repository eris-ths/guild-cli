// Did-you-mean port: agora / ctx / devil now use the same shared
// `nearestCommand` helper that gate had locally. Pre-fix, only gate
// suggested a near match; the other passages dumped HELP without a
// hint, breaking the cross-passage discoverability parity.
//
// This file pins the unit shape of `nearestCommand` (distance cap,
// case-insensitive, gracefully nullable input) and the e2e behaviour
// for each passage's unknown-verb branch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { nearestCommand } from '../../src/interface/shared/nearestCommand.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');
const AGORA = resolve(here, '../../../bin/agora.mjs');
const CTX = resolve(here, '../../../bin/ctx.mjs');
const DEVIL = resolve(here, '../../../bin/devil.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-nearest-cmd-'));
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

// --- unit ---

test('nearestCommand: returns the closest within distance cap', () => {
  const known = ['approve', 'deny', 'execute', 'complete'];
  assert.equal(nearestCommand('aprove', known), 'approve');
  assert.equal(nearestCommand('exectue', known), 'execute');
  assert.equal(nearestCommand('complte', known), 'complete');
});

test('nearestCommand: case-insensitive on input', () => {
  assert.equal(nearestCommand('APROVE', ['approve']), 'approve');
});

test('nearestCommand: refuses to suggest when distance exceeds cap', () => {
  // "foo" is 3 edits from any common verb — too far. Cap is
  // min(2, floor(len/2)+1) = min(2, 2) = 2 for "foo", but no real
  // verb is within 2 edits of "foo".
  assert.equal(nearestCommand('foo', ['approve', 'deny', 'execute']), null);
});

test('nearestCommand: short input gets a tighter cap', () => {
  // For input "a" (length 1), cap = min(2, floor(1/2)+1) = min(2, 1) = 1.
  // "approve" is 6 edits away — too far. Should refuse rather than
  // suggest a wildly different verb.
  assert.equal(nearestCommand('a', ['approve', 'deny']), null);
});

test('nearestCommand: undefined input returns null (safe default)', () => {
  // When the dispatcher has no cmd to suggest against, "no suggestion"
  // is the right answer — not a crash.
  assert.equal(nearestCommand(undefined, ['approve']), null);
});

test('nearestCommand: empty string returns null', () => {
  assert.equal(nearestCommand('', ['approve']), null);
});

// --- e2e: each passage's unknown-verb branch suggests its own catalog ---

test('agora <typo>: suggests agora-prefixed verb', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice']);
  const r = run(AGORA, root, ['nuw']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown verb: nuw/);
  assert.match(r.stderr, /did you mean: agora new\?/);
});

test('agora <unrelated>: refuses to suggest when nothing close', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice']);
  const r = run(AGORA, root, ['absolutely-not-a-verb']);
  assert.equal(r.status, 1);
  assert.equal(/did you mean/.test(r.stderr), false);
  assert.match(r.stderr, /agora --help/);
});

test('ctx <typo>: suggests ctx-prefixed verb (current catalog)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice']);
  const r = run(CTX, root, ['recor']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown verb: recor/);
  assert.match(r.stderr, /did you mean: ctx record\?/);
  // Verb-catalog callout — flag the available surface at the point a
  // typo hit it, since the remaining phase-2 lifecycle verbs (fork /
  // chain / status) are not yet implemented and a typo for any of those
  // would refuse to suggest.
  assert.match(r.stderr, /record \/ supersede \/ list \/ show \/ export \/ import/);
});

test('ctx <phase-2 verb>: roadmap-aware message, not a bare "unknown verb"', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice']);
  // `fork` is documented as a remaining phase-2 verb (record / supersede /
  // list / show shipped); a reader of the docs who types it should be told
  // it's planned, not treated like a typo.
  const r = run(CTX, root, ['fork']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /planned phase-2 verb, not yet implemented/);
  assert.match(r.stderr, /current surface: record \/ supersede \/ list \/ show \/ export \/ import/);
  assert.doesNotMatch(r.stderr, /unknown verb/);
});

test('devil <typo>: suggests devil-prefixed verb', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice']);
  const r = run(DEVIL, root, ['oepn']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown verb: oepn/);
  assert.match(r.stderr, /did you mean: devil open\?/);
});

test('agora --help: no longer says "v0 skeleton"', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = run(AGORA, root, ['--help']);
  assert.equal(r.status, 0);
  assert.equal(/v0 skeleton/.test(r.stdout), false, 'stale label removed');
  assert.match(r.stdout, /alpha/);
});
