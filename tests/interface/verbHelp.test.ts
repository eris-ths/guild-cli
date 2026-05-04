// `<cli> <verb> --help` — universal escape valve.
//
// Pre-fix, `--help` was rejected as an unknown flag on every verb of
// every CLI (gate / agora / devil / ctx). Fresh agents typing `gate
// whoami --help` to discover the verb's flag surface hit a soft error
// instead of help. This file pins the new behaviour: rejectUnknownFlags
// throws a typed `HelpRequested` signal carrying the verb name +
// known flag set; each binary's main() catches it, renders verb help,
// and exits 0.

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
  HelpRequested,
} from '../../src/interface/shared/parseArgs.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');
const AGORA = resolve(here, '../../../bin/agora.mjs');
const DEVIL = resolve(here, '../../../bin/devil.mjs');
const CTX = resolve(here, '../../../bin/ctx.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-verb-help-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
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
    env: { ...process.env },
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

// --- unit tests for the throw-typed signal ---

test('rejectUnknownFlags: --help throws HelpRequested with verb + known flags', () => {
  const args = parseArgs(['--help']);
  try {
    rejectUnknownFlags(args, new Set(['limit', 'format']), 'tail');
    assert.fail('expected HelpRequested');
  } catch (e) {
    assert.ok(e instanceof HelpRequested, 'should throw HelpRequested');
    const h = e as HelpRequested;
    assert.equal(h.verb, 'tail');
    assert.deepEqual(h.knownFlags, ['format', 'limit'], 'flags sorted');
  }
});

test('rejectUnknownFlags: --help short-circuits even when other flags are present', () => {
  // --help wins over `--bogus`; the user asked for help, not an error.
  const args = parseArgs(['--bogus', '--help']);
  try {
    rejectUnknownFlags(args, new Set(['limit']), 'tail');
    assert.fail('expected HelpRequested');
  } catch (e) {
    assert.ok(e instanceof HelpRequested);
  }
});

test('rejectUnknownFlags: HelpRequested carries empty array when verb has no known flags', () => {
  const args = parseArgs(['--help']);
  try {
    rejectUnknownFlags(args, new Set(), 'register');
    assert.fail('expected HelpRequested');
  } catch (e) {
    assert.ok(e instanceof HelpRequested);
    assert.deepEqual((e as HelpRequested).knownFlags, []);
  }
});

test('rejectUnknownFlags: --help is never reported as an unknown flag', () => {
  // Sanity guard: even if a future caller forgot to handle HelpRequested,
  // --help should not surface as "unknown flag: --help" in the error.
  // (The throw branch is HelpRequested; the unknown-flag branch skips it.)
  const args = parseArgs(['--help']);
  assert.throws(
    () => rejectUnknownFlags(args, new Set(['limit']), 'tail'),
    (e: unknown) => e instanceof HelpRequested,
    'should be HelpRequested, not generic Error',
  );
});

test('rejectUnknownFlags: still throws plain Error for non-help unknown flags', () => {
  // Regression guard for the non-help path.
  const args = parseArgs(['--bogus']);
  assert.throws(
    () => rejectUnknownFlags(args, new Set(['limit']), 'tail'),
    (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.ok(!(e instanceof HelpRequested));
      assert.match(e.message, /unknown flag.*--bogus/);
      return true;
    },
  );
});

// --- E2E: `<cli> <verb> --help` exits 0 across all four CLIs ---

test('gate <verb> --help: exits 0 and renders the flag catalog', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice', '--category', 'professional']);
  const r = run(GATE, root, ['whoami', '--help']);
  assert.equal(r.status, 0, 'whoami --help should exit 0');
  assert.match(r.stdout, /gate whoami: --limit/);
  assert.match(r.stdout, /see `gate --help`/);
});

test('gate tail --help: works on a verb with a richer flag set', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice', '--category', 'professional']);
  const r = run(GATE, root, ['tail', '--help']);
  assert.equal(r.status, 0);
  // tail accepts --limit, --format, etc. — pin two we know are documented.
  assert.match(r.stdout, /gate tail:/);
  assert.match(r.stdout, /--format/);
  assert.match(r.stdout, /--limit/);
});

test('agora <verb> --help: exits 0 and uses the agora prefix', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice', '--category', 'professional']);
  const r = run(AGORA, root, ['list', '--help']);
  assert.equal(r.status, 0, 'agora list --help should exit 0');
  assert.match(r.stdout, /agora list:/);
  assert.match(r.stdout, /see `agora --help`/);
});

test('devil <verb> --help: exits 0 and uses the devil prefix', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice', '--category', 'professional']);
  const r = run(DEVIL, root, ['list', '--help']);
  assert.equal(r.status, 0, 'devil list --help should exit 0');
  assert.match(r.stdout, /devil list:/);
  assert.match(r.stdout, /see `devil --help`/);
});

test('ctx record --help: exits 0 and uses the ctx prefix', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice', '--category', 'professional']);
  const r = run(CTX, root, ['record', '--help']);
  assert.equal(r.status, 0, 'ctx record --help should exit 0');
  assert.match(r.stdout, /ctx record:/);
  assert.match(r.stdout, /--fact/);
  assert.match(r.stdout, /--tag/);
});

test('non-help unknown flag still errors with verb-only prefix (no "gate" hardcode)', (t) => {
  // Cross-CLI sanity: agora's error message should NOT say "gate" anymore.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  run(GATE, root, ['register', '--name', 'alice', '--category', 'professional']);
  const r = run(AGORA, root, ['list', '--bogus-flag-xyz']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /list: unknown flag.*--bogus-flag-xyz/);
  assert.equal(
    /gate list: unknown flag/.test(r.stderr),
    false,
    'agora errors should not say "gate"',
  );
});
