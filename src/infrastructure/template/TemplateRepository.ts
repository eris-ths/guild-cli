// Wave-brief template registry (#235, two-tier lookup #302).
//
// Reads frontmatter+body markdown templates from two sources:
//   1. user override: `<content_root>/data/guild/templates/wave-brief/<name>.md`
//   2. built-in:      `<packageRoot>/templates/wave-brief/<name>.md`
//
// Same-name in content_root shadows the built-in (override semantics,
// no merge). The built-in tier is what `guild-cli` ships out of the
// box; the content_root tier is per-instance customization.
//
// Frontmatter is a YAML block delimited by lines containing exactly
// `---` at file start and end of the metadata section. Body is
// everything after the closing `---`. Malformed frontmatter routes
// through `onMalformed` (warn + skip the entry); the rest of the
// catalogue stays available.

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync, statSync } from 'node:fs';
import YAML from 'yaml';
import { listDirSafe } from '../persistence/safeFs.js';
import { OnMalformed } from '../../application/ports/OnMalformed.js';

export type TemplateSource = 'content_root' | 'builtin';

/** Parsed wave-brief template. `body` is the markdown after the
 *  frontmatter block, trimmed at neither end (callers may render or
 *  embed verbatim). `frontmatter` carries every key parsed from the
 *  YAML block — `template_name`, `template_version`, `intended_use`,
 *  `gate_required` are the canonical four; additional keys are
 *  tolerated and surfaced for forward-compat consumers. */
export interface ParsedTemplate {
  readonly name: string;
  readonly version: number;
  readonly intendedUse: string;
  readonly gateRequired: boolean;
  readonly body: string;
  readonly frontmatter: Record<string, unknown>;
  /** Absolute path of the source file (for diagnostics). */
  readonly source: string;
  /** Which tier this entry came from. `content_root` always wins over
   *  `builtin` when both define the same name. */
  readonly sourceKind: TemplateSource;
}

export interface TemplateRepository {
  /** List every parseable template across both tiers, with content_root
   *  shadowing built-in entries of the same name. Returns [] when
   *  neither tier exists. */
  list(): ParsedTemplate[];
  /** Find a single template by name. Tries content_root first, then
   *  built-in. Returns null when no file matches or parsing failed. */
  find(name: string): ParsedTemplate | null;
  /** Filesystem path of the content_root templates directory
   *  (informational; used by handlers to surface the SOT location). */
  readonly dir: string;
  /** True when the content_root templates dir exists on disk. The
   *  packaged built-in tier is independent — `list()` returns built-in
   *  entries even when this is false. */
  readonly exists: boolean;
  /** Filesystem path of the packaged built-in templates dir, or null
   *  when no built-in tier is configured. */
  readonly builtinDir: string | null;
  /** True when the built-in templates dir exists on disk. */
  readonly builtinExists: boolean;
}

const TEMPLATE_FILE_PATTERN = /^[a-z][a-z0-9_-]*\.md$/;

/**
 * Resolve the packaged built-in templates directory shipped with
 * guild-cli (#302). Returns the first existing candidate, or `null`
 * when no built-in tier is reachable (only happens if the package
 * is unpacked without the `templates/` dir — e.g. a custom build).
 *
 * Two candidates are checked because this module is loaded from
 * either path depending on how the caller runs guild-cli:
 *   - `<root>/dist/src/infrastructure/template/` (production, via bin/)
 *   - `<root>/src/infrastructure/template/`      (jest ts-source tests)
 */
export function resolveBuiltinTemplatesDir(): string | null {
  const here = fileURLToPath(import.meta.url);
  const candidates = [
    join(here, '..', '..', '..', '..', '..', 'templates', 'wave-brief'),
    join(here, '..', '..', '..', '..', 'templates', 'wave-brief'),
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c) && statSync(c).isDirectory()) return c;
    } catch {
      // ignore — try next candidate
    }
  }
  return null;
}

/**
 * Filesystem-backed template repo with two-tier lookup (#302).
 * - content_root tier: `<contentRoot>/data/guild/templates/wave-brief/`
 * - built-in tier:     `<builtinDir>` (typically `<packageRoot>/templates/wave-brief/`)
 *
 * `builtinDir` may be `null` to disable the tier (tests that want pure
 * content_root behavior pass null).
 */
export class FsTemplateRepository implements TemplateRepository {
  readonly dir: string;
  readonly builtinDir: string | null;
  constructor(
    contentRoot: string,
    builtinDir: string | null,
    private readonly onMalformed: OnMalformed,
  ) {
    this.dir = join(contentRoot, 'data', 'guild', 'templates', 'wave-brief');
    this.builtinDir = builtinDir;
  }

  private dirExists(path: string | null): boolean {
    if (!path) return false;
    if (!existsSync(path)) return false;
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  }

