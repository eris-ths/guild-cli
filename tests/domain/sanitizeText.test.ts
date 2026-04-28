import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeText } from '../../src/domain/shared/sanitizeText.js';

const defaults = { maxLen: 100 };

// --- type enforcement ---

test('sanitizeText: rejects non-string input', () => {
  assert.throws(() => sanitizeText(42, 'field', defaults), /must be a string/);
  assert.throws(() => sanitizeText(null, 'field', defaults), /must be a string/);
  assert.throws(() => sanitizeText(undefined, 'field', defaults), /must be a string/);
});

// --- control character stripping ---

test('sanitizeText: strips NUL, BEL, BS, VT, FF, SO-US, DEL', () => {
  const dirty = 'a\x00b\x07c\x08d\x0Be\x0Cf\x0Eg\x1Fh\x7Fi';
  assert.equal(sanitizeText(dirty, 'f', defaults), 'abcdefghi');
});

test('sanitizeText: preserves tab, newline, carriage return', () => {
  const input = 'line1\tindented\nline2\r\nline3';
  assert.equal(sanitizeText(input, 'f', defaults), input);
});

// --- trim behavior ---

test('sanitizeText: trims by default', () => {
  assert.equal(sanitizeText('  hello  ', 'f', defaults), 'hello');
});

test('sanitizeText: trim=false preserves leading/trailing whitespace', () => {
  assert.equal(
    sanitizeText('  hello  ', 'f', { ...defaults, trim: false }),
    '  hello  ',
  );
});

// --- requireNonEmpty behavior ---

test('sanitizeText: rejects empty string by default', () => {
  assert.throws(() => sanitizeText('', 'f', defaults), /required/);
});

test('sanitizeText: rejects whitespace-only when trim=true (default)', () => {
  assert.throws(() => sanitizeText('   ', 'f', defaults), /required/);
});

test('sanitizeText: allows empty when requireNonEmpty=false', () => {
  assert.equal(
    sanitizeText('', 'f', { ...defaults, requireNonEmpty: false }),
    '',
  );
});

test('sanitizeText: allows whitespace-only when requireNonEmpty=false + trim=false', () => {
  assert.equal(
    sanitizeText('   ', 'f', { ...defaults, requireNonEmpty: false, trim: false }),
    '   ',
  );
});

// --- length cap ---

test('sanitizeText: accepts string at exactly maxLen', () => {
  const s = 'x'.repeat(100);
  assert.equal(sanitizeText(s, 'f', { maxLen: 100 }), s);
});

test('sanitizeText: rejects string exceeding maxLen', () => {
  assert.throws(
    () => sanitizeText('x'.repeat(101), 'f', { maxLen: 100 }),
    /too long/,
  );
});

test('sanitizeText: length checked after strip + trim', () => {
  const s = '  ' + 'x'.repeat(100) + '\x00\x07  ';
  assert.equal(sanitizeText(s, 'f', { maxLen: 100 }).length, 100);
});

// --- field name in error messages ---

test('sanitizeText: error message includes field name', () => {
  assert.throws(() => sanitizeText(42, 'myField', defaults), /myField/);
  assert.throws(() => sanitizeText('', 'action', defaults), /action/);
});
