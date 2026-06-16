// OkfFrontmatter — serialize/parse the `---\n<yaml>\n---\n<body>` envelope.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeOkfDocument,
  parseOkfDocument,
} from '../../src/infrastructure/okf/OkfFrontmatter.js';
import { OkfDocument } from '../../src/domain/okf/OkfDocument.js';

const noop = (): void => {};

test('serialize emits canonical field order (standard first, extras sorted)', () => {
  const doc: OkfDocument = {
    path: 'x.md',
    // deliberately scrambled in-memory order
    frontmatter: { author: 'eris', id: 'ctx-1', type: 'Fact', timestamp: '2026-01-01T00:00:00.000Z' },
    body: 'a fact',
  };
  const text = serializeOkfDocument(doc);
  const order = [...text.matchAll(/^(\w+):/gm)].map((m) => m[1]);
  // type (standard) before timestamp (standard) before extras author,id (sorted)
  assert.deepEqual(order, ['type', 'timestamp', 'author', 'id']);
  assert.match(text, /\n---\n\na fact\n$/);
});

test('serialize then parse round-trips frontmatter and body', () => {
  const doc: OkfDocument = {
    path: 'x.md',
    frontmatter: { type: 'Fact', id: 'ctx-1', timestamp: '2026-01-01T00:00:00.000Z', tags: ['tech:ts'] },
    body: 'the body',
  };
  const parsed = parseOkfDocument('x.md', serializeOkfDocument(doc), 'x.md', noop);
  assert.equal(parsed.frontmatter.type, 'Fact');
  assert.equal(parsed.frontmatter.id, 'ctx-1');
  assert.equal(parsed.frontmatter.timestamp, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(parsed.frontmatter.tags, ['tech:ts']);
  assert.equal(parsed.body, 'the body');
});

test('parse tolerates a document with no frontmatter (whole text is body)', () => {
  const parsed = parseOkfDocument('p.md', 'just prose, no frontmatter', 'p.md', noop);
  assert.equal(parsed.frontmatter.type, '');
  assert.equal(parsed.body, 'just prose, no frontmatter');
});

test('parse reports malformed frontmatter via onMalformed and coerces type to empty', () => {
  let reported = '';
  const text = '---\n: : bad yaml :\n---\nbody';
  const parsed = parseOkfDocument('bad.md', text, 'bad.md', (_s, m) => {
    reported = m;
  });
  assert.match(reported, /yaml parse failed/);
  assert.equal(parsed.frontmatter.type, '');
});
