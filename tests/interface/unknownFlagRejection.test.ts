// unknown flag rejection — fail-closed at the verb layer.
//
// The parser (parseArgs) is intentionally permissive: any `--key value`
// becomes options[key]. Permissiveness at the parser layer is fine —
// callers who alias future flags shouldn't crash the parser.
// But at the *verb* layer, an unknown flag like `gate tail --from noir`
// must not be silently ignored: the caller typed `--from noir` expecting
// a filter, and got unfiltered output that looked like a filter result.
//
// This test exercises `gate tail` as the pilot verb that opted into
// `rejectUnknownFlags`. Other verbs migrate individually in follow-ups.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseArgs,
  rejectUnknownFlags,
} from '../../src/interface/shared/parseArgs.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-unknown-flag-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
  );
  mkdirSync(join(root, 'members'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runGate(
  cwd: string,
  args: string[],
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: { ...process.env },
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

// --- unit tests for the helper itself ---

test('rejectUnknownFlags: pass when all flags are known', () => {
  const args = parseArgs(['--limit', '10']);
  assert.doesNotThrow(() =>
    rejectUnknownFlags(args, new Set(['limit']), 'tail'),
  );
});

test('rejectUnknownFlags: throw when an unknown flag is present', () => {
  const args = parseArgs(['--from', 'noir']);
  assert.throws(
    () => rejectUnknownFlags(args, new Set(['limit']), 'tail'),
    /unknown flag.*--from/,
  );
});

test('rejectUnknownFlags: error names every unknown flag, sorted', () => {
  const args = parseArgs(['--bogus', 'x', '--also-bad', 'y']);
  try {
    rejectUnknownFlags(args, new Set(['limit']), 'tail');
    assert.fail('expected throw');
  } catch (e) {
    const msg = (e as Error).message;
    assert.match(msg, /--also-bad/);
    assert.match(msg, /--bogus/);
    // sorted alphabetically
    assert.ok(
      msg.indexOf('--also-bad') < msg.indexOf('--bogus'),
      'unknown flags should be listed sorted',
    );
  }
});

test('rejectUnknownFlags: error surfaces the valid flag set', () => {
  const args = parseArgs(['--from', 'noir']);
  try {
    rejectUnknownFlags(args, new Set(['limit', 'format']), 'tail');
    assert.fail('expected throw');
  } catch (e) {
    const msg = (e as Error).message;
    assert.match(msg, /valid flags for 'tail'/);
    assert.match(msg, /--format/);
    assert.match(msg, /--limit/);
  }
});

test('rejectUnknownFlags: singular/plural wording', () => {
  const oneArg = parseArgs(['--from', 'noir']);
  try {
    rejectUnknownFlags(oneArg, new Set(['limit']), 'tail');
    assert.fail();
  } catch (e) {
    assert.match((e as Error).message, /unknown flag: /);
  }
  const twoArgs = parseArgs(['--from', 'noir', '--to', 'eris']);
  try {
    rejectUnknownFlags(twoArgs, new Set(['limit']), 'tail');
    assert.fail();
  } catch (e) {
    assert.match((e as Error).message, /unknown flags: /);
  }
});

// --- E2E: `gate tail` is the pilot caller ---

test('gate tail --from <x> now errors (used to silently ignore)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(root, ['register', '--name', 'alice', '--category', 'professional']);
  const r = runGate(root, ['tail', '--from', 'alice']);
  assert.notEqual(r.status, 0, 'exit should be non-zero');
  assert.match(r.stderr, /unknown flag.*--from/);
  assert.match(r.stderr, /valid flags for 'tail'/);
});

test('gate tail 10 --limit 5 still works (known flag)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(root, ['register', '--name', 'alice', '--category', 'professional']);
  const r = runGate(root, ['tail', '10', '--limit', '5']);
  assert.equal(r.status, 0, 'known flag should not error');
});

test('gate tail (no flags) still works', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  runGate(root, ['register', '--name', 'alice', '--category', 'professional']);
  const r = runGate(root, ['tail']);
  assert.equal(r.status, 0);
});

// --- read-verb sweep: every read verb rejects unknown flags ---
//
// Pre-sweep, only tail/doctor/repair/unresponded had this discipline;
// the rest fail-opened. A typo like `gate pending --format json` would
// silently render text instead of error. Each entry below uses
// `--bogus-flag-xyz` (deliberately implausible) so the test surfaces
// the discipline, not a flag-name overlap with future legitimate flags.
//
// Verbs that need a positional id are given a placeholder; the strict-
// flag check fires before the id is parsed, so any value works.

const READ_VERB_CASES: ReadonlyArray<{
  verb: string;
  args: readonly string[];
}> = [
  { verb: 'boot', args: [] },
  { verb: 'status', args: [] },
  { verb: 'board', args: [] },
  { verb: 'suggest', args: [] },
  { verb: 'resume', args: [] },
  { verb: 'schema', args: [] },
  { verb: 'show', args: ['2026-01-01-0001'] },
  { verb: 'chain', args: ['2026-01-01-0001'] },
  { verb: 'pending', args: [] },
  { verb: 'list', args: ['--state', 'pending'] },
  { verb: 'voices', args: ['alice'] },
  { verb: 'whoami', args: [] },
  { verb: 'summarize', args: ['2026-01-01-0001'] },
  { verb: 'why', args: ['2026-01-01-0001'] },
  { verb: 'transcript', args: ['2026-01-01-0001'] },
];

for (const { verb, args } of READ_VERB_CASES) {
  test(`gate ${verb} rejects unknown flag --bogus-flag-xyz`, (t) => {
    const { root, cleanup } = bootstrap();
    t.after(cleanup);
    runGate(root, ['register', '--name', 'alice', '--category', 'professional']);
    const r = runGate(root, [verb, ...args, '--bogus-flag-xyz']);
    assert.notEqual(r.status, 0, `${verb} should exit non-zero on unknown flag`);
    assert.match(
      r.stderr,
      new RegExp(`gate ${verb}: unknown flag.*--bogus-flag-xyz`),
      `${verb} stderr should name the verb and the bogus flag`,
    );
  });
}
