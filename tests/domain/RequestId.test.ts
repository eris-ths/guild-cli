import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RequestId } from '../../src/domain/request/RequestId.js';
import { DomainError } from '../../src/domain/shared/DomainError.js';
import { d } from './_requestHelpers.js';

test('RequestId generate produces 4-digit format', () => {
  const id = RequestId.generate(d, 42);
  assert.equal(id.value, '2026-04-14-0042');
});

test('RequestId generate zero-pads small sequences', () => {
  const id = RequestId.generate(d, 1);
  assert.equal(id.value, '2026-04-14-0001');
});

test('RequestId generate accepts up to 9999', () => {
  const id = RequestId.generate(d, 9999);
  assert.equal(id.value, '2026-04-14-9999');
  assert.throws(() => RequestId.generate(d, 10000), DomainError);
});

test('RequestId of validates pattern', () => {
  assert.throws(() => RequestId.of('2026-4-14-001'), DomainError);
  assert.throws(() => RequestId.of('bad'), DomainError);
  // Legacy 3-digit still accepted for backward compatibility.
  assert.doesNotThrow(() => RequestId.of('2026-04-14-001'));
  // New 4-digit form.
  assert.doesNotThrow(() => RequestId.of('2026-04-14-0001'));
  // 2 digits rejected.
  assert.throws(() => RequestId.of('2026-04-14-01'), DomainError);
  // 5 digits rejected.
  assert.throws(() => RequestId.of('2026-04-14-00001'), DomainError);
});
