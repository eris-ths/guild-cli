// pathSafety — cross-platform path containment check.
//
// Background: the previous implementation of `assertUnder` used
// `absTarget.startsWith(absBase + '/')` which hardcoded the POSIX
// separator. On Windows, `path.resolve()` returns paths with `\`
// separators, so the literal `/` never matched any legitimate
// subpath — every Windows invocation threw `DomainError: Path
// escapes base` at the first filesystem boundary and crashed the
// CLI before any verb could run.
//
// The fix is to use `path.relative(base, target)`, which returns:
//   - `''`            when target === base (OK, containment trivially holds)
//   - `'sub/..'`      when target is under base (no '..' segments → OK)
//   - `'../../x'`     when target is outside base (leading '..' → NOT OK)
//   - an absolute    when target is on a different Windows drive (NOT OK)
//
// `path.relative` uses the OS native separator internally but the
// `..` / absolute detection is shape-based, not separator-based.
// The logic below is therefore portable as long as the same
// `path` module (posix or win32) is used for both `relative` and
// `isAbsolute`.
//
// The `makeIsUnderBase` factory lets unit tests exercise the
// logic against `path.posix` AND `path.win32` from a Linux host.

import pathDefault, { type PlatformPath } from 'node:path';

export type PathApi = Pick<PlatformPath, 'relative' | 'isAbsolute' | 'sep'>;

/**
 * Build an `isUnderBase` function bound to a specific `path`
 * module flavor (production: default; tests: posix / win32).
 */
export function makeIsUnderBase(
  api: PathApi,
): (absTarget: string, absBase: string) => boolean {
  return function isUnderBase(absTarget: string, absBase: string): boolean {
    // Identical paths are trivially "under" themselves.
    if (absTarget === absBase) return true;

    // path.relative returns the shortest relative traversal between
    // two absolute paths. If the result starts with '..' we're
    // outside; if it's absolute we're on a different Windows drive.
    const rel = api.relative(absBase, absTarget);
    if (rel === '') return true;
    if (rel === '..') return false;
    // Check for leading '..' followed by either separator so we
    // don't false-positive on a legitimate path segment that
    // happens to start with two dots (`..hidden`).
    if (rel.startsWith('..' + api.sep)) return false;
    // On posix, api.sep is '/' and the above catches '../'. On
    // win32, api.sep is '\\' and catches '..\\'. But path.relative
    // on win32 can also emit '/' in some edge cases under WSL — guard
    // against it explicitly.
    if (rel.startsWith('../')) return false;
    if (api.isAbsolute(rel)) return false;
    return true;
  };
}

/**
 * Production-bound `isUnderBase` using the default `path` module
 * (posix on Linux/Mac, win32 on Windows). This is what safeFs and
 * GuildConfig use for real filesystem checks.
 */
export const isUnderBase = makeIsUnderBase(pathDefault);
