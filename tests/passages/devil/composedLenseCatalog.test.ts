// #134 G — ComposedLenseCatalog tests.
//
// Pin the loader contract: bundled defaults preserved, content_root
// extensions appended with `source: 'extension'`, hard-error on name
// collision, malformed extensions routed via onMalformed (no crash).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BundledLenseCatalog } from '../../../src/passages/devil/infrastructure/BundledLenseCatalog.js';
import { ComposedLenseCatalog } from '../../../src/passages/devil/infrastructure/ComposedLenseCatalog.js';
import { LenseCollision } from '../../../src/passages/devil/domain/Lense.js';

function bootstrap(): { root: string; cleanup: () => void; reports: Array<{ src: string; msg: string }> } {
  const root = mkdtempSync(join(tmpdir(), 'composed-lenses-'));
  const reports: Array<{ src: string; msg: string }> = [];
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    reports,
  };
}

function writeExt(root: string, name: string, body: string): void {
  const dir = join(root, 'devil', 'lenses');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.yaml`), body);
}

test('ComposedLenseCatalog.load with no extensions = bundled passthrough', (t) => {
  const { root, cleanup, reports } = bootstrap();
  t.after(cleanup);
  const bundled = new BundledLenseCatalog();
  const c = ComposedLenseCatalog.load(bundled, root, (s, m) => reports.push({ src: s, msg: m }));
  assert.deepEqual(c.names(), bundled.names());
  assert.equal(reports.length, 0);
  // bundled lenses retain source = 'bundled'.
  for (const l of c.list()) assert.equal(l.source, 'bundled');
});

test('ComposedLenseCatalog.load picks up *.yaml extensions and tags source=extension', (t) => {
  const { root, cleanup, reports } = bootstrap();
  t.after(cleanup);
  writeExt(
    root,
    'team-perf',
    [
      'name: team-perf',
      'title: Team Performance',
      'description: hot path budgets and N+1 detection.',
      'examples:',
      '  - "request handler exceeds 200ms p95"',
      '',
    ].join('\n'),
  );
  const bundled = new BundledLenseCatalog();
  const c = ComposedLenseCatalog.load(bundled, root, (s, m) => reports.push({ src: s, msg: m }));
  const found = c.find('team-perf');
  assert.ok(found, 'extension should be loaded');
  assert.equal(found.source, 'extension');
  assert.equal(found.title, 'Team Performance');
  // bundled order preserved; extension appended.
  assert.deepEqual(c.names().slice(0, bundled.names().length), bundled.names());
  assert.equal(c.names()[c.names().length - 1], 'team-perf');
  assert.equal(reports.length, 0);
});

test('ComposedLenseCatalog.load throws LenseCollision when extension shadows a bundled name', (t) => {
  const { root, cleanup, reports } = bootstrap();
  t.after(cleanup);
  writeExt(
    root,
    'injection',
    [
      'name: injection',
      'title: Custom Injection',
      'description: should be rejected — bundled already owns this name.',
      '',
    ].join('\n'),
  );
  const bundled = new BundledLenseCatalog();
  assert.throws(
    () =>
      ComposedLenseCatalog.load(bundled, root, (s, m) =>
        reports.push({ src: s, msg: m }),
      ),
    (err: unknown) => {
      assert.ok(err instanceof LenseCollision);
      assert.equal((err as LenseCollision).bundledName, 'injection');
      return true;
    },
  );
});

test('ComposedLenseCatalog.load: malformed YAML routes via onMalformed and skips the file', (t) => {
  const { root, cleanup, reports } = bootstrap();
  t.after(cleanup);
  writeExt(root, 'broken', '::: not yaml :::\n  - [unbalanced');
  const bundled = new BundledLenseCatalog();
  const c = ComposedLenseCatalog.load(bundled, root, (s, m) =>
    reports.push({ src: s, msg: m }),
  );
  assert.deepEqual(c.names(), bundled.names(), 'broken file must not pollute the catalog');
  assert.equal(reports.length, 1);
  assert.match(reports[0]!.msg, /yaml parse failed/);
});

test('ComposedLenseCatalog.load: schema-invalid extension routes via onMalformed', (t) => {
  const { root, cleanup, reports } = bootstrap();
  t.after(cleanup);
  // Missing required `description` field — Lense.create rejects.
  writeExt(root, 'noop', 'name: noop\ntitle: NoOp\n');
  const bundled = new BundledLenseCatalog();
  const c = ComposedLenseCatalog.load(bundled, root, (s, m) =>
    reports.push({ src: s, msg: m }),
  );
  assert.equal(c.find('noop'), null, 'invalid extension must drop out');
  assert.equal(reports.length, 1);
  assert.match(reports[0]!.msg, /lense schema failed/);
});

test('ComposedLenseCatalog.load: missing devil/lenses directory is silent (no extensions)', (t) => {
  const { root, cleanup, reports } = bootstrap();
  t.after(cleanup);
  const bundled = new BundledLenseCatalog();
  const c = ComposedLenseCatalog.load(bundled, root, (s, m) =>
    reports.push({ src: s, msg: m }),
  );
  assert.deepEqual(c.names(), bundled.names());
  assert.equal(reports.length, 0);
});
