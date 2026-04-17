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

test('parseVerdict accepts common aliases (grammatical + muscle memory)', () => {
  // ok family
  assert.equal(parseVerdict('approve'), 'ok');
  assert.equal(parseVerdict('approved'), 'ok');
  assert.equal(parseVerdict('pass'), 'ok');
  assert.equal(parseVerdict('lgtm'), 'ok');
  assert.equal(parseVerdict('yes'), 'ok');
  // concern family (the adjective is the natural reach)
  assert.equal(parseVerdict('concerned'), 'concern');
  assert.equal(parseVerdict('concerning'), 'concern');
  assert.equal(parseVerdict('worried'), 'concern');
  assert.equal(parseVerdict('warn'), 'concern');
  // reject family
  assert.equal(parseVerdict('rejected'), 'reject');
  assert.equal(parseVerdict('block'), 'reject');
  assert.equal(parseVerdict('veto'), 'reject');
});

test('parseVerdict is case-insensitive and trims whitespace', () => {
  assert.equal(parseVerdict('OK'), 'ok');
  assert.equal(parseVerdict('  Concerned  '), 'concern');
  assert.equal(parseVerdict('LGTM'), 'ok');
});

test('parseVerdict rejects truly unknown values with an informative error', () => {
  assert.throws(() => parseVerdict('maybe'), DomainError);
  assert.throws(() => parseVerdict(''), DomainError);
  try {
    parseVerdict('maybe');
    assert.fail('expected throw');
  } catch (err) {
    assert.ok(err instanceof DomainError);
    assert.match(err.message, /ok, concern, reject/);
    // `s` flag so the dot matches across the newline-separated alias table
    assert.match(err.message, /concerned.*concern/s);
  }
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
