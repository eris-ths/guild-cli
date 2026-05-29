// gate execute <id> on a pending request — verb-shape redirect.
//
// Sibling of failFromPendingRedirect.test.ts. The domain refuses
// pending → executing and surfaces the valid next states ("approved,
// denied") by design — state vocabulary lives in the domain, verb
// hints are an interface concern (RequestState.ts comment). Before
// this redirect a caller who skipped `gate approve` read the
// state-name hint and had to translate "approved" back into the verb.
// The interface pre-check names `gate approve` directly so the next
// step is one line away, matching the established reqFail pattern
// (pending→deny, approved→execute).
//
// Pins both surfaces: the prose `error:` bridge and the structured
// `error.recovery` slot the JSON envelope carries for AI dispatch.

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
  const root = mkdtempSync(join(tmpdir(), 'guild-execute-pending-'));
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

function fileRequest(root: string, action: string): string {
  const filed = run(
    root,
    ['request', '--action', action, '--reason', action, '--executors', 'alice', '--format', 'json'],
    { GUILD_ACTOR: 'eris' },
  );
  assert.equal(filed.status, 0, filed.stderr);
  return (JSON.parse(filed.stdout) as { id: string }).id;
}

test('gate execute on a pending request redirects to gate approve by name', () => {
  const b = bootstrap();
  try {
    const id = fileRequest(b.root, 'execute-redirect pin');
    const r = run(b.root, ['execute', id, '--by', 'alice'], { GUILD_ACTOR: 'eris' });
    assert.notEqual(r.status, 0, 'execute from pending must exit non-zero');
    const combined = r.stdout + r.stderr;
    assert.match(combined, /is pending/, 'error must name the pending state');
    assert.match(combined, /gate approve/, 'error must surface `gate approve` as the next verb');
    assert.match(
      combined,
      new RegExp(`gate approve\\s+${id}\\b`),
      'redirect must include the id for copy/paste',
    );
  } finally {
    b.cleanup();
  }
});

test('gate execute on a pending request — JSON envelope carries error.recovery', () => {
  const b = bootstrap();
  try {
    const id = fileRequest(b.root, 'execute recovery probe');
    const r = run(
      b.root,
      ['execute', id, '--by', 'alice', '--format', 'json'],
      { GUILD_ACTOR: 'eris' },
    );
    assert.notEqual(r.status, 0);
    const envelopeLine = r.stderr.split('\n').find((ln) => ln.trim().startsWith('{'));
    assert.ok(envelopeLine, 'JSON envelope line must be present on stderr');
    const env = JSON.parse(envelopeLine!);
    assert.equal(env.ok, false);
    assert.ok(env.error.recovery, 'error.recovery must be present');
    assert.equal(env.error.recovery.verb, 'approve');
    assert.equal(env.error.code, 'illegal_transition');
    assert.equal(env.error.recovery.args.id, id);
    assert.match(env.error.recovery.reason, /pending/, 'recovery.reason must name why approve is the path');
  } finally {
    b.cleanup();
  }
});

test('gate execute --dry-run on a pending request redirects too (no preview of an illegal transition)', () => {
  const b = bootstrap();
  try {
    const id = fileRequest(b.root, 'execute dry-run redirect');
    const r = run(b.root, ['execute', id, '--by', 'alice', '--dry-run'], { GUILD_ACTOR: 'eris' });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /gate approve/);
  } finally {
    b.cleanup();
  }
});

test('regression: execute on an approved request still transitions to executing', () => {
  const b = bootstrap();
  try {
    const id = fileRequest(b.root, 'approved-then-execute');
    run(b.root, ['approve', id, '--by', 'eris'], { GUILD_ACTOR: 'eris' });
    const r = run(b.root, ['execute', id, '--by', 'alice'], { GUILD_ACTOR: 'eris' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /executing/);
  } finally {
    b.cleanup();
  }
});
