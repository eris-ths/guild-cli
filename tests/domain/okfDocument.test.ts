// OkfDocument — pure domain helpers (slugify / reserved / conformance).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isReservedOkfFilename,
  assertOkfConformant,
  slugifyForTagValue,
  OKF_VERSION,
  OkfDocument,
} from '../../src/domain/okf/OkfDocument.js';
import { DomainError } from '../../src/domain/shared/DomainError.js';

test('OKF_VERSION is the targeted spec revision', () => {
  assert.equal(OKF_VERSION, '0.1');
});

test('reserved filenames are index.md and log.md only', () => {
  assert.equal(isReservedOkfFilename('index.md'), true);
  assert.equal(isReservedOkfFilename('log.md'), true);
  assert.equal(isReservedOkfFilename('ctx-2026-06-16-001.md'), false);
  assert.equal(isReservedOkfFilename('INDEX.md'), false); // case-sensitive
});

test('assertOkfConformant requires a non-empty type', () => {
  const ok: OkfDocument = { path: 'a.md', frontmatter: { type: 'Fact' }, body: 'x' };
  assert.doesNotThrow(() => assertOkfConformant(ok));

  const noType: OkfDocument = { path: 'a.md', frontmatter: { type: '' }, body: 'x' };
  assert.throws(() => assertOkfConformant(noType), DomainError);

  const blankType: OkfDocument = { path: 'a.md', frontmatter: { type: '   ' }, body: 'x' };
  assert.throws(() => assertOkfConformant(blankType), DomainError);
});

test('slugifyForTagValue lowercases, hyphenates, and bounds to 48 chars', () => {
  assert.equal(slugifyForTagValue('BigQuery Table'), 'bigquery-table');
  assert.equal(slugifyForTagValue('  Data Team  '), 'data-team');
  assert.equal(slugifyForTagValue('already-slug'), 'already-slug');
  // all-symbol input yields nothing usable
  assert.equal(slugifyForTagValue('***'), null);
  // length bound (48) with no trailing hyphen
  const long = slugifyForTagValue('a'.repeat(60));
  assert.ok(long !== null && long.length <= 48);
  assert.ok(!long.endsWith('-'));
});
