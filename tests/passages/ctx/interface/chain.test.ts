// ctx chain (phase-2 verb #2) — end-to-end through the real binary.
//
// chain shows the one-hop neighborhood of a fact: outbound (ctx ids its
// prose mentions), inbound (facts that mention it), and the two
// supersession links. Covers:
//   - supersedes / superseded-by links surface as branches
//   - inbound: a fact whose prose names the root id
//   - outbound: the root's prose naming another ctx id (+ dangling ref)
//   - one-hop only (a two-step reference is not transitively walked)
//   - empty neighborhood message
//   - missing root -> recoverable not-found
//   - malformed id -> domain validation error

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CTX = resolve(here, '../../../../../bin/ctx.mjs');

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'ctx-chain-'));
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

function record(root: string, fact: string): string {
  runCtx(root, ['record', '--fact', fact], { GUILD_ACTOR: 'eris' });
  const env = JSON.parse(runCtx(root, ['list', '--all', '--format', 'json']).stdout);
  return env.facts[0].id; // newest first
}

test('chain surfaces supersession links in both directions', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = record(root, 'base fact');
  const corr = JSON.parse(
    runCtx(root, ['supersede', base, '--fact', 'correction', '--format', 'json'], { GUILD_ACTOR: 'eris' }).stdout,
  );

  const fromBase = JSON.parse(runCtx(root, ['chain', base, '--format', 'json']).stdout);
  assert.equal(fromBase.ok, true);
  assert.equal(fromBase.superseded_by.length, 1);
  assert.equal(fromBase.superseded_by[0].id, corr.id);
  assert.equal(fromBase.supersedes, null);

  const fromCorr = JSON.parse(runCtx(root, ['chain', corr.id, '--format', 'json']).stdout);
  assert.equal(fromCorr.supersedes.id, base);
  assert.equal(fromCorr.superseded_by.length, 0);
});

test('chain inbound: a fact whose prose names the root id', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = record(root, 'the original note');
  const ref = record(root, `followup: see ${base} for context`);

  const r = JSON.parse(runCtx(root, ['chain', base, '--format', 'json']).stdout);
  assert.equal(r.inbound.length, 1);
  assert.equal(r.inbound[0].id, ref);

  // text surface renders the inbound branch
  const txt = runCtx(root, ['chain', base]).stdout;
  assert.match(txt, /referenced by \(inbound\)/);
  assert.match(txt, new RegExp(ref));
});

test('chain outbound: the root prose naming another ctx id, plus a dangling ref', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = record(root, 'target fact');
  // root references both a real id and a plausible-but-absent one
  const rootFact = record(root, `mentions ${target} and ctx-2020-01-01-001 which does not exist`);

  const r = JSON.parse(runCtx(root, ['chain', rootFact, '--format', 'json']).stdout);
  const outIds = r.outbound.map((o: { id: string }) => o.id);
  assert.ok(outIds.includes(target), 'resolved outbound ref present');
  assert.ok(outIds.includes('ctx-2020-01-01-001'), 'dangling outbound ref surfaced, not dropped');
  const dangling = r.outbound.find((o: { id: string }) => o.id === 'ctx-2020-01-01-001');
  assert.equal(dangling.resolved, false);

  // text marks the dangling one
  const txt = runCtx(root, ['chain', rootFact]).stdout;
  assert.match(txt, /referenced but not found/);
});

test('chain is one hop — it does not transitively walk', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const a = record(root, 'fact A');
  const b = record(root, `fact B references ${a}`);
  const c = record(root, `fact C references ${b}`);

  // chain on C surfaces B (one hop), not A (two hops away through B).
  const r = JSON.parse(runCtx(root, ['chain', c, '--format', 'json']).stdout);
  const outIds = r.outbound.map((o: { id: string }) => o.id);
  assert.deepEqual(outIds, [b], 'only the direct reference, not the transitive one');
});

test('chain on an isolated fact reports an empty neighborhood', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const lone = record(root, 'a fact with no links');
  const r = JSON.parse(runCtx(root, ['chain', lone, '--format', 'json']).stdout);
  assert.equal(r.outbound.length, 0);
  assert.equal(r.inbound.length, 0);
  assert.equal(r.supersedes, null);
  assert.equal(r.superseded_by.length, 0);
  assert.match(runCtx(root, ['chain', lone]).stdout, /no chain/);
});

test('chain on a missing root is a recoverable not-found', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const r = runCtx(root, ['chain', 'ctx-2020-01-01-001', '--format', 'json']);
  assert.equal(r.status, 1);
  const env = JSON.parse(r.stderr.split('\n')[0]!);
  assert.equal(env.ok, false);
  assert.equal(env.error.code, 'not_found');
  assert.equal(env.error.recovery.verb, 'list');
});

test('chain with a malformed id is a domain validation error', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const r = runCtx(root, ['chain', 'not-an-id']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ctx id must match/);
});
