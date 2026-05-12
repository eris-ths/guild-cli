// gate issues show — per-id reader, sibling of `gate show <id>` and
// `agora show <id>`.
//
// Surfaces this test pins:
//   - text format: full body + notes block, no list-row truncation
//   - json format: full toJSON() of the issue
//   - not-found id: helpful stderr + exit 1
//   - unknown sub: closest-match suggestion in the error
//
// Why this exists: `gate issues` had list/add/note/transition subs but
// no per-id reader. Callers wired into muscle memory for `gate show <id>`
// reached for `gate issues show <id>` and bounced with no orientation.

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
  const root = mkdtempSync(join(tmpdir(), 'guild-issues-show-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [human]\n',
  );
  for (const d of ['members', 'requests', 'issues', 'inbox']) {
    mkdirSync(join(root, d));
  }
  writeFileSync(
    join(root, 'members', 'alice.yaml'),
    `name: alice\ncategory: professional\nactive: true\n`,
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

function seedOneIssue(root: string, text: string): string {
  runGate(
    root,
    [
      'issues', 'add',
      '--from', 'alice',
      '--severity', 'med',
      '--area', 'docs',
      '--text', text,
    ],
    { GUILD_ACTOR: 'alice' },
  );
  const today = new Date().toISOString().slice(0, 10);
  return `i-${today}-0001`;
}

test('gate issues show <id> renders the full body and notes in text', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // Use multi-line text so the body block (not just the list row)
  // is observable. A list-row render would truncate or single-line
  // collapse; show should print the body as-is.
  const longText = 'first line\nsecond line\nthird line';
  const id = seedOneIssue(root, longText);
  runGate(
    root,
    ['issues', 'note', id, '--by', 'alice', '--text', 'observed-later'],
    { GUILD_ACTOR: 'alice' },
  );
  const r = runGate(root, ['issues', 'show', id], { GUILD_ACTOR: 'alice' });
  assert.equal(r.status, 0);
  // Header line with severity/area/state matches list-row prefix shape.
  assert.match(r.stdout, /i-.* \[med\/docs\] open from=alice/);
  // Body lines all present, on separate lines (no collapse).
  assert.match(r.stdout, /first line/);
  assert.match(r.stdout, /second line/);
  assert.match(r.stdout, /third line/);
  // Notes block surfaces with the note text.
  assert.match(r.stdout, /notes \(1\):/);
  assert.match(r.stdout, /alice/);
  assert.match(r.stdout, /observed-later/);
});

test('gate issues show <id> --format json returns the full issue toJSON', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const id = seedOneIssue(root, 'first observation');
  runGate(
    root,
    ['issues', 'note', id, '--by', 'alice', '--text', 'second observation'],
    { GUILD_ACTOR: 'alice' },
  );
  const r = runGate(
    root,
    ['issues', 'show', id, '--format', 'json'],
    { GUILD_ACTOR: 'alice' },
  );
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout);
  assert.equal(j.id, id);
  assert.equal(j.severity, 'med');
  assert.equal(j.area, 'docs');
  assert.equal(j.state, 'open');
  assert.equal(j.from, 'alice');
  assert.equal(j.text, 'first observation');
  assert.ok(Array.isArray(j.notes));
  assert.equal(j.notes.length, 1);
  assert.equal(j.notes[0].text, 'second observation');
  // created_at is a runtime field; just ensure it is present and string.
  assert.equal(typeof j.created_at, 'string');
});

test('gate issues show <missing-id> returns a not-found stderr and exit 1', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const today = new Date().toISOString().slice(0, 10);
  const missingId = `i-${today}-9999`;
  const r = runGate(
    root,
    ['issues', 'show', missingId],
    { GUILD_ACTOR: 'alice' },
  );
  assert.notEqual(r.status, 0);
  // notFoundHint shape: mentions the kind (issue) and the missing id.
  assert.match(r.stderr, /issue/);
  assert.match(r.stderr, new RegExp(missingId));
});

test('gate issues show without an id emits a usage error and exit 1', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  const r = runGate(root, ['issues', 'show'], { GUILD_ACTOR: 'alice' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Usage: gate issues show/);
});

test('gate issues <typo> suggests the closest valid sub', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // `sho` is a prefix of `show` — closest-sub should fire.
  const r = runGate(root, ['issues', 'sho'], { GUILD_ACTOR: 'alice' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown issues sub: sho/);
  assert.match(r.stderr, /did you mean 'gate issues show'/);
  // The error also gestures at the full set.
  assert.match(r.stderr, /add \| list \| show \| note/);
});

test('gate issues <noise> falls back to listing valid subs without a wrong suggestion', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  // `xyzzy` shares no meaningful overlap with any sub. The error
  // should list the catalog but NOT fabricate a "did you mean" hint.
  const r = runGate(root, ['issues', 'xyzzy'], { GUILD_ACTOR: 'alice' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown issues sub: xyzzy/);
  assert.doesNotMatch(r.stderr, /did you mean/);
  assert.match(r.stderr, /add \| list \| show \| note/);
});
