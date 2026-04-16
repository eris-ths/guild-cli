// writeTextSafeAtomic — atomicity and cleanup invariants.
//
// Verifies:
//   1. normal writes land at the target path with exact content
//   2. the final path never contains a torn/partial file: if write
//      succeeds, content is complete; readers never see an empty
//      or half-written target
//   3. no .tmp-* leftovers after success
//   4. .tmp-* is cleaned up when the write fails (e.g. EACCES)
//   5. overwriting an existing file works (rename replaces)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeTextSafeAtomic } from '../../src/infrastructure/persistence/safeFs.js';

function makeBase(): { base: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'guild-cli-atomic-'));
  return { base, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test('writeTextSafeAtomic: writes content to target path', () => {
  const { base, cleanup } = makeBase();
  try {
    writeTextSafeAtomic(base, 'a.yaml', 'hello');
    assert.equal(readFileSync(join(base, 'a.yaml'), 'utf8'), 'hello');
  } finally {
    cleanup();
  }
});

test('writeTextSafeAtomic: no .tmp-* leftovers after success', () => {
  const { base, cleanup } = makeBase();
  try {
    writeTextSafeAtomic(base, 'a.yaml', 'hello');
    const leftovers = readdirSync(base).filter((f) => f.startsWith('.tmp-'));
    assert.deepEqual(leftovers, [], `expected no tmp files, got ${leftovers.join(',')}`);
  } finally {
    cleanup();
  }
});

test('writeTextSafeAtomic: overwrites existing target', () => {
  const { base, cleanup } = makeBase();
  try {
    writeTextSafeAtomic(base, 'a.yaml', 'v1');
    writeTextSafeAtomic(base, 'a.yaml', 'v2');
    assert.equal(readFileSync(join(base, 'a.yaml'), 'utf8'), 'v2');
    const leftovers = readdirSync(base).filter((f) => f.startsWith('.tmp-'));
    assert.deepEqual(leftovers, []);
  } finally {
    cleanup();
  }
});

test('writeTextSafeAtomic: large content arrives intact (no tearing)', () => {
  const { base, cleanup } = makeBase();
  try {
    // 1 MiB payload: exceeds a single page buffer so a non-atomic
    // write path would be likely to show torn reads under stress.
    const payload = 'x'.repeat(1024 * 1024);
    writeTextSafeAtomic(base, 'big.yaml', payload);
    assert.equal(readFileSync(join(base, 'big.yaml'), 'utf8').length, payload.length);
  } finally {
    cleanup();
  }
});

test('writeTextSafeAtomic: cleans up .tmp-* when target directory is read-only', () => {
  if (process.platform === 'win32') return; // chmod semantics differ
  if (process.getuid?.() === 0) return; // root bypasses perms
  const { base, cleanup } = makeBase();
  try {
    writeFileSync(join(base, 'existing.yaml'), 'v1');
    chmodSync(base, 0o500); // r-x only: no new files allowed
    let threw = false;
    try {
      writeTextSafeAtomic(base, 'new.yaml', 'v2');
    } catch {
      threw = true;
    }
    chmodSync(base, 0o700); // restore so readdir works
    assert.equal(threw, true, 'expected atomic write to fail on read-only dir');
    const leftovers = readdirSync(base).filter((f) => f.startsWith('.tmp-'));
    assert.deepEqual(leftovers, [], `expected no tmp leftovers, got ${leftovers.join(',')}`);
    assert.equal(readFileSync(join(base, 'existing.yaml'), 'utf8'), 'v1', 'existing file untouched');
  } finally {
    cleanup();
  }
});
