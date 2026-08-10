// Issue state transitions record an audit trail (state_log).
//
// Pre-fix: `gate issues resolve/defer/start/reopen` set `state` in
// place with no record of who did it or when. open → resolved →
// open → resolved was indistinguishable from a single open → resolved
// in the YAML. Forensics was impossible.
//
// Fix: every transition appends one `state_log` entry: {state, by, at,
// invoked_by?}. The `--by` flag (or GUILD_ACTOR) is now required.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-issue-audit-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  mkdirSync(join(root, 'members'));
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    'name: alice\ncategory: professional\nactive: true\n',
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
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

function issueFilename(root: string): string {
  // Issues are stored under issues/<id>.yaml; find the first one.
  //
  // This used to call `require('node:fs')`, which throws in an ES
  // module. Nothing called it, so nothing noticed: the helper shipped
  // broken and stayed that way until the first test that reached for
  // it. Unreached code carries no signal about whether it works.
  const issuesDir = join(root, 'issues');
  const yml = readdirSync(issuesDir).find((f) => f.endsWith('.yaml'));
  return yml ? join(issuesDir, yml) : '';
}

test('issues resolve writes a state_log entry with by + at', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
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
  assert.equal(add.status, 0);
  const idMatch = add.stdout.match(/i-\d{4}-\d{2}-\d{2}-\d+/);
  assert.ok(idMatch, 'issue id should be emitted');
  const id = idMatch[0];

  const resolve_ = runGate(
    root,
    ['issues', 'resolve', id, '--by', 'alice'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(resolve_.status, 0);
  assert.match(resolve_.stdout, /→ resolved by alice/);

  const yml = join(root, 'issues', `${id}.yaml`);
  const parsed = YAML.parse(readFileSync(yml, 'utf8'));
  assert.equal(parsed.state, 'resolved');
  assert.ok(Array.isArray(parsed.state_log), 'state_log should exist');
  assert.equal(parsed.state_log.length, 1);
  assert.equal(parsed.state_log[0].state, 'resolved');
  assert.equal(parsed.state_log[0].by, 'alice');
  assert.ok(parsed.state_log[0].at, 'at should be set');
});

test('issues resolve → reopen → resolve records all 3 transitions', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
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
      'flapping issue',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  const id = add.stdout.match(/i-\d{4}-\d{2}-\d{2}-\d+/)![0];
  runGate(root, ['issues', 'resolve', id, '--by', 'alice'], {
    GUILD_ACTOR: 'alice',
  });
  runGate(root, ['issues', 'reopen', id, '--by', 'alice'], {
    GUILD_ACTOR: 'alice',
  });
  runGate(root, ['issues', 'resolve', id, '--by', 'alice'], {
    GUILD_ACTOR: 'alice',
  });

  const yml = join(root, 'issues', `${id}.yaml`);
  const parsed = YAML.parse(readFileSync(yml, 'utf8'));
  assert.equal(parsed.state, 'resolved');
  assert.equal(parsed.state_log.length, 3);
  assert.equal(parsed.state_log[0].state, 'resolved');
  assert.equal(parsed.state_log[1].state, 'open');
  assert.equal(parsed.state_log[2].state, 'resolved');
  // Without state_log, all three of these transitions would be lost
  // — only the final state=resolved would remain visible.
});

test('issues resolve requires --by or GUILD_ACTOR', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
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
      'x',
    ],
    { GUILD_ACTOR: 'alice' },
  );
  const id = add.stdout.match(/i-\d{4}-\d{2}-\d{2}-\d+/)![0];
  // No --by, no GUILD_ACTOR → must fail loudly
  const r = runGate(root, ['issues', 'resolve', id]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--by/);
});

test('legacy issue YAML without state_log still loads (backward compat)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // Hand-write a legacy issue (no state_log field) and show/list it.
  mkdirSync(join(root, 'issues'));
  const legacy = {
    id: 'i-2026-04-20-0001',
    from: 'alice',
    severity: 'low',
    area: 'ux',
    text: 'legacy issue predating audit trail',
    state: 'open',
    created_at: '2026-04-20T00:00:00Z',
  };
  writeFileSync(
    join(root, 'issues', 'i-2026-04-20-0001.yaml'),
    YAML.stringify(legacy),
  );
  const list = runGate(root, ['issues', 'list']);
  assert.equal(list.status, 0);
  assert.match(list.stdout, /i-2026-04-20-0001/);

  // A transition on a legacy issue should start its state_log at [].
  const resolve_ = runGate(
    root,
    ['issues', 'resolve', 'i-2026-04-20-0001', '--by', 'alice'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(resolve_.status, 0);
  const parsed = YAML.parse(
    readFileSync(join(root, 'issues', 'i-2026-04-20-0001.yaml'), 'utf8'),
  );
  assert.equal(parsed.state, 'resolved');
  assert.equal(parsed.state_log.length, 1, 'one entry: the resolve we just did');
  assert.equal(parsed.state_log[0].state, 'resolved');
  assert.equal(parsed.state_log[0].by, 'alice');
});

// ── note-flag symmetry across the issues sub-verbs (2026-08-10) ─────
//
// `issues note` took `--text`; `issues resolve|defer|start|reopen`
// took `--note`. Both attach free-form prose to an issue, so whichever
// one you learned first bounced on the other with "unknown flag".
// Measured twice in one dogfood session. Each sub-verb now accepts the
// sibling's spelling; the canonical name is unchanged.

test('issues note accepts --note as an alias of --text', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const add = runGate(root, [
    'issues', 'add', '--from', 'alice',
    '--severity', 'low', '--area', 'test', '--text', 'body',
  ]);
  assert.equal(add.status, 0, add.stderr);
  const id = add.stdout.match(/i-\d{4}-\d{2}-\d{2}-\d{4}/)?.[0] ?? '';
  assert.ok(id, `no issue id in: ${add.stdout}`);

  const r = runGate(root, [
    'issues', 'note', id, '--by', 'alice', '--note', 'via the alias',
  ]);
  assert.equal(r.status, 0, r.stderr);
  const doc = YAML.parse(readFileSync(issueFilename(root), 'utf8')) as {
    notes?: { text: string }[];
  };
  assert.ok(
    (doc.notes ?? []).some((n) => n.text === 'via the alias'),
    `note text not persisted; got ${JSON.stringify(doc.notes)}`,
  );
});

test('issues resolve accepts --text as an alias of --note', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const add = runGate(root, [
    'issues', 'add', '--from', 'alice',
    '--severity', 'low', '--area', 'test', '--text', 'body',
  ]);
  assert.equal(add.status, 0, add.stderr);
  const id = add.stdout.match(/i-\d{4}-\d{2}-\d{2}-\d{4}/)?.[0] ?? '';
  assert.ok(id, `no issue id in: ${add.stdout}`);

  const r = runGate(root, [
    'issues', 'resolve', id, '--by', 'alice', '--text', 'closed via alias',
  ]);
  assert.equal(r.status, 0, r.stderr);
  const doc = YAML.parse(readFileSync(issueFilename(root), 'utf8')) as {
    state_log?: { state: string; note?: string }[];
  };
  const entry = (doc.state_log ?? []).find((e) => e.state === 'resolved');
  assert.equal(
    entry?.note,
    'closed via alias',
    `state_log note not persisted; got ${JSON.stringify(doc.state_log)}`,
  );
});
