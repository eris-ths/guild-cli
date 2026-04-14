import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVerdict } from '../../src/domain/shared/Verdict.js';
import { parseLense } from '../../src/domain/shared/Lense.js';
import { DomainError } from '../../src/domain/shared/DomainError.js';

test('parseVerdict accepts valid values', () => {
  assert.equal(parseVerdict('ok'), 'ok');
  assert.equal(parseVerdict('concern'), 'concern');
  assert.equal(parseVerdict('reject'), 'reject');
});

test('parseVerdict rejects unknown', () => {
  assert.throws(() => parseVerdict('approved'), DomainError);
  assert.throws(() => parseVerdict(''), DomainError);
  assert.throws(() => parseVerdict('OK'), DomainError);
});

test('parseLense accepts valid values', () => {
  for (const l of ['devil', 'layer', 'cognitive', 'user']) {
    assert.equal(parseLense(l), l);
  }
});

test('parseLense rejects unknown', () => {
  assert.throws(() => parseLense('security'), DomainError);
});
