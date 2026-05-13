// Every `bin/*.mjs` entry must be tracked with the executable bit
// (mode 100755) in git. Without it, a user invoking `./bin/<x>.mjs`
// directly hits "permission denied" — the file is read by `node`
// only when the shell or a wrapper calls `node bin/<x>.mjs` (which
// is how npm scripts and our tests run them, so the regression
// hides in those code paths).
//
// Observed 2026-05-13: `bin/ctx.mjs` had been tracked at 100644
// since #143 (2026-05-04) — invisible until a user happened to type
// `./bin/ctx.mjs` directly. The four sibling entries (gate / agora /
// devil / guild) had 100755 set since their respective ship PRs.
// This test pins the invariant so the next new bin entry can't
// regress in the same way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// repo root: dist/tests/interface/ -> walk up three.
const REPO_ROOT = resolve(here, '../../../');

test('every bin/*.mjs entry is tracked as executable (mode 100755)', () => {
  // git ls-files -s lists `<mode> <hash> <stage>\t<path>` per file.
  // -s is the "stage" form: it reports the index entry, which is what
  // gets shipped. Filesystem mode bits don't matter for the trap
  // we're guarding — only the tracked mode does (the one git
  // checkpoints into the tar/zip distribution).
  const out = execFileSync(
    'git',
    ['ls-files', '-s', '--', 'bin/'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  // Parse: keep only top-level .mjs entries (i.e. the dispatcher
  // entry points). `bin/_lib/*.mjs` are shared helpers — they're
  // imported by the entries, never invoked directly, so the
  // executable bit doesn't apply to them.
  const entries = out
    .split('\n')
    .filter((line) => line.endsWith('.mjs'))
    .map((line) => {
      // `100755 <hash> 0\tbin/<name>.mjs`
      const m = line.match(/^(\d{6})\s+\S+\s+\d+\t(.+)$/);
      assert.ok(m, `unparseable git ls-files line: ${line}`);
      return { mode: m[1]!, path: m[2]! };
    })
    .filter((e) => /^bin\/[^/]+\.mjs$/.test(e.path));
  // Sanity: we have the 5 expected entries (gate / agora / devil /
  // ctx / guild). If a sixth appears, the test still passes — the
  // invariant scales — but if zero appear, the parse broke.
  assert.ok(entries.length >= 4, `expected ≥4 bin/*.mjs entries, got ${entries.length}`);
  for (const { mode, path } of entries) {
    assert.equal(
      mode,
      '100755',
      `${path} must be tracked at 100755 (executable). ` +
        `Got ${mode}. Fix with: git update-index --chmod=+x ${path}`,
    );
  }
});
