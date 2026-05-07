// RequestDepth — reviewer-depth advisory enum (issue #221).
//
// Pins:
//   - the three accepted values (shallow / standard / deep)
//   - parser throws DomainError on anything else, with field='depth'
//     so JSON envelope consumers can branch on the structured field
//   - isRequestDepth narrows TypeScript correctly + accepts only
//     strings (a numeric or null value is not a depth even if it
//     happens to round-trip).
//
// The behavioural side of the contract — "the reviewer agent
// adapts its review strategy when it sees a depth value" — lives
// outside the substrate (operator/agent setup). This test is for
// the substrate slot only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRequestDepth,
  parseRequestDepth,
} from '../../src/domain/request/RequestDepth.js';
import { DomainError } from '../../src/domain/shared/DomainError.js';

test('parseRequestDepth accepts the three documented values', () => {
  assert.equal(parseRequestDepth('shallow'), 'shallow');
  assert.equal(parseRequestDepth('standard'), 'standard');
  assert.equal(parseRequestDepth('deep'), 'deep');
});

test('parseRequestDepth rejects unknown strings with DomainError(field="depth")', () => {
  try {
    parseRequestDepth('bogus');
    assert.fail('expected DomainError');
  } catch (e) {
    assert.ok(e instanceof DomainError);
    assert.equal((e as DomainError).field, 'depth');
    assert.match(
      (e as DomainError).message,
      /depth must be one of shallow, standard, deep/,
    );
  }
});

test('parseRequestDepth rejects non-string inputs (number / null / undefined)', () => {
  for (const bad of [0, 1, null, undefined, true, {}, []]) {
    assert.throws(() => parseRequestDepth(bad), DomainError);
  }
});

test('isRequestDepth: narrows correctly for valid + invalid values', () => {
  assert.equal(isRequestDepth('shallow'), true);
  assert.equal(isRequestDepth('standard'), true);
  assert.equal(isRequestDepth('deep'), true);
  assert.equal(isRequestDepth('bogus'), false);
  assert.equal(isRequestDepth(''), false);
  assert.equal(isRequestDepth(0), false);
  assert.equal(isRequestDepth(null), false);
  assert.equal(isRequestDepth(undefined), false);
});
