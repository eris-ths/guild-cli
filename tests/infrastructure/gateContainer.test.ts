// gateContainer.test.ts — buildContainer invariant pin (issue #155 PR-B).
//
// Why this invariant matters: the lock middleware acquires AFTER
// buildContainer. If a future change introduces write side-effects in
// buildContainer (e.g. config migration auto-run in a constructor),
// those writes happen BEFORE the lock, silently breaking the
// cross-process serialization guarantee. This test exists to catch
// that regression at the unit-test level.
//
// Strategy: snapshot the directory tree before and after the
// builder runs. Any new file, deleted file, or size change fails
// the test with a clear diff.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { buildContainer } from '../../src/interface/shared/container.js';

interface Snapshot {
  [relPath: string]: number; // size in bytes
}

function snapshot(root: string): Snapshot {
  const out: Snapshot = {};
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const rel = relative(root, full);
        out[rel] = statSync(full).size;
      }
    }
  }
  walk(root);
  return out;
}

test('buildContainer (gate) does not write to contentRoot', () => {
  const root = mkdtempSync(join(tmpdir(), 'gate-container-pin-'));
  try {
    writeFileSync(
      join(root, 'guild.config.yaml'),
      'content_root: .\nhost_names: [human]\n',
    );
    const before = snapshot(root);
    buildContainer({ cwd: root });
    const after = snapshot(root);
    assert.deepEqual(
      after,
      before,
      'buildContainer must not write to contentRoot — see test header',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
