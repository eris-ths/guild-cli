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

test('BundledPersonaCatalog.list returns 6 personas (3 hand-rolled + 3 ingest-only) in canonical order', () => {
  const c = new BundledPersonaCatalog();
  const list = c.list();
  assert.equal(list.length, 6);
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
  // Ingest-only personas ARE in the catalog (they need to be, so
  // ingest verbs can attribute to them) — but `devil entry` refuses
  // them via PersonaIsIngestOnly.
  const fleet = c.find('ultrareview-fleet');
  assert.ok(fleet);
  assert.equal(fleet.ingest_only, true);
  assert.equal(c.find('does-not-exist'), null);
});

test('BundledPersonaCatalog: hand-rolled personas have ingest_only=false', () => {
  const c = new BundledPersonaCatalog();
  for (const name of ['red-team', 'author-defender', 'mirror']) {
    const p = c.find(name);
    assert.ok(p);
    assert.equal(p.ingest_only, false, `${name}: hand-rolled must NOT be ingest-only`);
  }
});

test('BundledPersonaCatalog: ingest-only personas have ingest_only=true', () => {
  const c = new BundledPersonaCatalog();
  for (const name of ['ultrareview-fleet', 'claude-security', 'scg-supply-chain-gate']) {
    const p = c.find(name);
    assert.ok(p);
    assert.equal(p.ingest_only, true, `${name}: ingest-only must have ingest_only=true`);
  }
});
