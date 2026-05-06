// Partial-dist-staleness detector.
//
// Lives in bin/_lib/ rather than dist/ for the same reason the
// existing dist-missing guard is inlined: a helper that itself
// lived in dist/ would be silently absent precisely when the
// problem fires (circular trap). This file is plain .mjs and is
// not transpiled, so all 5 bin entries can import it directly.
//
// What it catches: the case where dist/ exists and the entry
// loads successfully, BUT one or more src/ files have been
// modified since the last build — so the binary runs against a
// stale compiled tree. The dogfood symptom that motivated this
// (May 2026) was `agora last` returning `unknown verb` after a
// `git pull` because the dispatcher in dist/ predated the
// last.ts addition in src/. The existing ERR_MODULE_NOT_FOUND
// path didn't fire because the dispatcher loaded fine — just
// without the new verb registered.
//
// Heuristic: compare the newest mtime of any *.ts file under
// src/ against the newest mtime of any *.js file under dist/src/.
// If src wins (with a small grace to absorb fs clock skew), the
// build is stale. Emit a stderr notice; do not block execution.
// The user can rebuild with `npm run build` and retry.
//
// Why notice and not error: the partial-staleness case is a
// dev-loop friction, not a correctness violation. A stale dist
// often runs fine for the verbs that haven't changed; failing
// closed would block work on the unchanged verbs while a more
// expensive `tsc` is queued. The dist-MISSING case (existing
// guard) does block — there's nothing to run.
//
// Ship-mode short-circuit: when guild-cli is installed via npm,
// package.json's `files` field excludes src/, so the directory
// won't exist alongside dist/. Callers should pass null/missing
// paths and the helper returns silently.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {string} srcDir  absolute path to src/ (the TypeScript tree)
 * @param {string} distDir absolute path to dist/src/ (the compiled tree)
 * @returns {void}         emits a stderr notice if dist is stale; otherwise silent
 */
export function checkDistFreshness(srcDir, distDir) {
  if (!existsSync(srcDir) || !existsSync(distDir)) {
    // Installed-via-npm shape (no src/) or first-run-before-build
    // (no dist/, the existing guard handles that case). Either
    // way nothing to compare.
    return;
  }
  const srcMtime = newestMtime(srcDir, '.ts');
  const distMtime = newestMtime(distDir, '.js');
  if (srcMtime === 0 || distMtime === 0) return;

  // 2-second grace: tsc emits .js files that may have a slightly
  // older mtime than the .ts they were compiled from on some
  // filesystems. Avoid flapping notices when the gap is within
  // single-digit seconds.
  const GRACE_MS = 2000;
  if (srcMtime > distMtime + GRACE_MS) {
    process.stderr.write(
      'guild-cli: dist/ is stale relative to src/ (some src files modified after the last build).\n' +
        '  Run: npm run build  (rebuild before re-running)\n' +
        '  Hint: this commonly fires after a `git pull`. The current run will continue against the stale dist.\n',
    );
  }
}

/**
 * Recursively find the newest mtime of any file under `root`
 * whose name ends with `ext`. Returns 0 if no matches found
 * or if the walk hit an error (treat as "no signal").
 *
 * @param {string} root
 * @param {string} ext
 * @returns {number}
 */
function newestMtime(root, ext) {
  let max = 0;
  try {
    const entries = readdirSync(root, { withFileTypes: true });
    for (const e of entries) {
      const p = join(root, e.name);
      if (e.isDirectory()) {
        max = Math.max(max, newestMtime(p, ext));
      } else if (e.isFile() && e.name.endsWith(ext)) {
        max = Math.max(max, statSync(p).mtimeMs);
      }
    }
  } catch {
    // Permission error / race / missing dir — treat as no signal.
    return 0;
  }
  return max;
}
