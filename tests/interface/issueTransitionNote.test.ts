// gate issues defer/resolve/start/reopen --note (#289 hunk 1)
//
// state_log audit trail records who/when transitioned an issue but
// pre-#289 had no slot for *why*. Optional --note <s> persists into
// the matching state_log entry as `note: <s>` and is omitted when
// absent (byte-stable YAML invariant — pre-#289 records round-trip
// identically).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import {
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = makeTempRoot('guild-issue-note-');
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
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

function runGate(
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

function newIssue(root: string): string {
  const add = runGate(
    root,
    [
      'issues',
      'add',
      '--from',
      'alice',
      '--severity',
      'low',
      '--area',
      'ux',
      '--text',
      'test issue',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(add.status, 0, `add failed: ${add.stderr}`);
  const m = add.stdout.match(/i-\d{4}-\d{2}-\d{2}-\d+/);
  assert.ok(m, 'issue id should be emitted');
  return m[0];
}

test('issues resolve --note persists onto state_log entry', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = newIssue(root);

  const r = runGate(
    root,
    [
      'issues',
      'resolve',
      id,
      '--by',
      'alice',
      '--note',
      'cannot reproduce on macOS 14.5',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, `resolve failed: ${r.stderr}`);

  const yml = join(root, 'issues', `${id}.yaml`);
  const parsed = YAML.parse(readFileSync(yml, 'utf8'));
  assert.equal(parsed.state_log.length, 1);
  assert.equal(parsed.state_log[0].state, 'resolved');
  assert.equal(parsed.state_log[0].by, 'alice');
  assert.equal(
    parsed.state_log[0].note,
    'cannot reproduce on macOS 14.5',
  );
});

test('issues defer --note persists onto state_log entry', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = newIssue(root);

  const r = runGate(
    root,
    [
      'issues',
      'defer',
      id,
      '--by',
      'alice',
      '--note',
      'waiting on upstream patch',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, `defer failed: ${r.stderr}`);

  const yml = join(root, 'issues', `${id}.yaml`);
  const parsed = YAML.parse(readFileSync(yml, 'utf8'));
  assert.equal(parsed.state_log[0].state, 'deferred');
  assert.equal(parsed.state_log[0].note, 'waiting on upstream patch');
});

test('issues resolve without --note omits the field (byte-stable)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = newIssue(root);

  const r = runGate(
    root,
    ['issues', 'resolve', id, '--by', 'alice'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0, `resolve failed: ${r.stderr}`);

  const yml = join(root, 'issues', `${id}.yaml`);
  const raw = readFileSync(yml, 'utf8');
  // Byte-stable: pre-#289 YAML never carried `note:` on state_log
  // entries, so the same write without --note must not introduce it.
  assert.doesNotMatch(raw, /^\s*note:/m);
  const parsed = YAML.parse(raw);
  assert.equal(parsed.state_log[0].note, undefined);
});

test('issues note round-trips through hydrate (resolve + reopen with notes)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = newIssue(root);

  // Two transitions, each with its own note.
  const r1 = runGate(
    root,
    [
      'issues',
      'resolve',
      id,
      '--by',
      'alice',
      '--note',
      'shipped in v0.6',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r1.status, 0, r1.stderr);

  const r2 = runGate(
    root,
    [
      'issues',
      'reopen',
      id,
      '--by',
      'alice',
      '--note',
      'regression spotted in 0.6.1',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r2.status, 0, r2.stderr);

  const yml = join(root, 'issues', `${id}.yaml`);
  const parsed = YAML.parse(readFileSync(yml, 'utf8'));
  assert.equal(parsed.state_log.length, 2);
  assert.equal(parsed.state_log[0].note, 'shipped in v0.6');
  assert.equal(parsed.state_log[1].note, 'regression spotted in 0.6.1');

  // Hydrate by reading via gate show to confirm the repo round-trips
  // the note back out (json mode preserves the structure).
  const list = runGate(root, ['issues', 'list', '--state', 'open', '--format', 'json']);
  assert.equal(list.status, 0, list.stderr);
  const items = JSON.parse(list.stdout) as Array<Record<string, unknown>>;
  const issue = items.find((i) => i['id'] === id);
  assert.ok(issue, `issue ${id} should be in open list after reopen`);
  const log = issue['state_log'] as Array<Record<string, unknown>>;
  assert.equal(log.length, 2);
  assert.equal(log[0]!['note'], 'shipped in v0.6');
  assert.equal(log[1]!['note'], 'regression spotted in 0.6.1');
});
