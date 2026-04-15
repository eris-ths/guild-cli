import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Resolve the package version from the installed package.json.
 *
 * At runtime we are loaded from `dist/src/interface/shared/version.js`,
 * so package.json is five directories up. We resolve the path relative
 * to this module's own URL rather than `process.cwd()` so the lookup
 * works regardless of where the user invokes the CLI from.
 *
 * Failure mode: if package.json cannot be read or parsed, return
 * 'unknown' rather than throwing. `--version` must never abort the CLI.
 */
export function getPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, '..', '..', '..', '..', 'package.json');
    const raw = readFileSync(pkgPath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === 'string' && parsed.version.length > 0) {
      return parsed.version;
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Returns true if argv starts with a version flag (--version / -v).
 * Matches only when the flag is the first argument, to avoid colliding
 * with verb-level `-v` usages (none currently, but future-proof).
 */
export function isVersionFlag(argv: readonly string[]): boolean {
  const first = argv[0];
  return first === '--version' || first === '-v';
}
