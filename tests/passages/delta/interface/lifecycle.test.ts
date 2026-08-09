// delta lifecycle — end-to-end through the real binary.
//
// Covers the properties a deposit passage lives or dies by:
//   - depositing needs only --text (the interrupting path stays cheap)
//   - list is OLDEST first (a backlog list must not let the most
//     neglected item scroll away)
//   - deliver is once-only, and the refusal names the first destination
//   - "drained" and "never used" read differently
//   - not-found carries a structured recovery path

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DELTA = resolve(here, '../../../../../bin/delta.mjs');

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'delta-'));
  writeFileSync(join(root, 'guild.config.yaml'), 'content_root: .\nhost_names: [human]\n');
  return root;
}

function run(
  cwd: string,
  args: string[],
  env: Record<string, string> = { GUILD_ACTOR: 'eris' },
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [DELTA, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? -1 };
}

test('add requires only --text, and the record lands under content_root', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const r = run(root, ['add', '--text', 'unfiled conclusion', '--format', 'json']);
  assert.equal(r.status, 0);
  const env = JSON.parse(r.stdout);
  assert.equal(env.ok, true);
  assert.match(env.id, /^delta-\d{4}-\d{2}-\d{2}-001$/);
  assert.equal(env.pending_count, 1);
  assert.match(env.where_written, /delta\/delta-.*\.yaml$/);
  // optional fields stay absent rather than empty
  assert.equal('source' in env, false);
  assert.equal('candidate' in env, false);
});

test('list is oldest-first so the longest-waiting deposit cannot scroll away', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  run(root, ['add', '--text', 'first']);
  run(root, ['add', '--text', 'second']);
  run(root, ['add', '--text', 'third']);

  const env = JSON.parse(run(root, ['list', '--format', 'json']).stdout);
  assert.equal(env.count, 3);
  assert.deepEqual(
    env.deltas.map((d: { text: string }) => d.text),
    ['first', 'second', 'third'],
  );
});

test('deliver flips state once and is refused a second time', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const id = JSON.parse(run(root, ['add', '--text', 'route me', '--format', 'json']).stdout).id;

  const first = run(root, ['deliver', id, '--to', 'cultivate', '--note', 'went to the doc']);
  assert.equal(first.status, 0);
  assert.match(first.stdout, /delivered .* → cultivate/);

  const second = run(root, ['deliver', id, '--to', 'reflect']);
  assert.equal(second.status, 1);
  assert.match(second.stderr, /already delivered to 'cultivate'/);

  // the substrate still records the FIRST destination
  const shown = JSON.parse(run(root, ['show', id, '--format', 'json']).stdout);
  assert.equal(shown.state, 'delivered');
  assert.equal(shown.delivered.to, 'cultivate');
  assert.equal(shown.delivered.note, 'went to the doc');
});

test('--state filters, and delivered records keep their destination queryable', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const a = JSON.parse(run(root, ['add', '--text', 'a', '--format', 'json']).stdout).id;
  run(root, ['add', '--text', 'b']);
  run(root, ['deliver', a, '--to', 'agora']);

  assert.equal(JSON.parse(run(root, ['list', '--format', 'json']).stdout).count, 1);
  assert.equal(
    JSON.parse(run(root, ['list', '--state', 'delivered', '--format', 'json']).stdout).count,
    1,
  );
  assert.equal(JSON.parse(run(root, ['list', '--state', 'all', '--format', 'json']).stdout).count, 2);
  assert.equal(
    JSON.parse(run(root, ['list', '--to', 'agora', '--state', 'all', '--format', 'json']).stdout)
      .count,
    1,
  );
  // an invalid state fails loudly rather than silently listing everything
  assert.equal(run(root, ['list', '--state', 'open']).status, 1);
});

test('drained and never-used read differently', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.match(run(root, ['list']).stdout, /no delta deposits yet/);

  const id = JSON.parse(run(root, ['add', '--text', 'only one', '--format', 'json']).stdout).id;
  run(root, ['deliver', id, '--to', 'ctx']);

  const drained = run(root, ['list']).stdout;
  assert.match(drained, /nothing outstanding/);
  assert.doesNotMatch(drained, /no delta deposits yet/);
});

test('an absent id yields a not-found with a structured recovery path', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const r = run(root, ['show', 'delta-2026-08-09-099', '--format', 'json']);
  assert.equal(r.status, 1);
  const line = r.stderr.split('\n').find((l) => l.trim().startsWith('{'));
  assert.ok(line, 'json mode must emit a structured envelope on stderr');
  const env = JSON.parse(line);
  assert.equal(env.error.code, 'not_found');
  assert.equal(env.error.recovery.verb, 'list');
});

test('an unknown verb suggests the nearest one instead of dumping help', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const r = run(root, ['delivr']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown verb: delivr/);
  assert.match(r.stderr, /did you mean: delta deliver\?/);
});
