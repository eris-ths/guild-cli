// capDirEntries — the per-directory cap must be audible, not silent.
//
// Regression for a dogfood instance that reached 1006 completed requests:
// `gate list` and `gate tail` kept returning exit 0 with a short list, so
// records written moments earlier were simply absent — no error, no warning,
// no exit code. Because ids are date-prefixed and scans are ordered, the
// entries that vanished were the *newest* ones.
//
// Verifies:
//   1. under the cap: everything is returned and nothing is written to stderr
//   2. exactly at the cap: still silent (the boundary is not off-by-one)
//   3. over the cap: the result is capped AND a warning names the label,
//      the real count and how many were dropped
//   4. the entries kept are the NEWEST ones. Slicing from the front used to
//      discard exactly what `tail` exists to show; the window must move.
//   5. ascending order is preserved, so callers assuming sorted ids are safe

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capDirEntries,
  MAX_DIR_ENTRIES,
} from '../../src/infrastructure/persistence/safeFs.js';

/** Run fn with stderr captured; returns whatever it wrote. */
function captureStderr(fn: () => void): string {
  const original = process.stderr.write.bind(process.stderr);
  let captured = '';
  (process.stderr as NodeJS.WriteStream).write = ((chunk: unknown) => {
    captured += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return captured;
}

function files(n: number): string[] {
  // Date-prefixed like real record ids, so "later index" == "newer record".
  return Array.from({ length: n }, (_, i) => `2026-08-01-${String(i).padStart(4, '0')}.yaml`);
}

test('capDirEntries returns everything and stays silent under the cap', () => {
  const input = files(MAX_DIR_ENTRIES - 1);
  let out: string[] = [];
  const err = captureStderr(() => {
    out = capDirEntries(input, 'requests/completed');
  });
  assert.equal(out.length, MAX_DIR_ENTRIES - 1);
  assert.deepEqual(out, input);
  assert.equal(err, '', 'must not warn when nothing is dropped');
});

test('capDirEntries stays silent exactly at the cap', () => {
  const input = files(MAX_DIR_ENTRIES);
  let out: string[] = [];
  const err = captureStderr(() => {
    out = capDirEntries(input, 'requests/completed');
  });
  assert.equal(out.length, MAX_DIR_ENTRIES);
  assert.equal(err, '', 'the boundary itself drops nothing, so it must not warn');
});

test('capDirEntries warns with real numbers once entries are dropped', () => {
  const input = files(MAX_DIR_ENTRIES + 6);
  let out: string[] = [];
  const err = captureStderr(() => {
    out = capDirEntries(input, 'requests/completed');
  });
  assert.equal(out.length, MAX_DIR_ENTRIES, 'the cap itself still applies');
  assert.match(err, /warn:/);
  assert.match(err, /requests\/completed/, 'names which directory overflowed');
  assert.match(err, new RegExp(String(MAX_DIR_ENTRIES + 6)), 'reports the real count');
  assert.match(err, /\b6 oldest dropped\b/, 'reports how many were lost, and which end');
});

test('capDirEntries keeps the NEWEST entries and drops the oldest', () => {
  const input = files(MAX_DIR_ENTRIES + 3);
  const newest = input.slice(-3);
  const oldest = input.slice(0, 3);
  let out: string[] = [];
  const err = captureStderr(() => {
    out = capDirEntries(input, 'requests/completed');
  });
  // The regression this guards: a record written seconds ago must never be
  // the one that disappears from `list` / `tail`.
  for (const f of newest) {
    assert.ok(out.includes(f), `${f} (newest) must survive — tail exists to show it`);
  }
  for (const f of oldest) {
    assert.ok(!out.includes(f), `${f} (oldest) is what gets dropped instead`);
  }
  assert.match(err, /newest are kept/, 'the warning must say which end survives');
});

test('capDirEntries preserves ascending order after capping', () => {
  const input = files(MAX_DIR_ENTRIES + 10);
  let out: string[] = [];
  captureStderr(() => {
    out = capDirEntries(input, 'requests/completed');
  });
  const sorted = [...out].sort();
  assert.deepEqual(out, sorted, 'callers that assume sorted ids must be unaffected');
});
