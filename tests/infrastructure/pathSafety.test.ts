import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { makeIsUnderBase } from '../../src/infrastructure/persistence/pathSafety.js';

// Two platform-specific checkers bound via the factory. Running both
// from a Linux host is the whole point of the factory split — we'd
// otherwise need a Windows runner to verify the win32 semantics, and
// the bug we're fixing (startsWith(absBase + '/')) was invisible on
// Linux for exactly that reason.
const isUnderBasePosix = makeIsUnderBase(path.posix);
const isUnderBaseWin32 = makeIsUnderBase(path.win32);

// --- POSIX branch ------------------------------------------------------

test('posix: identical path is under itself', () => {
  assert.equal(isUnderBasePosix('/home/user/content', '/home/user/content'), true);
});

test('posix: direct child is under base', () => {
  assert.equal(
    isUnderBasePosix('/home/user/content/members/alice.yaml', '/home/user/content'),
    true,
  );
});

test('posix: deep child is under base', () => {
  assert.equal(
    isUnderBasePosix(
      '/home/user/content/requests/pending/2026-04-15-0001.yaml',
      '/home/user/content',
    ),
    true,
  );
});

test('posix: sibling directory is NOT under base', () => {
  assert.equal(
    isUnderBasePosix('/home/user/other/x.yaml', '/home/user/content'),
    false,
  );
});

test('posix: parent escape via .. is NOT under base', () => {
  // Note: inputs to isUnderBase are expected to be already-resolved
  // absolute paths. The `..` here is a canonical resolved result
  // (e.g. `path.resolve('/home/user/content', '../other')`) which
  // path.relative would emit as `../other`.
  assert.equal(
    isUnderBasePosix('/home/user', '/home/user/content'),
    false,
  );
});

test('posix: path that LOOKS like base but isn\'t (prefix false positive)', () => {
  // `/home/user/content-other` starts with `/home/user/content` as a
  // string prefix but is NOT under it. The old literal-'/' check
  // would also catch this (because `content-other` wouldn't begin
  // with `content/`), but path.relative handles it structurally.
  assert.equal(
    isUnderBasePosix('/home/user/content-other/x.yaml', '/home/user/content'),
    false,
  );
});

test('posix: hidden segment starting with .. (but not traversal)', () => {
  // `..hidden` is a legitimate filename that happens to start with
  // two dots. It must not be confused with a `..` parent-traversal.
  assert.equal(
    isUnderBasePosix('/home/user/content/..hidden', '/home/user/content'),
    true,
  );
});

// --- Windows (win32) branch --------------------------------------------
//
// The big one. Before the fix, `startsWith(absBase + '/')` never
// matched a backslash-separated Windows subpath and every Windows
// invocation threw DomainError before any verb could run. The
// tests below lock the fix in.

test('win32: identical path is under itself', () => {
  assert.equal(
    isUnderBaseWin32('C:\\Users\\foo\\content', 'C:\\Users\\foo\\content'),
    true,
  );
});

test('win32: direct child is under base (backslash separator)', () => {
  assert.equal(
    isUnderBaseWin32(
      'C:\\Users\\foo\\content\\members\\alice.yaml',
      'C:\\Users\\foo\\content',
    ),
    true,
  );
});

test('win32: deep child is under base', () => {
  assert.equal(
    isUnderBaseWin32(
      'C:\\Users\\foo\\content\\requests\\pending\\2026-04-15-0001.yaml',
      'C:\\Users\\foo\\content',
    ),
    true,
  );
});

test('win32: sibling directory on same drive is NOT under base', () => {
  assert.equal(
    isUnderBaseWin32('C:\\Users\\foo\\other\\x.yaml', 'C:\\Users\\foo\\content'),
    false,
  );
});

test('win32: parent escape via .. is NOT under base', () => {
  assert.equal(
    isUnderBaseWin32('C:\\Users\\foo', 'C:\\Users\\foo\\content'),
    false,
  );
});

test('win32: different drive letter is NOT under base', () => {
  // The classic Windows edge case: target on a different drive.
  // path.win32.relative emits an absolute `D:\\...` as the relative
  // form, which isUnderBase detects via isAbsolute.
  assert.equal(
    isUnderBaseWin32('D:\\foo\\x.yaml', 'C:\\Users\\foo\\content'),
    false,
  );
});

test('win32: case-insensitive drive letter comparison', () => {
  // Windows paths are case-insensitive. path.win32.relative correctly
  // treats `c:\\` and `C:\\` as the same drive.
  assert.equal(
    isUnderBaseWin32(
      'c:\\Users\\foo\\content\\sub',
      'C:\\Users\\foo\\content',
    ),
    true,
  );
});

test('win32: prefix false-positive is rejected', () => {
  assert.equal(
    isUnderBaseWin32(
      'C:\\Users\\foo\\content-other\\x.yaml',
      'C:\\Users\\foo\\content',
    ),
    false,
  );
});

test('win32: hidden segment starting with .. is allowed', () => {
  assert.equal(
    isUnderBaseWin32(
      'C:\\Users\\foo\\content\\..hidden',
      'C:\\Users\\foo\\content',
    ),
    true,
  );
});

test('win32: forward-slash input (e.g. from WSL bridge) still classifies correctly', () => {
  // path.win32 handles `/` as an alternate separator in many cases;
  // verify that a mixed-separator subpath is still recognized as
  // under base. This is defensive — the bundled code resolves paths
  // via path.resolve() first which normalizes separators, but the
  // helper should still tolerate unresolved-ish inputs.
  assert.equal(
    isUnderBaseWin32('C:\\Users\\foo\\content/sub/x.yaml', 'C:\\Users\\foo\\content'),
    true,
  );
});
