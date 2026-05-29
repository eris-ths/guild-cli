// gate fail <id> on a pending request — verb-shape redirect.
//
// The domain refuses pending → failed and surfaces the valid next
// states ("approved, denied") by design — state vocabulary lives in
// the domain, verb hints are an interface concern (RequestState.ts
// comment). Before this redirect, a cold-session caller reading the
// state hint had to translate "denied" back to the `gate deny` verb,
// which was itself --all-only (separate friction, fixed by promoting
// deny to BASE help in the same change). The friction was observed
// 2026-05-13 while draining 4 stale pending test-fixtures: `gate fail`
// returned the state-name hint, the caller hunted for a `cancel`
// verb, and only `--all` revealed `deny`.
//
// This test pins the interface-layer pre-check: when fail is called
// against a pending request, the error names `gate deny` directly so
// the next step is one line away.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-fail-pending-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
  );
  mkdirSync(join(root, 'members'));
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function run(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [GATE, ...args], {
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

test('gate fail on a pending request redirects to gate deny by name', () => {
  const b = bootstrap();
  try {
    const filed = run(
      b.root,
      [
        'request',
        '--action',
        'test fixture',
        '--reason',
        'pending-redirect pin',
        '--executors',
        'alice',
        '--format',
        'json',
      ],
      { GUILD_ACTOR: 'eris' },
    );
    assert.equal(filed.status, 0);
    const id = (JSON.parse(filed.stdout) as { id: string }).id;

    const failed = run(
      b.root,
      ['fail', id, '--by', 'alice', '--reason', 'cancel'],
      { GUILD_ACTOR: 'eris' },
    );
    assert.notEqual(failed.status, 0, 'fail from pending must exit non-zero');
    const combined = failed.stdout + failed.stderr;
    assert.match(
      combined,
      /is pending/,
      'error must name the pending state so the caller knows why fail was refused',
    );
    assert.match(
      combined,
      /gate deny/,
      'error must surface `gate deny` as the next verb (the friction this redirect closes)',
    );
    assert.match(
      combined,
      new RegExp(`gate deny\\s+${id}\\b`),
      'redirect must include the id so the caller can copy/paste the next command',
    );
  } finally {
    b.cleanup();
  }
});

test('gate fail on a pending request — JSON envelope carries error.recovery', () => {
  // Structured-recovery shape: the prose hint above is mirrored by a
  // machine-readable `error.recovery: {verb, args, reason}` slot in
  // the JSON envelope so AI agents can dispatch the next move without
  // parsing the prose. The text-mode test above stays untouched —
  // the prose surface is unchanged; the structured surface is the
  // additive new contract.
  const b = bootstrap();
  try {
    const filed = run(
      b.root,
      [
        'request',
        '--action', 'recovery probe',
        '--reason', 'recovery probe',
        '--executors', 'alice',
        '--format', 'json',
      ],
      { GUILD_ACTOR: 'eris' },
    );
    assert.equal(filed.status, 0);
    const id = (JSON.parse(filed.stdout) as { id: string }).id;

    const failed = run(
      b.root,
      ['fail', id, '--by', 'alice', '--reason', 'cancel', '--format', 'json'],
      { GUILD_ACTOR: 'eris' },
    );
    assert.notEqual(failed.status, 0);
    // The envelope is emitted to stderr (JSON line 1) then prose
    // (stderr line 2); pick the first line that parses as JSON.
    const envelopeLine = failed.stderr
      .split('\n')
      .find((ln) => ln.trim().startsWith('{'));
    assert.ok(envelopeLine, 'JSON envelope line must be present on stderr');
    const env = JSON.parse(envelopeLine!);
    assert.equal(env.ok, false);
    assert.ok(env.error.recovery, 'error.recovery must be present');
    assert.equal(env.error.recovery.verb, 'deny');
    // The reworded redirect message escapes deriveErrorCode's prose
    // scan; RecoverableError still classifies it so a code-branching
    // agent isn't blind to the richest-recovery errors.
    assert.equal(env.error.code, 'illegal_transition');
    assert.equal(env.error.recovery.args.id, id);
    assert.match(
      env.error.recovery.reason,
      /pending/,
      'recovery.reason must name why deny is the recovery path',
    );
  } finally {
    b.cleanup();
  }
});
