// Shared test helper: canonical temp-root creation.
//
// On darwin `os.tmpdir()` returns `/var/folders/...` which is itself
// a symlink to `/private/var/folders/...`. Subprocesses spawned with
// the symlinked cwd resolve their own cwd through the symlink and
// emit the canonical form, so any test that asserts on path strings
// the subprocess produced has to compare against the canonical root,
// not the symlinked one returned by `mkdtempSync`. Wrapping with
// `realpathSync` collapses both forms to the canonical one.
//
// History: PR #240 (#238) wrapped each test bootstrap individually
// to resolve 12 darwin flakes. This helper is the follow-up (#241):
// one central wrap so the next test author can't reintroduce the
// flake by writing `mkdtempSync(...)` directly without realpath.

import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function makeTempRoot(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}
