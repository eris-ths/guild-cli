import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVersionFlag, getPackageVersion } from '../../src/interface/shared/version.js';

test('isVersionFlag matches --version as first arg', () => {
  assert.equal(isVersionFlag(['--version']), true);
  assert.equal(isVersionFlag(['--version', 'list']), true);
});

test('isVersionFlag matches -v as first arg', () => {
  assert.equal(isVersionFlag(['-v']), true);
});

test('isVersionFlag rejects --version in non-first position', () => {
  // future verbs should not silently trigger version output when passing
  // `--version` as a verb option
  assert.equal(isVersionFlag(['list', '--version']), false);
});

test('isVersionFlag rejects empty argv', () => {
  assert.equal(isVersionFlag([]), false);
});

test('isVersionFlag rejects unrelated first arg', () => {
  assert.equal(isVersionFlag(['list']), false);
  assert.equal(isVersionFlag(['--help']), false);
});

test('getPackageVersion returns semver-looking string', () => {
  const v = getPackageVersion();
  assert.match(v, /^\d+\.\d+\.\d+/, `expected semver, got "${v}"`);
});
