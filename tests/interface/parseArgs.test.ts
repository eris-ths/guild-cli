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
