// gate issues promote stamps opened_by_session (#289 hunk 2)
//
// promote → request is the same write-side primitive as `gate request`,
// so the GUILD_SESSION_ID → opened_by_session contract from #249 must
// apply equally. Pre-#289 the promote handler did NOT thread
// resolveGuildSessionId, so the resulting request never carried the
// session stamp even when the env was set.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  writeFileSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from '../util/tempRoot.js';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = makeTempRoot('guild-issue-promote-sess-');
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
  env: Record<string, string | undefined> = {},
): { stdout: string; stderr: string; status: number } {
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete merged[k];
    else merged[k] = v;
  }
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env: merged,
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

function newIssue(root: string, env: Record<string, string | undefined> = {}): string {
  const add = run(
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
      'something to promote',
    ],
    { GUILD_ACTOR: 'alice', ...env },
  );
  assert.equal(add.status, 0, `add failed: ${add.stderr}`);
  const m = add.stdout.match(/i-\d{4}-\d{2}-\d{2}-\d+/);
  assert.ok(m, 'issue id should be emitted');
  return m[0];
}

const SESSION = 'alice-local-2026-05-11-promote';

test('issues promote stamps opened_by_session from GUILD_SESSION_ID', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const issueId = newIssue(root);

  const promote = run(
    root,
    [
      'issues',
      'promote',
      issueId,
      '--from',
      'alice',
      '--executors',
      'alice',
    ],
    { GUILD_ACTOR: 'alice', GUILD_SESSION_ID: SESSION },
  );
  assert.equal(promote.status, 0, `promote failed: ${promote.stderr}`);
  const m = promote.stdout.match(/(\d{4}-\d{2}-\d{2}-\d+)/);
  assert.ok(m, 'request id should appear in promote stdout');
  const reqId = m[1]!;

  const show = run(root, ['show', reqId, '--format', 'json']);
  assert.equal(show.status, 0, `show failed: ${show.stderr}`);
  const j = JSON.parse(show.stdout) as Record<string, unknown>;
  assert.equal(j['opened_by_session'], SESSION);
});

test('issues promote: GUILD_SESSION_ID unset → no opened_by_session field', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const issueId = newIssue(root);

  const promote = run(
    root,
    [
      'issues',
      'promote',
      issueId,
      '--from',
      'alice',
      '--executors',
      'alice',
    ],
    { GUILD_ACTOR: 'alice', GUILD_SESSION_ID: undefined },
  );
  assert.equal(promote.status, 0, `promote failed: ${promote.stderr}`);
  const m = promote.stdout.match(/(\d{4}-\d{2}-\d{2}-\d+)/);
  assert.ok(m, 'request id should appear in promote stdout');
  const reqId = m[1]!;

  const show = run(root, ['show', reqId, '--format', 'json']);
  assert.equal(show.status, 0);
  const j = JSON.parse(show.stdout) as Record<string, unknown>;
  // Byte-stable: pre-#289 promote-without-session never wrote this
  // field, so the same write today must not introduce it.
  assert.equal(j['opened_by_session'], undefined);
});
