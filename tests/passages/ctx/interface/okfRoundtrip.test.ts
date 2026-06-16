// ctx OKF export/import — end-to-end round-trip through the real binary.
//
// Covers the three guarantees the feature promises:
//   1. guild fact -> export -> import (fresh root) restores the record
//      losslessly (id / created_at / created_by / tags).
//   2. re-importing the same bundle is idempotent (existing ids skip).
//   3. a foreign bundle imports tolerantly (fresh id, --by author,
//      coerced tags, provenance, reserved views skipped, empty skipped).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CTX = resolve(here, '../../../../../bin/ctx.mjs');

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'ctx-okf-'));
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

test('guild facts round-trip losslessly through an OKF bundle', (t) => {
  const src = newRoot();
  const dst = newRoot();
  t.after(() => {
    rmSync(src, { recursive: true, force: true });
    rmSync(dst, { recursive: true, force: true });
  });

  runCtx(src, ['record', '--fact', 'first fact', '--tag', 'tech:typescript,topic:okf'], { GUILD_ACTOR: 'claude' });
  runCtx(src, ['record', '--fact', 'second fact', '--tag', 'status:active'], { GUILD_ACTOR: 'eris' });

  const exp = runCtx(src, ['export', join(src, 'bundle'), '--format', 'json']);
  assert.equal(exp.status, 0);
  const expEnv = JSON.parse(exp.stdout);
  assert.equal(expEnv.count, 2);
  assert.ok(expEnv.written.includes('index.md'));
  assert.ok(expEnv.written.includes('log.md'));

  // Reserved view files exist but carry the right type.
  const idx = readFileSync(join(src, 'bundle', 'index.md'), 'utf8');
  assert.match(idx, /type: Index/);

  const imp = runCtx(dst, ['import', join(src, 'bundle'), '--format', 'json'], { GUILD_ACTOR: 'importer' });
  assert.equal(imp.status, 0);
  const impEnv = JSON.parse(imp.stdout);
  assert.equal(impEnv.imported_count, 2);
  assert.equal(impEnv.skipped_count, 0);

  // Lossless: the restored YAML preserves id, author, tags (not the
  // importing actor, not a fresh id). Ids are allocated with the real
  // `now`, so derive today's date rather than hard-coding it.
  const today = new Date().toISOString().slice(0, 10);
  const restored = readFileSync(join(dst, 'ctx', `ctx-${today}-001.yaml`), 'utf8');
  assert.match(restored, new RegExp(`id: ctx-${today}-001`));
  assert.match(restored, /created_by: claude/);
  assert.match(restored, /tech:typescript/);
  assert.doesNotMatch(restored, /created_by: importer/);

  // Idempotent: re-import skips both.
  const again = runCtx(dst, ['import', join(src, 'bundle'), '--format', 'json'], { GUILD_ACTOR: 'importer' });
  const againEnv = JSON.parse(again.stdout);
  assert.equal(againEnv.imported_count, 0);
  assert.equal(againEnv.skipped_count, 2);
  assert.match(againEnv.skipped[0].reason, /already present/);
});

test('a foreign OKF bundle imports tolerantly', (t) => {
  const root = newRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const bundle = join(root, 'foreign');
  mkdirSync(join(bundle, 'tables'), { recursive: true });
  writeFileSync(join(bundle, 'index.md'), '---\ntype: Index\n---\n# view, skip me\n');
  writeFileSync(
    join(bundle, 'tables', 'orders.md'),
    '---\ntype: BigQuery Table\ntags: [sales, "Owner: Data Team"]\ntimestamp: 2025-01-02T10:00:00Z\n---\nOne row per order.\n',
  );
  writeFileSync(join(bundle, 'plain.md'), 'plain prose, no frontmatter\n');
  writeFileSync(join(bundle, 'empty.md'), '---\ntype: Nothing\n---\n');

  const imp = runCtx(root, ['import', bundle, '--format', 'json'], { GUILD_ACTOR: 'archivist' });
  assert.equal(imp.status, 0);
  const env = JSON.parse(imp.stdout);

  // 2 imported (nested table + plain), 1 skipped (empty), index.md not counted.
  assert.equal(env.imported_count, 2);
  assert.equal(env.skipped_count, 1);
  assert.match(env.skipped[0].reason, /empty body/);

  const files = readdirSync(join(root, 'ctx'));
  const orders = files
    .map((f) => readFileSync(join(root, 'ctx', f), 'utf8'))
    .find((y) => y.includes('One row per order.'));
  assert.ok(orders, 'foreign table fact should be recorded');
  assert.match(orders!, /created_by: archivist/); // --by fallback
  assert.match(orders!, /topic:sales/); // bare tag coerced
  assert.match(orders!, /owner:data-team/); // prefixed tag coerced
  assert.match(orders!, /okf:bigquery-table/); // type provenance
  assert.match(orders!, /created_at: 2025-01-02T10:00:00\.000Z/); // foreign ts preserved
});
