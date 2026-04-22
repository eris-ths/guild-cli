// Strict unknown-flag rejection across all write verbs.
//
// Companion to `unknownFlagRejection.test.ts` (the helper + tail pilot).
// This suite smoke-tests every write verb that opted into
// rejectUnknownFlags in the follow-up PR, so a future verb that
// forgets to call the helper shows up as a red line here.
//
// Pattern: for each verb, run a known-bad invocation (typo flag that
// is NOT in the verb's known set), assert non-zero exit and an error
// message naming the bad flag.

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
  const root = mkdtempSync(join(tmpdir(), 'guild-write-strict-'));
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

function register(root: string, name: string) {
  runGate(root, ['register', '--name', name, '--category', 'professional']);
}

type VerbCase = {
  name: string;
  args: string[];
  bogus: string; // the unknown flag that should trigger rejection
};

const VERB_CASES: ReadonlyArray<VerbCase> = [
  {
    name: 'register',
    args: ['register', '--name', 'alice', '--catgeory', 'professional'],
    bogus: '--catgeory',
  },
  {
    name: 'request',
    args: [
      'request',
      '--from',
      'alice',
      '--action',
      'x',
      '--reason',
      'y',
      '--executr',
      'alice',
    ],
    bogus: '--executr',
  },
  {
    name: 'fast-track',
    args: [
      'fast-track',
      '--from',
      'alice',
      '--action',
      'x',
      '--reason',
      'y',
      '--executr',
      'alice',
    ],
    bogus: '--executr',
  },
  {
    name: 'thank',
    args: [
      'thank',
      'alice',
      '--for',
      '2026-04-22-0001',
      '--reasn',
      'thanks',
      '--by',
      'alice',
    ],
    bogus: '--reasn',
  },
  {
    name: 'review',
    args: [
      'review',
      '2026-04-22-0001',
      '--by',
      'alice',
      '--lense',
      'devil',
      '--verdict',
      'ok',
      '--commnt',
      'LGTM',
    ],
    bogus: '--commnt',
  },
  {
    name: 'message',
    args: [
      'message',
      '--from',
      'alice',
      '--to',
      'alice',
      '--text',
      'hi',
      '--kind',
      'info',
    ],
    bogus: '--kind',
  },
  {
    name: 'broadcast',
    args: [
      'broadcast',
      '--from',
      'alice',
      '--text',
      'hi',
      '--kind',
      'info',
    ],
    bogus: '--kind',
  },
  {
    name: 'inbox',
    args: ['inbox', '--for', 'alice', '--unreadd'],
    bogus: '--unreadd',
  },
  {
    name: 'issues add',
    args: [
      'issues',
      'add',
      '--from',
      'alice',
      '--severity',
      'low',
      '--area',
      'ux',
      '--text',
      'body',
      '--priority',
      'high',
    ],
    bogus: '--priority',
  },
  {
    name: 'issues note',
    args: [
      'issues',
      'note',
      'i-2026-04-22-0001',
      '--by',
      'alice',
      '--text',
      'update',
      '--bogus',
      'x',
    ],
    bogus: '--bogus',
  },
  {
    name: 'issues promote',
    args: [
      'issues',
      'promote',
      'i-2026-04-22-0001',
      '--from',
      'alice',
      '--bogus',
      'x',
    ],
    bogus: '--bogus',
  },
  {
    name: 'approve',
    args: [
      'approve',
      '2026-04-22-0001',
      '--by',
      'alice',
      '--bogus',
      'x',
    ],
    bogus: '--bogus',
  },
  {
    name: 'deny',
    args: [
      'deny',
      '2026-04-22-0001',
      '--by',
      'alice',
      '--reason',
      'no',
      '--bogus',
      'x',
    ],
    bogus: '--bogus',
  },
  {
    name: 'execute',
    args: [
      'execute',
      '2026-04-22-0001',
      '--by',
      'alice',
      '--bogus',
      'x',
    ],
    bogus: '--bogus',
  },
  {
    name: 'complete',
    args: [
      'complete',
      '2026-04-22-0001',
      '--by',
      'alice',
      '--bogus',
      'x',
    ],
    bogus: '--bogus',
  },
  {
    name: 'fail',
    args: [
      'fail',
      '2026-04-22-0001',
      '--by',
      'alice',
      '--reason',
      'nope',
      '--bogus',
      'x',
    ],
    bogus: '--bogus',
  },
];

for (const vc of VERB_CASES) {
  test(`gate ${vc.name} rejects unknown flag ${vc.bogus}`, (t) => {
    const { root, cleanup } = bootstrap();
    t.after(cleanup);
    register(root, 'alice');
    const r = runGate(root, vc.args);
    assert.notEqual(r.status, 0, `exit should be non-zero for bogus flag`);
    assert.match(
      r.stderr,
      new RegExp(`unknown flag[s]?.*${vc.bogus.replace('--', '\\-\\-')}`),
      `stderr should name the bogus flag ${vc.bogus}`,
    );
    assert.match(r.stderr, /valid flags for/, 'stderr should list valid flags');
  });
}

test('smoke: known-good invocations still work (register + request)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  register(root, 'alice');
  const req = runGate(root, [
    'request',
    '--from',
    'alice',
    '--action',
    'a',
    '--reason',
    'r',
    '--executor',
    'alice',
  ]);
  assert.equal(req.status, 0, `known-good request should succeed: ${req.stderr}`);
});
