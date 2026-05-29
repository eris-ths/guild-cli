// Verb-shape redirects for `gate complete` (from approved) and
// `gate deny` (from executing) — siblings of failFromPendingRedirect
// and executeFromPendingRedirect.
//
// Scoped by a dev-substrate agora play (2026-05-29-001): only the two
// transitions with a clean single-verb bridge get a redirect —
//   - complete on an APPROVED request → `gate execute` (then complete)
//   - deny on an EXECUTING request    → `gate fail` (the cancel path
//     once work has started; deny is the *pending* cancel)
// complete-on-pending (multi-step) and deny-on-approved (no clean cancel
// verb) deliberately keep the domain's state-name hint. State vocabulary
// stays in the domain; the verb hint is an interface concern.

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
  const root = mkdtempSync(join(tmpdir(), 'guild-deny-complete-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
  );
  mkdirSync(join(root, 'members'));
  writeFileSync(
    join(root, 'members', 'worker.yaml'),
    'name: worker\ncategory: professional\nactive: true\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
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

/** File a request and return its id. */
function fileRequest(root: string, action: string): string {
  const r = run(
    root,
    ['request', '--from', 'eris', '--action', action, '--reason', 'r', '--executors', 'worker', '--format', 'json'],
    { GUILD_ACTOR: 'eris' },
  );
  assert.equal(r.status, 0, r.stderr);
  return (JSON.parse(r.stdout) as { id: string }).id;
}

function approved(root: string, action: string): string {
  const id = fileRequest(root, action);
  run(root, ['approve', id, '--by', 'eris'], { GUILD_ACTOR: 'eris' });
  return id;
}

function executing(root: string, action: string): string {
  const id = approved(root, action);
  run(root, ['execute', id, '--by', 'worker'], { GUILD_ACTOR: 'eris' });
  return id;
}

// ── complete on approved → execute ──────────────────────────────

test('gate complete on an approved request redirects to gate execute by name', () => {
  const b = bootstrap();
  try {
    const id = approved(b.root, 'complete-redirect');
    const r = run(b.root, ['complete', id, '--by', 'worker'], { GUILD_ACTOR: 'eris' });
    assert.notEqual(r.status, 0);
    const combined = r.stdout + r.stderr;
    assert.match(combined, /is approved/);
    assert.match(combined, new RegExp(`gate execute\\s+${id}\\b`));
  } finally {
    b.cleanup();
  }
});

test('gate complete on approved --format json carries error.recovery {verb:execute}', () => {
  const b = bootstrap();
  try {
    const id = approved(b.root, 'complete-recovery');
    const r = run(b.root, ['complete', id, '--by', 'worker', '--format', 'json'], { GUILD_ACTOR: 'eris' });
    assert.notEqual(r.status, 0);
    const line = r.stderr.split('\n').find((l) => l.trim().startsWith('{'));
    assert.ok(line, 'expected JSON envelope on stderr');
    const env = JSON.parse(line!);
    assert.equal(env.error.recovery.verb, 'execute');
    assert.equal(env.error.recovery.args.id, id);
  } finally {
    b.cleanup();
  }
});

// ── deny on executing → fail ────────────────────────────────────

test('gate deny on an executing request redirects to gate fail by name', () => {
  const b = bootstrap();
  try {
    const id = executing(b.root, 'deny-redirect');
    const r = run(b.root, ['deny', id, '--by', 'eris', '--reason', 'no'], { GUILD_ACTOR: 'eris' });
    assert.notEqual(r.status, 0);
    const combined = r.stdout + r.stderr;
    assert.match(combined, /is executing/);
    assert.match(combined, new RegExp(`gate fail\\s+${id}\\b`));
  } finally {
    b.cleanup();
  }
});

test('gate deny on executing --format json carries error.recovery {verb:fail}', () => {
  const b = bootstrap();
  try {
    const id = executing(b.root, 'deny-recovery');
    const r = run(b.root, ['deny', id, '--by', 'eris', '--reason', 'no', '--format', 'json'], { GUILD_ACTOR: 'eris' });
    assert.notEqual(r.status, 0);
    const line = r.stderr.split('\n').find((l) => l.trim().startsWith('{'));
    assert.ok(line, 'expected JSON envelope on stderr');
    const env = JSON.parse(line!);
    assert.equal(env.error.recovery.verb, 'fail');
    assert.equal(env.error.recovery.args.id, id);
  } finally {
    b.cleanup();
  }
});

test('gate deny --dry-run on an executing request redirects too', () => {
  const b = bootstrap();
  try {
    const id = executing(b.root, 'deny-dryrun');
    const r = run(b.root, ['deny', id, '--by', 'eris', '--reason', 'no', '--dry-run'], { GUILD_ACTOR: 'eris' });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /gate fail/);
  } finally {
    b.cleanup();
  }
});

// ── deliberately NOT redirected (scoping guard) ─────────────────

test('gate complete on pending keeps the domain state-name hint (no verb redirect)', () => {
  const b = bootstrap();
  try {
    const id = fileRequest(b.root, 'complete-pending');
    const r = run(b.root, ['complete', id, '--by', 'worker'], { GUILD_ACTOR: 'eris' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Illegal state transition: pending → completed/);
    // multi-step recovery → no single-verb redirect is offered.
    assert.doesNotMatch(r.stderr, /error\.recovery|gate execute .*\n.*gate complete/);
  } finally {
    b.cleanup();
  }
});

test('regression: complete on executing and deny on pending still succeed', () => {
  const b = bootstrap();
  try {
    const exec = executing(b.root, 'still-completes');
    const c = run(b.root, ['complete', exec, '--by', 'worker'], { GUILD_ACTOR: 'eris' });
    assert.equal(c.status, 0, c.stderr);
    assert.match(c.stdout, /completed/);

    const pend = fileRequest(b.root, 'still-denies');
    const d = run(b.root, ['deny', pend, '--by', 'eris', '--reason', 'no'], { GUILD_ACTOR: 'eris' });
    assert.equal(d.status, 0, d.stderr);
    assert.match(d.stdout, /denied/);
  } finally {
    b.cleanup();
  }
});
