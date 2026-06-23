// ctx supersede (phase-2 verb #1) — end-to-end through the real binary.
//
// supersede corrects an older fact by recording a *new* fact whose
// `supersedes` points back at it; the old record is never mutated
// (immutable substrate). Covers:
//   - supersede records a new fact carrying the forward link
//   - the superseded fact is folded out of `list` by default
//   - `list --all` keeps both, marking the predecessor
//   - `show <old-id>` resolves the reverse `superseded_by` link
//   - missing target -> recoverable not-found (text + json envelope)
//   - malformed old-id -> domain validation error
//   - byte-stable YAML: ordinary record omits `supersedes`, correction has it

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CTX = resolve(here, '../../../../../bin/ctx.mjs');

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'ctx-supersede-'));
  writeFileSync(join(root, 'guild.config.yaml'), 'content_root: .\nhost_names: [human]\n');
  return root;
}

function runCtx(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [CTX, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? -1 };
}

/** Record a fact and return its allocated id (read back via list --format json). */
function recordFact(root: string, fact: string, tags?: string): string {
  const args = ['record', '--fact', fact];
  if (tags !== undefined) args.push('--tag', tags);
  runCtx(root, args, { GUILD_ACTOR: 'eris' });
  const env = JSON.parse(runCtx(root, ['list', '--all', '--format', 'json']).stdout);
  return env.facts[0].id; // newest first
}

test('ctx supersede records a new fact with a forward link to the old', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const oldId = recordFact(root, 'tebot deploy uses node 18', 'tech:node');

  const r = runCtx(root, ['supersede', oldId, '--fact', 'tebot deploy uses node 20', '--format', 'json'], {
    GUILD_ACTOR: 'eris',
  });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.supersedes, oldId);
  assert.notEqual(out.id, oldId); // a *new* fact, not an edit
});

test('the superseded fact is folded out of list by default, kept under --all', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const oldId = recordFact(root, 'old fact', 'topic:x');
  runCtx(root, ['supersede', oldId, '--fact', 'new fact', '--tag', 'topic:x'], { GUILD_ACTOR: 'eris' });

  const def = JSON.parse(runCtx(root, ['list', '--format', 'json']).stdout);
  assert.equal(def.count, 1, 'default list shows only the surviving head');
  assert.equal(def.facts[0].fact, 'new fact');

  const all = JSON.parse(runCtx(root, ['list', '--all', '--format', 'json']).stdout);
  assert.equal(all.count, 2, '--all keeps the superseded predecessor');
  const ids = all.facts.map((f: { id: string }) => f.id);
  assert.ok(ids.includes(oldId));
});

test('list --all marks the superseded predecessor (text)', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const oldId = recordFact(root, 'old fact');
  runCtx(root, ['supersede', oldId, '--fact', 'new fact'], { GUILD_ACTOR: 'eris' });

  const r = runCtx(root, ['list', '--all']);
  assert.match(r.stdout, /⊘ superseded/);
  assert.match(r.stdout, /↳ supersedes/);
});

test('show <old-id> resolves the reverse superseded_by link', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const oldId = recordFact(root, 'old fact');
  const sup = JSON.parse(
    runCtx(root, ['supersede', oldId, '--fact', 'new fact', '--format', 'json'], { GUILD_ACTOR: 'eris' }).stdout,
  );

  const r = JSON.parse(runCtx(root, ['show', oldId, '--format', 'json']).stdout);
  assert.equal(r.ok, true);
  assert.equal(r.superseded_by, sup.id);

  // a current (un-superseded) fact reports null
  const cur = JSON.parse(runCtx(root, ['show', sup.id, '--format', 'json']).stdout);
  assert.equal(cur.superseded_by, null);
});

test('supersede a missing target is a recoverable not-found', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const r = runCtx(root, ['supersede', 'ctx-2020-01-01-001', '--fact', 'x', '--format', 'json'], {
    GUILD_ACTOR: 'eris',
  });
  assert.equal(r.status, 1);
  const env = JSON.parse(r.stderr.split('\n')[0]!);
  assert.equal(env.ok, false);
  assert.equal(env.error.code, 'not_found');
  assert.equal(env.error.recovery.verb, 'list');
});

test('supersede with a malformed old-id is a domain validation error', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const r = runCtx(root, ['supersede', 'not-an-id', '--fact', 'x'], { GUILD_ACTOR: 'eris' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ctx id must match/);
});

test('an empty store still prompts to record (supersede did not change this)', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // Regression guard: folding superseded facts out of the default view must
  // not turn the genuinely-empty message into the "all superseded" one.
  assert.match(runCtx(root, ['list']).stdout, /no ctx facts recorded yet/);
  assert.match(runCtx(root, ['list', '--all']).stdout, /no ctx facts recorded yet/);
});

test('byte-stable YAML: ordinary record omits supersedes, correction carries it', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const oldId = recordFact(root, 'old fact');
  const oldYaml = readFileSync(join(root, 'ctx', `${oldId}.yaml`), 'utf8');
  assert.ok(!/supersedes:/.test(oldYaml), 'an ordinary record must not write a supersedes key');

  const sup = JSON.parse(
    runCtx(root, ['supersede', oldId, '--fact', 'new fact', '--format', 'json'], { GUILD_ACTOR: 'eris' }).stdout,
  );
  const newYaml = readFileSync(join(root, 'ctx', `${sup.id}.yaml`), 'utf8');
  assert.match(newYaml, new RegExp(`supersedes: ${oldId}`));
});
