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

test('parseLense accepts domain-specific lense when config lists it', () => {
  const allowed = ['devil', 'layer', 'cognitive', 'user', 'security', 'perf'];
  assert.equal(parseLense('security', allowed), 'security');
  assert.equal(parseLense('perf', allowed), 'perf');
  assert.equal(parseLense('user', allowed), 'user');
});

test('parseLense error message points users at guild.config.yaml', () => {
  // The hint is the onboarding signal: surfacing the extension path
  // in the error itself means a first-time user doesn't have to
  // grep the source to learn domain lenses are possible.
  try {
    parseLense('security');
    assert.fail('expected throw');
  } catch (err) {
    assert.ok(err instanceof DomainError);
    assert.match(err.message, /guild\.config\.yaml/);
    assert.match(err.message, /lenses:/);
  }
});
