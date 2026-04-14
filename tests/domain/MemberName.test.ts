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
