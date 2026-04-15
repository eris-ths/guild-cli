// SafeFsQuarantineStore — adapter for QuarantineStore that moves
// files into <content_root>/quarantine/<ISO-timestamp>/<area>/<basename>.
//
// Constraints:
//   - source must already resolve under content_root (validated by
//     resolve+startsWith against the configured root)
//   - destination is computed under content_root, no escape possible
//   - the timestamped subdirectory is created on first move per
//     instance, so a single repair run groups its actions together
//     and a re-run produces a new timestamp directory
//   - move uses fs.renameSync where possible (atomic within a
//     filesystem); cross-device renames fall back to copy+unlink
//
// This keeps the silent_fail_taxonomy "cleanup-of-cleanup is an
// anti-pattern" rule honored: a failed move throws and surfaces,
// rather than partially completing and leaving a half-quarantined
// state.

import {
  existsSync,
  mkdirSync,
  renameSync,
  copyFileSync,
  unlinkSync,
  realpathSync,
} from 'node:fs';
import { resolve, basename, join, sep } from 'node:path';
import {
  QuarantineStore,
  QuarantineResult,
} from '../../application/ports/QuarantineStore.js';

export class SafeFsQuarantineStore implements QuarantineStore {
  private readonly contentRoot: string;
  private readonly quarantineDir: string;

  constructor(contentRoot: string, nowIso: string = new Date().toISOString()) {
    // Canonicalize via realpath so the symlink-resolved comparison in
    // move() doesn't false-positive on platforms where common parents
    // (e.g. macOS /var → /private/var) are themselves symlinks.
    const absRoot = resolve(contentRoot);
    try {
      this.contentRoot = realpathSync(absRoot);
    } catch {
      this.contentRoot = absRoot;
    }
    // ':' is legal on POSIX but awkward in shells; replace with '-'
    const safeStamp = nowIso.replace(/[:.]/g, '-');
    this.quarantineDir = join(this.contentRoot, 'quarantine', safeStamp);
  }

  sourceExists(absSource: string): boolean {
    const resolved = resolve(absSource);
    if (!existsSync(resolved)) return false;
    try {
      const real = realpathSync(resolved);
      return this.isUnderContentRoot(real);
    } catch {
      return false;
    }
  }

  async move(absSource: string): Promise<QuarantineResult> {
    const resolvedSource = resolve(absSource);
    if (!existsSync(resolvedSource)) {
      throw new Error(`quarantine refused: source does not exist: ${absSource}`);
    }
    // Defense in depth (D1 from noir devil review on req 2026-04-15-0012):
    // resolve() does not follow symlinks, so a symlink inside content_root
    // pointing outside would pass a naive startsWith check. Canonicalize
    // both sides via realpath (constructor canonicalizes contentRoot) and
    // do the boundary check on the canonical form — that closes the
    // symlink-escape hole and keeps the test for normal files working.
    const realSource = realpathSync(resolvedSource);
    if (!this.isUnderContentRoot(realSource)) {
      // U1 (eris user review on req 2026-04-15-0012): never claim
      // "via symlink" — on macOS /var → /private/var canonicalization
      // makes parent-level differences common even with no symlink in
      // the path the operator gave us. Show both forms when they
      // differ and let the operator compare; that's honest without
      // inventing a cause.
      const detail =
        realSource === resolvedSource
          ? absSource
          : `${absSource} (canonical: ${realSource})`;
      throw new Error(
        `quarantine refused: source is outside content_root: ${detail}`,
      );
    }

    const area = this.areaOf(realSource);
    const destDir = join(this.quarantineDir, area);
    mkdirSync(destDir, { recursive: true });
    const dest = join(destDir, basename(resolvedSource));

    if (!this.isUnderContentRoot(dest)) {
      throw new Error(
        `quarantine refused: computed destination escapes content_root: ${dest}`,
      );
    }

    try {
      renameSync(realSource, dest);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
        // cross-device — fall back to copy+unlink
        copyFileSync(realSource, dest);
        unlinkSync(realSource);
      } else {
        throw e;
      }
    }

    return { source: realSource, destination: dest };
  }

  private isUnderContentRoot(absPath: string): boolean {
    const r = resolve(absPath);
    return r === this.contentRoot || r.startsWith(this.contentRoot + sep);
  }

  // Best-effort area inference from path segment. Falls back to
  // 'other' rather than throwing — the file still gets quarantined.
  private areaOf(absSource: string): string {
    const rel = absSource.startsWith(this.contentRoot + sep)
      ? absSource.slice(this.contentRoot.length + 1)
      : absSource;
    const first = rel.split(sep)[0] ?? '';
    if (first === 'members' || first === 'requests' || first === 'issues') {
      return first;
    }
    return 'other';
  }
}
