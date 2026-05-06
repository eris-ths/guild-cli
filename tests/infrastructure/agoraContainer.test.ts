// agoraContainer.test.ts — buildAgoraContainer invariant pin (#155 PR-B).
//
// Why this invariant matters: the lock middleware acquires AFTER
// buildAgoraContainer. If a future change introduces write side-effects
// in the builder (e.g. config migration auto-run in a constructor),
// those writes happen BEFORE the lock, silently breaking the
// cross-process serialization guarantee. This test exists to catch
// that regression at the unit-test level.

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
import { buildAgoraContainer } from '../../src/passages/agora/interface/container.js';

interface Snapshot {
  [relPath: string]: number;
}

function snapshot(root: string): Snapshot {
  const out: Snapshot = {};
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        out[relative(root, full)] = statSync(full).size;
      }
    }
  }
  walk(root);
  return out;
}

test('buildAgoraContainer does not write to contentRoot', () => {
  const root = mkdtempSync(join(tmpdir(), 'agora-container-pin-'));
  try {
    writeFileSync(
      join(root, 'guild.config.yaml'),
      'content_root: .\nhost_names: [human]\n',
    );
    const before = snapshot(root);
    buildAgoraContainer({ cwd: root });
    const after = snapshot(root);
    assert.deepEqual(after, before, 'buildAgoraContainer must not write to contentRoot');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
