// devil-review — Bundled lense / persona catalog adapter tests.
//
// Pin the v0 catalog adapter contract: list returns the canonical
// order from issue #126, find returns the right entries, names
// matches the underlying defaults. Implementation-thin tests, but
// they protect the verb layer (which talks to the catalog interface,
// not the bundled defaults directly) from drift if a future commit
// reorders or filters entries inside the adapter.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BundledLenseCatalog } from '../../../src/passages/devil/infrastructure/BundledLenseCatalog.js';
import { BundledPersonaCatalog } from '../../../src/passages/devil/infrastructure/BundledPersonaCatalog.js';
import { DEFAULT_LENSE_NAMES } from '../../../src/passages/devil/domain/defaultLenses.js';
import { DEFAULT_PERSONA_NAMES } from '../../../src/passages/devil/domain/defaultPersonas.js';

test('BundledLenseCatalog.list returns the 11 defaults in canonical order', () => {
  const c = new BundledLenseCatalog();
  const list = c.list();
  assert.equal(list.length, 11);
  assert.deepEqual(
    list.map((l) => l.name),
    [...DEFAULT_LENSE_NAMES],
  );
});

test('BundledLenseCatalog.find returns the lense or null', () => {
  const c = new BundledLenseCatalog();
  const inj = c.find('injection');
  assert.ok(inj);
  assert.equal(inj.name, 'injection');
  assert.equal(c.find('does-not-exist'), null);
});

test('BundledLenseCatalog.find on supply-chain returns the SCG-delegated lense', () => {
  const c = new BundledLenseCatalog();
  const sc = c.find('supply-chain');
  assert.ok(sc);
  assert.equal(sc.delegate, 'scg');
});

test('BundledLenseCatalog.names matches DEFAULT_LENSE_NAMES', () => {
  const c = new BundledLenseCatalog();
  assert.deepEqual([...c.names()], [...DEFAULT_LENSE_NAMES]);
});

test('BundledPersonaCatalog.list returns the 3 hand-rolled defaults in canonical order', () => {
  const c = new BundledPersonaCatalog();
  const list = c.list();
  assert.equal(list.length, 3);
  assert.deepEqual(
    list.map((p) => p.name),
    [...DEFAULT_PERSONA_NAMES],
  );
});

test('BundledPersonaCatalog.find returns the persona or null', () => {
  const c = new BundledPersonaCatalog();
  const rt = c.find('red-team');
  assert.ok(rt);
  assert.equal(rt.name, 'red-team');
  assert.equal(c.find('ultrareview-fleet'), null); // ingest-only personas not in v0 catalog
});

test('every BundledPersonaCatalog default has ingest_only=false', () => {
  const c = new BundledPersonaCatalog();
  for (const p of c.list()) {
    assert.equal(p.ingest_only, false, `${p.name}: hand-rolled defaults are not ingest-only`);
  }
});
