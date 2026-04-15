// SafeFsQuarantineStore — infrastructure tests.
//
// Verifies:
//   1. move() relocates a real file under <root>/quarantine/<stamp>/<area>/
//   2. sources outside content_root are rejected (path traversal guard)
//   3. nonexistent sources throw with a descriptive error
//   4. area is correctly inferred from the path (members/requests/issues/other)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SafeFsQuarantineStore } from '../../src/infrastructure/persistence/SafeFsQuarantineStore.js';

function makeRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-cli-quarantine-'));
  mkdirSync(join(root, 'issues'));
  mkdirSync(join(root, 'requests', 'pending'), { recursive: true });
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('SafeFsQuarantineStore.move: relocates issue file under quarantine', async () => {
  const { root, cleanup } = makeRoot();
  try {
    const src = join(root, 'issues', 'i-broken.yaml');
    writeFileSync(src, 'garbage');
    const store = new SafeFsQuarantineStore(root, '2026-04-15T10:00:00.000Z');
    const result = await store.move(src);
    assert.equal(existsSync(src), false, 'source should be gone');
    assert.equal(existsSync(result.destination), true, 'dest should exist');
    // [\\/] accepts both posix and win32 separators so the test
    // passes on both CI matrix OS's.
    assert.match(
      result.destination,
      /quarantine[\\/]2026-04-15T10-00-00-000Z[\\/]issues[\\/]i-broken\.yaml$/,
    );
  } finally {
    cleanup();
  }
});

test('SafeFsQuarantineStore.move: rejects source outside content root', async () => {
  const { root, cleanup } = makeRoot();
  const outside = mkdtempSync(join(tmpdir(), 'guild-cli-outside-'));
  try {
    const src = join(outside, 'evil.yaml');
    writeFileSync(src, 'evil');
    const store = new SafeFsQuarantineStore(root);
    // U1: a plain outside-of-root path must NOT mention symlinks
    await assert.rejects(
      () => store.move(src),
      (e: Error) =>
        /outside content_root/.test(e.message) &&
        !/via symlink/.test(e.message),
    );
    // Source untouched
    assert.equal(existsSync(src), true);
  } finally {
    rmSync(outside, { recursive: true, force: true });
    cleanup();
  }
});

test('SafeFsQuarantineStore.move: missing source throws descriptive error', async () => {
  const { root, cleanup } = makeRoot();
  try {
    const store = new SafeFsQuarantineStore(root);
    await assert.rejects(
      () => store.move(join(root, 'issues', 'never-existed.yaml')),
      /does not exist/,
    );
  } finally {
    cleanup();
  }
});

test('SafeFsQuarantineStore.sourceExists: reflects filesystem state', async () => {
  const { root, cleanup } = makeRoot();
  try {
    const src = join(root, 'issues', 'i-x.yaml');
    writeFileSync(src, '');
    const store = new SafeFsQuarantineStore(root);
    assert.equal(store.sourceExists(src), true);
    rmSync(src);
    assert.equal(store.sourceExists(src), false);
    // Sources outside the content root never report as existing
    assert.equal(store.sourceExists('/etc/passwd'), false);
  } finally {
    cleanup();
  }
});

test('SafeFsQuarantineStore.move: refuses symlink that escapes content_root (D1)', async () => {
  const { root, cleanup } = makeRoot();
  const outside = mkdtempSync(join(tmpdir(), 'guild-cli-symlink-target-'));
  try {
    const real = join(outside, 'evil.yaml');
    writeFileSync(real, 'evil');
    const link = join(root, 'issues', 'i-link.yaml');
    symlinkSync(real, link);
    const store = new SafeFsQuarantineStore(root);
    await assert.rejects(
      () => store.move(link),
      // Generic "outside content_root" with canonical hint — no
      // false claim about symlink involvement (U1).
      /outside content_root.*canonical:/,
    );
    // The real target is untouched; the link is also untouched
    assert.equal(existsSync(real), true);
    assert.equal(existsSync(link), true);
  } finally {
    rmSync(outside, { recursive: true, force: true });
    cleanup();
  }
});

test('SafeFsQuarantineStore.move: requests file goes under requests/ area', async () => {
  const { root, cleanup } = makeRoot();
  try {
    const src = join(root, 'requests', 'pending', '2026-04-15-099.yaml');
    writeFileSync(src, 'broken');
    const store = new SafeFsQuarantineStore(root, '2026-04-15T10:00:00.000Z');
    const result = await store.move(src);
    assert.match(
      result.destination,
      /quarantine[\\/]2026-04-15T10-00-00-000Z[\\/]requests[\\/]2026-04-15-099\.yaml$/,
    );
  } finally {
    cleanup();
  }
});
