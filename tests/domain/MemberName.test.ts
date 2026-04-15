import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemberName } from '../../src/domain/member/MemberName.js';
import { DomainError } from '../../src/domain/shared/DomainError.js';

test('MemberName accepts valid lowercase alphanumeric', () => {
  assert.equal(MemberName.of('alice').value, 'alice');
  assert.equal(MemberName.of('bob_1').value, 'bob_1');
  assert.equal(MemberName.of('x-y-z').value, 'x-y-z');
});

test('MemberName lowercases input', () => {
  assert.equal(MemberName.of('Alice').value, 'alice');
});

test('MemberName rejects path traversal', () => {
  assert.throws(() => MemberName.of('../etc'), DomainError);
  assert.throws(() => MemberName.of('a/b'), DomainError);
  assert.throws(() => MemberName.of('a\\b'), DomainError);
});

test('MemberName rejects shell metachars', () => {
  assert.throws(() => MemberName.of('a;b'), DomainError);
  assert.throws(() => MemberName.of('a|b'), DomainError);
  assert.throws(() => MemberName.of('a$b'), DomainError);
  assert.throws(() => MemberName.of('a b'), DomainError);
});

test('MemberName rejects leading digit', () => {
  assert.throws(() => MemberName.of('1alice'), DomainError);
});

test('MemberName rejects reserved names', () => {
  assert.throws(() => MemberName.of('system'), DomainError);
  assert.throws(() => MemberName.of('__proto__'), DomainError);
  assert.throws(() => MemberName.of('constructor'), DomainError);
});

test('MemberName rejects empty', () => {
  assert.throws(() => MemberName.of(''), DomainError);
  assert.throws(() => MemberName.of('   '), DomainError);
});

test('MemberName rejects non-string', () => {
  assert.throws(() => MemberName.of(null), DomainError);
  assert.throws(() => MemberName.of(123), DomainError);
});

test('MemberName rejects over 32 chars', () => {
  assert.throws(() => MemberName.of('a'.repeat(33)), DomainError);
  assert.doesNotThrow(() => MemberName.of('a'.repeat(32)));
});

test('MemberName rejects non-ASCII (ASCII-only invariant per POLICY.md)', () => {
  // This test pins the ASCII-only contract declared in POLICY.md under
  // "Value-object invariants (stable)". The regex ^[a-z][a-z0-9_-]{0,31}$
  // refuses every non-ASCII identifier form. Widening the regex to
  // accept Unicode letter classes is a BREAKING change — it forces a
  // Unicode-normalization audit of every read-side verb that currently
  // does case-insensitive matching via .toLowerCase() at the interface
  // layer (voices, tail, whoami, chain). If you're updating the regex
  // and this test fails, re-read POLICY.md § domain/ value-object
  // invariants before proceeding.
  //
  // Test inputs cover the failure modes a future i18n-minded maintainer
  // would try first:
  const cases = [
    'café',       // Latin-1 supplement (NFC pre-composed)
    'caf\u00e9', // same, written as escape — pins NFC rejection
    'café',      // NFD decomposed (e + combining acute U+0301)
    '日本語',     // CJK ideographs
    'עברית',    // RTL Hebrew
    'α',          // single Greek letter (shortest possible non-ASCII)
    'Ⅸ',          // Roman numeral 9 (Unicode letter-like)
    'a\u200b',   // Latin + zero-width space (invisible sneak)
  ];
  for (const input of cases) {
    assert.throws(
      () => MemberName.of(input),
      DomainError,
      `expected MemberName.of(${JSON.stringify(input)}) to reject non-ASCII`,
    );
  }
});
