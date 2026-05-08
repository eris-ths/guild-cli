// Self-approve policy gate (#233).
//
// Tri-state `features.self_approve` { allowed | warn | forbidden }
// gates `gate approve` when the approver matches the request author.
// Profile defaults: warn under standard (historical behaviour),
// forbidden under swarm (parallel waves require bias-checked
// approvals). An explicit features.self_approve always wins, so a
// deployment can opt in/out without flipping the whole profile.
//
// Surface contract verified here:
//   - swarm  + self-approve              → exit 1 + actionable error
//                                          (fast-track / other actor /
//                                          profile change all named)
//   - standard + self-approve            → notice + pass (current default)
//   - features.self_approve: allowed     → pass silently (no notice)
//   - swarm + features.self_approve: warn override → notice + pass
//   - fast-track is unaffected           (orthogonal verb, never gated)
//   - non-self approve                   → no notice, no error,
//                                          regardless of profile/policy
//   - malformed self_approve string      → onMalformed warn + profile
//                                          default (forbidden under swarm)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function mkdtempReal(prefix: string): string {
  return realpathSync(mkdtempSync(prefix));
}

interface Bootstrap {
  root: string;
  cleanup: () => void;
}

function bootstrap(yaml: string): Bootstrap {
  const root = mkdtempReal(join(tmpdir(), 'guild-selfapprove-'));
  writeFileSync(join(root, 'guild.config.yaml'), yaml);
  mkdirSync(join(root, 'members'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(
  cwd: string,
  args: string[],
  actor?: string,
): { stdout: string; stderr: string; status: number } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (actor !== undefined) env['GUILD_ACTOR'] = actor;
  else delete env['GUILD_ACTOR'];
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env,
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

function registerAll(root: string, names: string[]): void {
  for (const n of names) {
    run(root, ['register', '--name', n]);
  }
}

function createRequest(
  root: string,
  args: { from: string; executors?: string[] },
): string {
  const cliArgs = [
    'request',
    '--from',
    args.from,
    '--action',
    'do thing',
    '--reason',
    'r',
    '--format',
    'json',
  ];
  if (args.executors && args.executors.length > 0) {
    cliArgs.push('--executors', args.executors.join(','));
  }
  const r = run(root, cliArgs);
  assert.equal(r.status, 0, `request failed: ${r.stderr}`);
  return (JSON.parse(r.stdout) as { id: string }).id;
}

test('swarm profile: self-approve is forbidden with actionable error', (t) => {
  const { root, cleanup } = bootstrap(
    'content_root: .\nhost_names: [eris]\nprofile: swarm\n',
  );
  t.after(cleanup);
  registerAll(root, ['alice', 'bob']);
  const id = createRequest(root, { from: 'alice', executors: ['bob'] });

  const ap = run(root, ['approve', id, '--by', 'alice']);
  assert.equal(ap.status, 1, `should refuse self-approve: stderr=${ap.stderr}`);
  assert.match(ap.stderr, /self-approve forbidden/);
  assert.match(ap.stderr, /\(swarm\)/);
  assert.match(ap.stderr, /fast-track/);
  assert.match(ap.stderr, /--by <other>/);
  assert.match(ap.stderr, /self_approve: warn/);
});

test('standard profile: self-approve emits notice but passes (historical default)', (t) => {
  const { root, cleanup } = bootstrap(
    'content_root: .\nhost_names: [eris]\nprofile: standard\n',
  );
  t.after(cleanup);
  registerAll(root, ['alice', 'bob']);
  const id = createRequest(root, { from: 'alice', executors: ['bob'] });

  const ap = run(root, ['approve', id, '--by', 'alice']);
  assert.equal(ap.status, 0, `should pass: stderr=${ap.stderr}`);
  assert.match(ap.stderr, /approved their own request/);
});

test('features.self_approve: allowed → pass silently (no notice)', (t) => {
  const { root, cleanup } = bootstrap(
    'content_root: .\nhost_names: [eris]\nprofile: standard\n' +
      'features:\n  self_approve: allowed\n',
  );
  t.after(cleanup);
  registerAll(root, ['alice', 'bob']);
  const id = createRequest(root, { from: 'alice', executors: ['bob'] });

  const ap = run(root, ['approve', id, '--by', 'alice']);
  assert.equal(ap.status, 0, `should pass: stderr=${ap.stderr}`);
  assert.doesNotMatch(
    ap.stderr,
    /approved their own request/,
    `expected NO self-approve notice under 'allowed': ${ap.stderr}`,
  );
});

test('swarm + features.self_approve: warn override → notice + pass', (t) => {
  const { root, cleanup } = bootstrap(
    'content_root: .\nhost_names: [eris]\nprofile: swarm\n' +
      'features:\n  self_approve: warn\n',
  );
  t.after(cleanup);
  registerAll(root, ['alice', 'bob']);
  const id = createRequest(root, { from: 'alice', executors: ['bob'] });

  const ap = run(root, ['approve', id, '--by', 'alice']);
  assert.equal(
    ap.status,
    0,
    `explicit warn should override swarm default: stderr=${ap.stderr}`,
  );
  assert.match(ap.stderr, /approved their own request/);
});

test('fast-track is unaffected by self_approve policy (swarm)', (t) => {
  const { root, cleanup } = bootstrap(
    'content_root: .\nhost_names: [eris]\nprofile: swarm\n',
  );
  t.after(cleanup);
  registerAll(root, ['alice']);

  const ft = run(root, [
    'fast-track',
    '--from',
    'alice',
    '--action',
    'quick',
    '--reason',
    'r',
  ]);
  assert.equal(
    ft.status,
    0,
    `fast-track must pass under swarm regardless of self_approve: ${ft.stderr}`,
  );
});

test('non-self approve passes without notice under standard', (t) => {
  const { root, cleanup } = bootstrap(
    'content_root: .\nhost_names: [eris]\nprofile: standard\n',
  );
  t.after(cleanup);
  registerAll(root, ['alice', 'bob']);
  const id = createRequest(root, { from: 'alice', executors: ['bob'] });

  const ap = run(root, ['approve', id, '--by', 'bob']);
  assert.equal(ap.status, 0, `non-self approve should pass: ${ap.stderr}`);
  assert.doesNotMatch(
    ap.stderr,
    /approved their own request/,
    `non-self approve must not emit self-approve notice: ${ap.stderr}`,
  );
});

test('non-self approve passes under swarm (forbidden gate is self-only)', (t) => {
  const { root, cleanup } = bootstrap(
    'content_root: .\nhost_names: [eris]\nprofile: swarm\n',
  );
  t.after(cleanup);
  registerAll(root, ['alice', 'bob']);
  const id = createRequest(root, { from: 'alice', executors: ['bob'] });

  const ap = run(root, ['approve', id, '--by', 'bob']);
  assert.equal(
    ap.status,
    0,
    `non-self approve must pass under swarm: ${ap.stderr}`,
  );
  assert.doesNotMatch(ap.stderr, /self-approve forbidden/);
});

test('malformed features.self_approve → onMalformed warn + profile default applies', (t) => {
  const { root, cleanup } = bootstrap(
    'content_root: .\nhost_names: [eris]\nprofile: swarm\n' +
      'features:\n  self_approve: yes\n',
  );
  t.after(cleanup);
  registerAll(root, ['alice', 'bob']);
  const id = createRequest(root, { from: 'alice', executors: ['bob'] });

  const ap = run(root, ['approve', id, '--by', 'alice']);
  // onMalformed message surfaces on stderr (defaultOnMalformed writes there).
  assert.match(
    ap.stderr,
    /unknown features\.self_approve/,
    `expected onMalformed warn for malformed value: ${ap.stderr}`,
  );
  // Profile default applies → swarm → forbidden.
  assert.equal(
    ap.status,
    1,
    `swarm default should still apply after malformed value: ${ap.stderr}`,
  );
  assert.match(ap.stderr, /self-approve forbidden/);
});
