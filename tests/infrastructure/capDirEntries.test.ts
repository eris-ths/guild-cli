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
  maxDirEntries,
  MAX_DIR_ENTRIES,
  MAX_DIR_ENTRIES_CEILING,
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

// --- GUILD_MAX_DIR_ENTRIES override ---------------------------------------
//
// The 1000 default bounds memory for a fresh clone, but a long-lived
// content_root outgrows it legitimately (a request YAML is a few KB). The
// override exists so such an instance can keep its records whole instead of
// listing blind.
//
// Verifies:
//   6. an unset/empty env keeps the documented default
//   7. a raised value actually widens the window (the cap is read per call,
//      not frozen at module load)
//   8. a malformed value THROWS. Falling back to 1000 would silently restore
//      the exact failure this file is a regression test for.
//   9. the ceiling holds, so the override cannot remove the bound entirely.

function withEnv(value: string | undefined, fn: () => void): void {
  const had = Object.hasOwn(process.env, 'GUILD_MAX_DIR_ENTRIES');
  const prev = process.env.GUILD_MAX_DIR_ENTRIES;
  if (value === undefined) delete process.env.GUILD_MAX_DIR_ENTRIES;
  else process.env.GUILD_MAX_DIR_ENTRIES = value;
  try {
    fn();
  } finally {
    if (had) process.env.GUILD_MAX_DIR_ENTRIES = prev;
    else delete process.env.GUILD_MAX_DIR_ENTRIES;
  }
}

test('maxDirEntries falls back to the default when unset or empty', () => {
  withEnv(undefined, () => assert.equal(maxDirEntries(), MAX_DIR_ENTRIES));
  withEnv('', () => assert.equal(maxDirEntries(), MAX_DIR_ENTRIES));
  withEnv('   ', () => assert.equal(maxDirEntries(), MAX_DIR_ENTRIES));
});

test('GUILD_MAX_DIR_ENTRIES raises the effective cap for capDirEntries', () => {
  const input = files(MAX_DIR_ENTRIES + 500);
  withEnv(String(MAX_DIR_ENTRIES + 1000), () => {
    let out: string[] = [];
    const err = captureStderr(() => {
      out = capDirEntries(input, 'requests/completed');
    });
    assert.equal(out.length, input.length, 'nothing is dropped under the raised cap');
    assert.equal(err, '', 'and nothing is warned about');
  });
});

test('a raised cap still warns, naming the raised number, once exceeded', () => {
  const input = files(2100);
  withEnv('2000', () => {
    let out: string[] = [];
    const err = captureStderr(() => {
      out = capDirEntries(input, 'requests/completed');
    });
    assert.equal(out.length, 2000);
    assert.match(err, /2000 cap/, 'the warning reports the effective cap, not the default');
    assert.match(err, /100 oldest dropped/);
    assert.match(err, /GUILD_MAX_DIR_ENTRIES/, 'and names the knob that changes it');
  });
});

test('GUILD_MAX_DIR_ENTRIES rejects malformed values instead of silently defaulting', () => {
  for (const bad of ['abc', '0', '-5', '10.5', String(MAX_DIR_ENTRIES_CEILING + 1)]) {
    withEnv(bad, () => {
      assert.throws(
        () => maxDirEntries(),
        /GUILD_MAX_DIR_ENTRIES/,
        `"${bad}" must be rejected loudly, not quietly reset to ${MAX_DIR_ENTRIES}`,
      );
    });
  }
});

test('the ceiling itself is accepted', () => {
  withEnv(String(MAX_DIR_ENTRIES_CEILING), () =>
    assert.equal(maxDirEntries(), MAX_DIR_ENTRIES_CEILING));
});

test('numeric spellings that are genuinely integral are accepted', () => {
  // '1e4' was in the reject list on first writing and failed the suite:
  // Number('1e4') is 10000 and passes Number.isInteger. Rejecting it would
  // have been the test dictating a restriction the feature has no reason to
  // impose — the contract is "an integer in range", not "written in decimal".
  withEnv('1e4', () => assert.equal(maxDirEntries(), 10000));
  withEnv(' 2500 ', () => assert.equal(maxDirEntries(), 2500));
});
