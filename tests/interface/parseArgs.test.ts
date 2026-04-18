import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArgs,
  requireOption,
  optionalOption,
} from '../../src/interface/shared/parseArgs.js';

test('requireOption returns explicit value when present', () => {
  const args = parseArgs(['--from', 'kiri']);
  assert.equal(requireOption(args, 'from', 'usage'), 'kiri');
});

test('requireOption throws when key missing and no env fallback', () => {
  const args = parseArgs([]);
  assert.throws(() => requireOption(args, 'from', 'usage'), /Missing --from/);
});

test('requireOption falls back to env var when option missing', () => {
  const args = parseArgs([]);
  const prev = process.env['GUILD_ACTOR'];
  process.env['GUILD_ACTOR'] = 'noir';
  try {
    assert.equal(
      requireOption(args, 'from', 'usage', 'GUILD_ACTOR'),
      'noir',
    );
  } finally {
    if (prev === undefined) delete process.env['GUILD_ACTOR'];
    else process.env['GUILD_ACTOR'] = prev;
  }
});

test('requireOption: explicit value wins over env fallback', () => {
  const args = parseArgs(['--from', 'kiri']);
  const prev = process.env['GUILD_ACTOR'];
  process.env['GUILD_ACTOR'] = 'noir';
  try {
    assert.equal(
      requireOption(args, 'from', 'usage', 'GUILD_ACTOR'),
      'kiri',
    );
  } finally {
    if (prev === undefined) delete process.env['GUILD_ACTOR'];
    else process.env['GUILD_ACTOR'] = prev;
  }
});

test('requireOption: empty env var is treated as unset', () => {
  const args = parseArgs([]);
  const prev = process.env['GUILD_ACTOR'];
  process.env['GUILD_ACTOR'] = '';
  try {
    assert.throws(
      () => requireOption(args, 'from', 'usage', 'GUILD_ACTOR'),
      /Missing --from/,
    );
  } finally {
    if (prev === undefined) delete process.env['GUILD_ACTOR'];
    else process.env['GUILD_ACTOR'] = prev;
  }
});

test('optionalOption returns undefined when missing and no env fallback', () => {
  const args = parseArgs([]);
  assert.equal(optionalOption(args, 'for'), undefined);
});

test('optionalOption falls back to env var', () => {
  const args = parseArgs([]);
  const prev = process.env['GUILD_ACTOR'];
  process.env['GUILD_ACTOR'] = 'rin';
  try {
    assert.equal(optionalOption(args, 'for', 'GUILD_ACTOR'), 'rin');
  } finally {
    if (prev === undefined) delete process.env['GUILD_ACTOR'];
    else process.env['GUILD_ACTOR'] = prev;
  }
});

test('optionalOption: explicit value wins over env', () => {
  const args = parseArgs(['--for', 'noir']);
  const prev = process.env['GUILD_ACTOR'];
  process.env['GUILD_ACTOR'] = 'rin';
  try {
    assert.equal(optionalOption(args, 'for', 'GUILD_ACTOR'), 'noir');
  } finally {
    if (prev === undefined) delete process.env['GUILD_ACTOR'];
    else process.env['GUILD_ACTOR'] = prev;
  }
});

// ── POSIX `--` end-of-options separator ──
//
// Regression: bare `--text "--reason - foo"` stayed boolean because
// the parser refuses to consume values that start with `--`. The
// escape valves are `--text=<value>` (already worked) and `--`
// (added here). Both need to deliver the same value unchanged.

test('parseArgs: -- separator makes subsequent tokens positional even if they start with --', () => {
  const args = parseArgs(['note', 'i-0001', '--by', 'eris', '--', '--reason', '-', '実装済']);
  assert.deepEqual(args.options, { by: 'eris' });
  assert.deepEqual(args.positional, ['note', 'i-0001', '--reason', '-', '実装済']);
});

test('parseArgs: -- separator consumes itself (not kept as a positional)', () => {
  const args = parseArgs(['foo', '--', 'bar']);
  assert.deepEqual(args.positional, ['foo', 'bar']);
});

test('parseArgs: -- separator with no following tokens is a no-op', () => {
  const args = parseArgs(['foo', '--']);
  assert.deepEqual(args.positional, ['foo']);
  assert.deepEqual(args.options, {});
});

test('parseArgs: --key=value still accepts values starting with --', () => {
  // This form already worked pre-fix (the = branch bypasses the
  // startsWith check). Pinned to prevent regression.
  const args = parseArgs(['--text=--reason - foo']);
  assert.equal(args.options['text'], '--reason - foo');
});

test('parseArgs: bare --key followed by --value still lands as boolean (ambiguous)', () => {
  // This is the documented ambiguity the separator resolves — the
  // parser has no per-flag schema so it cannot tell `--value` apart
  // from a legitimate next flag. `--key true` is the only safe call.
  const args = parseArgs(['--text', '--reason']);
  assert.equal(args.options['text'], true);
  assert.equal(args.options['reason'], true);
});

test('requireOption: boolean-landing emits a hint pointing at the escape valves', () => {
  const args = parseArgs(['--reason', '--another-flag']);
  assert.throws(
    () => requireOption(args, 'reason', 'usage'),
    (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.match(e.message, /Missing --reason value/);
      assert.match(e.message, /--reason=<value>/);
      assert.match(e.message, /"-- <value>"/);
      return true;
    },
  );
});

test('requireOption: plain missing flag does NOT emit the -- hint (stays terse)', () => {
  const args = parseArgs([]);
  try {
    requireOption(args, 'reason', 'usage');
    assert.fail('expected throw');
  } catch (e) {
    assert.ok(e instanceof Error);
    assert.match(e.message, /Missing --reason\./);
    assert.equal(/begin/.test(e.message), false);
  }
});
