// OkfCtxMapper — pure ctx Fact <-> OKF document mapping.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ctx } from '../../../src/passages/ctx/domain/Ctx.js';
import {
  ctxToOkfDocument,
  okfDocumentToCtxFact,
} from '../../../src/passages/ctx/application/OkfCtxMapper.js';
import { OkfDocument } from '../../../src/domain/okf/OkfDocument.js';

function fact(overrides: Partial<{ id: string; fact: string; by: string; tags: string[] }> = {}): Ctx {
  return Ctx.create({
    id: overrides.id ?? 'ctx-2026-06-16-001',
    fact: overrides.fact ?? 'a recorded fact',
    created_by: overrides.by ?? 'claude',
    tags: overrides.tags ?? ['tech:typescript'],
    now: () => new Date('2026-06-16T00:00:00.000Z'),
  });
}

test('ctxToOkfDocument carries id, timestamp, author, tags into frontmatter', () => {
  const doc = ctxToOkfDocument(fact());
  assert.equal(doc.path, 'ctx-2026-06-16-001.md');
  assert.equal(doc.frontmatter.type, 'Fact');
  assert.equal(doc.frontmatter.id, 'ctx-2026-06-16-001');
  assert.equal(doc.frontmatter.timestamp, '2026-06-16T00:00:00.000Z');
  assert.equal(doc.frontmatter.author, 'claude');
  assert.deepEqual(doc.frontmatter.tags, ['tech:typescript']);
  assert.equal(doc.body, 'a recorded fact');
});

test('a fact with no tags omits the frontmatter tags field', () => {
  const doc = ctxToOkfDocument(fact({ tags: [] }));
  assert.equal('tags' in doc.frontmatter, false);
});

test('ctx -> okf -> ctx-input round-trips losslessly for a guild fact', () => {
  const doc = ctxToOkfDocument(fact());
  const m = okfDocumentToCtxFact(doc);
  assert.equal(m.kind, 'fact');
  if (m.kind !== 'fact') return;
  assert.equal(m.id, 'ctx-2026-06-16-001');
  assert.equal(m.created_at, '2026-06-16T00:00:00.000Z');
  assert.equal(m.created_by, 'claude');
  assert.equal(m.fact, 'a recorded fact');
  assert.deepEqual(m.tags, ['tech:typescript']);
});

test('import coerces foreign tags and preserves non-Fact type as provenance', () => {
  const doc: OkfDocument = {
    path: 'tables/orders.md',
    frontmatter: {
      type: 'BigQuery Table',
      tags: ['sales', 'Owner: Data Team', 'tech:sql'],
      timestamp: '2025-01-02T10:00:00Z',
    },
    body: 'One row per completed order.',
  };
  const m = okfDocumentToCtxFact(doc);
  assert.equal(m.kind, 'fact');
  if (m.kind !== 'fact') return;
  assert.equal(m.id, undefined); // no guild id -> handler allocates fresh
  assert.equal(m.created_by, undefined); // no author -> handler supplies --by
  assert.deepEqual(m.tags, ['topic:sales', 'owner:data-team', 'tech:sql', 'okf:bigquery-table']);
});

test('a Fact type does not add an okf:fact provenance tag', () => {
  const doc: OkfDocument = {
    path: 'x.md',
    frontmatter: { type: 'Fact', tags: ['status:active'] },
    body: 'b',
  };
  const m = okfDocumentToCtxFact(doc);
  if (m.kind !== 'fact') throw new Error('expected fact');
  assert.deepEqual(m.tags, ['status:active']);
});

test('an empty body is skipped with a reason', () => {
  const doc: OkfDocument = { path: 'empty.md', frontmatter: { type: 'Fact' }, body: '   \n' };
  const m = okfDocumentToCtxFact(doc);
  assert.equal(m.kind, 'skip');
  if (m.kind !== 'skip') return;
  assert.match(m.reason, /empty body/);
});

test('a type-less doc (frontmatter-less) is tagged okf:untyped for audit', () => {
  // parseOkfDocument coerces a frontmatter-less file to type ''.
  const doc: OkfDocument = { path: 'nofm.md', frontmatter: { type: '' }, body: 'plain prose' };
  const m = okfDocumentToCtxFact(doc);
  if (m.kind !== 'fact') throw new Error('expected fact');
  assert.deepEqual(m.tags, ['okf:untyped']);
});

test('a type that slugs to nothing also falls back to okf:untyped', () => {
  const doc: OkfDocument = { path: 'x.md', frontmatter: { type: '***' }, body: 'b' };
  const m = okfDocumentToCtxFact(doc);
  if (m.kind !== 'fact') throw new Error('expected fact');
  assert.deepEqual(m.tags, ['okf:untyped']);
});
