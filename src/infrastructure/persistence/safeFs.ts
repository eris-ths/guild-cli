import {
  lstatSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { resolve, join, dirname, isAbsolute, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DomainError } from '../../domain/shared/DomainError.js';
import { isUnderBase } from './pathSafety.js';

/**
 * safeFs — all file operations go through these helpers so the path-safety
 * invariant is enforced in one place.
 *
 * Invariants:
 *   - target path must resolve under `base`
 *   - intermediate path components must not be symlinks (defeats traversal)
 *   - writes use `wx` flag only for new files (no silent overwrite on create)
 *
 * Cross-platform note: containment is checked via `isUnderBase` in
 * ./pathSafety.ts which uses `path.relative` rather than literal
 * `/` concatenation. This closes a Windows-first-startup crash where
 * `startsWith(absBase + '/')` never matched a backslash-separated
 * subpath.
 */

export function assertUnder(base: string, target: string): string {
  const absBase = resolve(base);
  const absTarget = isAbsolute(target) ? resolve(target) : resolve(absBase, target);
  if (!isUnderBase(absTarget, absBase)) {
    throw new DomainError(
      `Path escapes base: ${target} (resolved=${absTarget}, base=${absBase})`,
      'path',
    );
  }
  // Walk back from target towards base, rejecting symlinks. Loop
  // terminates either when we reach the base (expected) or when
  // dirname() stops making progress (i.e. we've hit the filesystem
  // root without finding base, which shouldn't happen after the
  // isUnderBase check above but is defended against anyway).
  let cur = absTarget;
  while (cur !== absBase) {
    if (existsSync(cur)) {
      const st = lstatSync(cur);
      if (st.isSymbolicLink()) {
        throw new DomainError(
          `Refusing to follow symlink: ${cur}`,
          'path',
        );
      }
    }
    const parent = dirname(cur);
    // dirname returns its input when called on a filesystem root
    // (`/` on posix, `C:\\` on Windows). This is the portable way
    // to detect "we've walked as far up as we can go" without a
    // hardcoded separator literal.
    if (parent === cur) break;
    cur = parent;
  }
  return absTarget;
}

export function readTextSafe(base: string, relOrAbs: string): string {
  const p = assertUnder(base, relOrAbs);
  return readFileSync(p, 'utf8');
}

export function writeTextSafe(
  base: string,
  relOrAbs: string,
  content: string,
  opts: { createOnly?: boolean } = {},
): void {
  const p = assertUnder(base, relOrAbs);
  mkdirSync(dirname(p), { recursive: true });
  if (opts.createOnly) {
    writeFileSync(p, content, { flag: 'wx' });
  } else {
    writeFileSync(p, content);
  }
}

/**
 * Write `content` to `relOrAbs` atomically: a sibling temp file is
 * written fully, then `rename()`d into place. Readers never observe a
 * torn or half-written file — they see either the previous content or
 * the new content. Temp and target are in the same directory, which
 * keeps the rename on a single filesystem (the atomicity guarantee on
 * POSIX and Windows NTFS).
 *
 * On failure (disk full, permission), the temp is best-effort removed
 * so leftover `.tmp-*` files don't accumulate. Successful rename
 * implicitly replaces any existing target.
 */
export function writeTextSafeAtomic(
  base: string,
  relOrAbs: string,
  content: string,
): void {
  const p = assertUnder(base, relOrAbs);
  const dir = dirname(p);
  mkdirSync(dir, { recursive: true });
  const tmpName = `.tmp-${process.pid}-${randomBytes(6).toString('hex')}-${basename(p)}`;
  const tmp = join(dir, tmpName);
  try {
    writeFileSync(tmp, content, { flag: 'wx' });
    renameSync(tmp, p);
  } catch (e) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // ignore cleanup failure — original error is what matters
    }
    throw e;
  }
}

export function unlinkSafe(base: string, relOrAbs: string): void {
  const p = assertUnder(base, relOrAbs);
  if (existsSync(p)) unlinkSync(p);
}

export function listDirSafe(base: string, relOrAbs: string): string[] {
  const p = assertUnder(base, relOrAbs);
  if (!existsSync(p)) return [];
  return readdirSync(p);
}

export function moveSafe(
  base: string,
  from: string,
  to: string,
): void {
  const src = assertUnder(base, from);
  const dst = assertUnder(base, to);
  mkdirSync(dirname(dst), { recursive: true });
  renameSync(src, dst);
}

export function existsSafe(base: string, relOrAbs: string): boolean {
  const p = assertUnder(base, relOrAbs);
  return existsSync(p);
}

export function joinSafe(...parts: string[]): string {
  return join(...parts);
}