  get exists(): boolean {
    return this.dirExists(this.dir);
  }

  get builtinExists(): boolean {
    return this.dirExists(this.builtinDir);
  }

  list(): ParsedTemplate[] {
    // Build from built-in first, then let content_root entries
    // overwrite by name. Sort once at the end for deterministic output.
    const byName = new Map<string, ParsedTemplate>();
    if (this.builtinExists && this.builtinDir) {
      for (const t of this.listDir(this.builtinDir, 'builtin')) {
        byName.set(t.name, t);
      }
    }
    if (this.exists) {
      for (const t of this.listDir(this.dir, 'content_root')) {
        byName.set(t.name, t);
      }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private listDir(dir: string, kind: TemplateSource): ParsedTemplate[] {
    const files = listDirSafe(dir, '.').filter((f) =>
      TEMPLATE_FILE_PATTERN.test(f),
    );
    const out: ParsedTemplate[] = [];
    for (const f of files.sort()) {
      const parsed = this.readFile(join(dir, f), kind);
      if (parsed) out.push(parsed);
    }
    return out;
  }

  find(name: string): ParsedTemplate | null {
    if (!TEMPLATE_FILE_PATTERN.test(`${name}.md`)) {
      // Defensive: an attacker-controlled `name` could attempt path
      // traversal through `--template ../../../etc/passwd`. Refuse
      // anything that doesn't fit the simple slug shape rather than
      // letting the filesystem decide. Same regex as the list filter.
      return null;
    }
    if (this.exists) {
      const path = join(this.dir, `${name}.md`);
      if (existsSync(path)) {
        const parsed = this.readFile(path, 'content_root');
        if (parsed) return parsed;
      }
    }
    if (this.builtinExists && this.builtinDir) {
      const path = join(this.builtinDir, `${name}.md`);
      if (existsSync(path)) {
        const parsed = this.readFile(path, 'builtin');
        if (parsed) return parsed;
      }
    }
    return null;
  }

  private readFile(path: string, kind: TemplateSource): ParsedTemplate | null {
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.onMalformed(path, `template read failed: ${msg}`);
      return null;
    }
    return parseTemplate(raw, path, kind, this.onMalformed);
  }
}

/**
 * Pure parser for a wave-brief template file. Exported (not just
 * `FsTemplateRepository`-private) so the test suite can exercise the
 * frontmatter edge cases without round-tripping through the
 * filesystem.
 */
export function parseTemplate(
  raw: string,
  source: string,
  sourceKind: TemplateSource,
  onMalformed: OnMalformed,
): ParsedTemplate | null {
  // Frontmatter delimiter: a line containing just `---` at the very
  // start of the file, then a closing `---` on its own line. Anything
  // before the opening delimiter (including leading whitespace) is
  // refused — the convention is exact start.
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) {
    onMalformed(source, 'template missing opening frontmatter delimiter (---)');
    return null;
  }
  const afterOpen = raw.replace(/^---\r?\n/, '');
  const closeIdx = afterOpen.search(/^---\r?\n/m);
  if (closeIdx < 0) {
    onMalformed(source, 'template missing closing frontmatter delimiter (---)');
    return null;
  }
  const fmText = afterOpen.slice(0, closeIdx);
  const body = afterOpen.slice(closeIdx).replace(/^---\r?\n/, '');

  let fm: unknown;
  try {
    fm = YAML.parse(fmText);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    onMalformed(source, `template frontmatter yaml parse failed: ${msg.split('\n').join(' ')}`);
    return null;
  }
  if (fm === null || typeof fm !== 'object' || Array.isArray(fm)) {
    onMalformed(source, 'template frontmatter is not a mapping');
    return null;
  }
  const fmObj = fm as Record<string, unknown>;
  const name = fmObj['template_name'];
  if (typeof name !== 'string' || name.length === 0) {
    onMalformed(source, 'template frontmatter missing template_name');
    return null;
  }
  const rawVer = fmObj['template_version'];
  let version = 1;
  if (typeof rawVer === 'number' && Number.isFinite(rawVer) && rawVer >= 1) {
    version = Math.floor(rawVer);
  } else if (rawVer !== undefined) {
    onMalformed(
      source,
      `template_version is not a positive integer (got ${typeof rawVer === 'number' ? String(rawVer) : typeof rawVer}); defaulting to 1`,
    );
  }
  const intendedUseRaw = fmObj['intended_use'];
  const intendedUse = typeof intendedUseRaw === 'string' ? intendedUseRaw : '';
  const gateRequiredRaw = fmObj['gate_required'];
  const gateRequired =
    typeof gateRequiredRaw === 'boolean' ? gateRequiredRaw : true;

  return {
    name,
    version,
    intendedUse,
    gateRequired,
    body,
    frontmatter: fmObj,
    source,
    sourceKind,
  };
}
