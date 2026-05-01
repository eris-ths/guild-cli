// gate issues list — discoverability + JSON output.
//
// Surfaces this test pins:
//   - default-state filter is announced on stderr (not silent)
//   - `--state all` returns every state in one call
//   - `--format json` emits an array of nested issue objects
//   - bare `gate issues` (no subcommand) prints a hint and exits 1,
//     instead of silently routing to `issues list`
//
// Why this exists: the open-vs-active mismatch between
// `status.open_issues` (counts open+in_progress) and `gate issues list`
// default (open only) used to be invisible. The hint text names that
// difference at the surface where the reader sees it. See design
// 2026-05-01-0001 / 0002 for the absorbed devil review that landed
// on "expose the difference, don't hide it".

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
  const root = mkdtempSync(join(tmpdir(), 'guild-issues-list-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  for (const d of ['members', 'requests', 'issues', 'inbox']) {
    mkdirSync(join(root, d));
  }
  for (const name of ['alice', 'bob']) {
    writeFileSync(
      join(root, 'members', `${name}.yaml`),
      `name: ${name}\ncategory: professional\nactive: true\n`,
    );
  }
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

// Seed two issues across three states so list filtering is observable.
function seedFixture(root: string): void {
  runGate(root, [
    'issues', 'add',
    '--from', 'alice', '--severity', 'med', '--area', 'docs',
    '--text', 'first',
  ], { GUILD_ACTOR: 'alice' });
  runGate(root, [
    'issues', 'add',
    '--from', 'alice', '--severity', 'high', '--area', 'infra',
    '--text', 'second',
  ], { GUILD_ACTOR: 'alice' });
  // Move the second one to in_progress so the open-vs-all distinction
  // is visible.
  runGate(root, [
    'issues', 'start', 'i-2026-05-01-0002',
  ], { GUILD_ACTOR: 'alice' });
}

test('gate issues (no subcommand) emits a hint + exit 1', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['issues'], { GUILD_ACTOR: 'alice' });
  assert.notEqual(r.status, 0, 'bare `issues` should fail closed');
  assert.match(r.stderr, /needs a subcommand/);
  // Hints at the most common entry points.
  assert.match(r.stderr, /gate issues list/);
  assert.match(r.stderr, /gate issues add/);
  assert.match(r.stderr, /gate issues note/);
  // Gestures at the full catalog without listing it inline.
  assert.match(r.stderr, /add\|list\|note\|resolve\|defer\|start\|reopen\|promote/);
});

test('gate issues list (default) emits a stderr hint disclosing the open-only filter', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // Re-date the seed for the test to find by id below.
  const today = new Date().toISOString().slice(0, 10);
  runGate(root, [
    'issues', 'add',
    '--from', 'alice', '--severity', 'med', '--area', 'docs',
    '--text', 'lone',
  ], { GUILD_ACTOR: 'alice' });
  const r = runGate(root, ['issues', 'list'], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 0);
  // The hint names the filter, the status mismatch, AND --state.
  assert.match(r.stderr, /filtered to state=open/);
  assert.match(r.stderr, /status counts open\+in_progress/);
  assert.match(r.stderr, /--state to override/);
  // The actual list still appears on stdout.
  assert.match(r.stdout, new RegExp(`i-${today}`));
});

test('gate issues list --state open does NOT emit the default hint', (t) => {
  // The hint exists to disclose an *implicit* filter. When the caller
  // typed --state explicitly, there is nothing to disclose.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedFixture(root);
  const r = runGate(
    root,
    ['issues', 'list', '--state', 'open'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stderr, /filtered to state=open/);
});

test('gate issues list --state all returns every state in one call', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedFixture(root);
  const r = runGate(
    root,
    ['issues', 'list', '--state', 'all'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  // Open and in_progress fixture issues both surface.
  assert.match(r.stdout, /open from=alice — first/);
  assert.match(r.stdout, /in_progress from=alice — second/);
});

test('gate issues list --format json emits an array of nested issue objects', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // Seed an open issue with a note so the json shape is visible.
  runGate(root, [
    'issues', 'add',
    '--from', 'alice', '--severity', 'low', '--area', 'docs',
    '--text', 'with-note',
  ], { GUILD_ACTOR: 'alice' });
  const today = new Date().toISOString().slice(0, 10);
  const id = `i-${today}-0001`;
  runGate(root, [
    'issues', 'note', id, '--by', 'bob', '--text', 'observed',
  ], { GUILD_ACTOR: 'bob' });
  const r = runGate(
    root,
    ['issues', 'list', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  const items = JSON.parse(r.stdout);
  assert.ok(Array.isArray(items));
  assert.equal(items.length, 1);
  const issue = items[0];
  assert.equal(issue.id, id);
  assert.equal(issue.state, 'open');
  assert.equal(issue.severity, 'low');
  assert.equal(issue.area, 'docs');
  assert.equal(issue.from, 'alice');
  assert.equal(issue.text, 'with-note');
  // Notes stay nested in json (the text format flattens them; the
  // shape decision is documented in the design review for this fix).
  assert.ok(Array.isArray(issue.notes));
  assert.equal(issue.notes.length, 1);
  assert.equal(issue.notes[0].by, 'bob');
  assert.equal(issue.notes[0].text, 'observed');
});

test('gate issues list --format json suppresses the stderr hint', (t) => {
  // The hint is for human readers scanning text; pumping prose into
  // a json caller's stderr would be noise. Stay clean for pipelines.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedFixture(root);
  const r = runGate(
    root,
    ['issues', 'list', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stderr, /filtered to state=open/);
});

test('gate issues list --state all --format json returns every issue as json', (t) => {
  // The two flags compose: `--state all` widens the set, `--format
  // json` shapes the output.
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  seedFixture(root);
  const r = runGate(
    root,
    ['issues', 'list', '--state', 'all', '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  const items = JSON.parse(r.stdout);
  assert.equal(items.length, 2);
  const states = items.map((i: { state: string }) => i.state).sort();
  assert.deepEqual(states, ['in_progress', 'open']);
});

test('gate issues list --format bogus errors', (t) => {
  // Format value validation, not flag-set rejection (--format itself
  // is now a known flag for issues list).
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(
    root,
    ['issues', 'list', '--format', 'yaml'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--format must be 'text' or 'json'/);
});
