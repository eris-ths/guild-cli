import {
  lstatSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  renameSync,
} from 'node:fs';
import { resolve, join, dirname, isAbsolute } from 'node:path';
import { DomainError } from '../../domain/shared/DomainError.js';

/**
 * safeFs — all file operations go through these helpers so the path-safety
 * invariant is enforced in one place.
 *
 * Invariants:
 *   - target path must resolve under `base`
 *   - intermediate path components must not be symlinks (defeats traversal)
 *   - writes use `wx` flag only for new files (no silent overwrite on create)
 */

export function assertUnder(base: string, target: string): string {
  const absBase = resolve(base);
  const absTarget = isAbsolute(target) ? resolve(target) : resolve(absBase, target);
  if (!(absTarget === absBase || absTarget.startsWith(absBase + '/'))) {
    throw new DomainError(
      `Path escapes base: ${target}`,
      'path',
    );
  }
  // Walk back from target towards base, rejecting symlinks.
  let cur = absTarget;
  while (cur !== absBase && cur !== '/') {
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
