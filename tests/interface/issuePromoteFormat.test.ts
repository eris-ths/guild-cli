// gate issues promote --format (CLI↔doc friction #2)
//
// promote is a write verb but pre-this lacked --format, so an agent
// couldn't receive the created request id as JSON — a schema-as-contract
// gap (principle 10): every other write verb returns the unified
// ok/id/state/message/suggested_next envelope. This pins that promote now
// shares that envelope, and that the resolved-issue id survives in the
// message field (records-outlive-writers, principle 04).
//
// Decided in agora play promote-format-impl 2026-06-23-001
// (devil: shape integrity / noir: principle 04).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = makeTempRoot('guild-issue-promote-fmt-');
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
  );
  mkdirSync(join(root, 'members'));
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
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
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? -1 };
}

function addIssue(root: string): string {
  run(root, ['issues', 'add', '--from', 'alice', '--severity', 'low', '--area', 'docs', 'an observation'], {
    GUILD_ACTOR: 'alice',
  });
  const env = JSON.parse(run(root, ['issues', 'list', '--state', 'open', '--format', 'json']).stdout);
  return env[0].id;
}

test('promote --format json returns the unified write envelope', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const issueId = addIssue(root);

  const r = run(root, ['issues', 'promote', issueId, '--from', 'alice', '--executors', 'alice', '--reason', 'fix it', '--format', 'json'], {
    GUILD_ACTOR: 'alice',
  });
  assert.equal(r.status, 0);
  const env = JSON.parse(r.stdout);
  // Same envelope keys as `gate request` (schema-as-contract, principle 10).
  assert.equal(env.ok, true);
  assert.match(env.id, /^\d{4}-\d{2}-\d{2}-\d{4}$/);
  assert.equal(env.state, 'pending');
  assert.ok(env.suggested_next, 'carries suggested_next like other write verbs');
  // The resolved-issue id survives in the message (records-outlive-writers).
  assert.match(env.message, new RegExp(issueId));
  assert.match(env.message, new RegExp(env.id));
});

test('promote --format text keeps the original line', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const issueId = addIssue(root);

  const r = run(root, ['issues', 'promote', issueId, '--from', 'alice', '--executors', 'alice', '--reason', 'fix it', '--format', 'text'], {
    GUILD_ACTOR: 'alice',
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /✓ promoted/);
  assert.match(r.stdout, new RegExp(issueId));
  assert.match(r.stdout, /issue resolved/);
});

test('promote with no --format defaults to text (back-compat)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const issueId = addIssue(root);

  const r = run(root, ['issues', 'promote', issueId, '--from', 'alice', '--executors', 'alice', '--reason', 'fix it'], {
    GUILD_ACTOR: 'alice',
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /✓ promoted/);
  // not JSON
  assert.doesNotMatch(r.stdout, /^\{/);
});
