// Wave-brief template registry (#235).
//
// Reads frontmatter+body markdown templates from
// `<content_root>/data/guild/templates/wave-brief/<name>.md`. The
// templates SOT is per-instance (each guild keeps its own brief
// catalogue under content_root); the public guild-cli repo does NOT
// ship templates, so missing dir → "empty registry" is the legitimate
// default for fresh installs.
//
// Frontmatter is a YAML block delimited by lines containing exactly
// `---` at file start and end of the metadata section. Body is
// everything after the closing `---`. Malformed frontmatter routes
// through `onMalformed` (warn + skip the entry); the rest of the
// catalogue stays available.

import { join } from 'node:path';
import { readFileSync, existsSync, statSync } from 'node:fs';
import YAML from 'yaml';
import { listDirSafe } from '../persistence/safeFs.js';
import { OnMalformed } from '../../application/ports/OnMalformed.js';

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
}

export interface TemplateRepository {
  /** List every parseable template in the registry. Returns [] when
   *  the templates dir does not exist. */
  list(): ParsedTemplate[];
  /** Find a single template by name. Returns null if no file matches
   *  `<name>.md` or if the file failed to parse (caller should treat
   *  null as "unknown name" — a parse failure already routed through
   *  onMalformed). */
  find(name: string): ParsedTemplate | null;
  /** Filesystem path of the templates directory (informational; used
   *  by handlers to surface the SOT location in error messages). */
  readonly dir: string;
  /** True when the templates dir exists on disk. False is the legitimate
   *  fresh-install / public-repo case. */
  readonly exists: boolean;
}

const TEMPLATE_FILE_PATTERN = /^[a-z][a-z0-9_-]*\.md$/;

/**
 * Filesystem-backed template repo. Path is resolved from the content
 * root: `<contentRoot>/data/guild/templates/wave-brief/`. The fixed
 * subdirectory is intentional — different brief categories (e.g.
 * `code-review/`, `incident/`) would each get their own subdir under
 * `data/guild/templates/`, but only `wave-brief` is in scope for #235.
 */
export class FsTemplateRepository implements TemplateRepository {
  readonly dir: string;
  constructor(
    contentRoot: string,
    private readonly onMalformed: OnMalformed,
  ) {
    this.dir = join(contentRoot, 'data', 'guild', 'templates', 'wave-brief');
  }

  get exists(): boolean {
    if (!existsSync(this.dir)) return false;
    try {
      return statSync(this.dir).isDirectory();
    } catch {
      return false;
    }
  }

  list(): ParsedTemplate[] {
    if (!this.exists) return [];
    // listDirSafe expects a base + relative; since `dir` is already
    // absolute and outside the request layout's safety domain, use
    // it as the base directly. Templates dir is read-only.
    const files = listDirSafe(this.dir, '.').filter((f) =>
      TEMPLATE_FILE_PATTERN.test(f),
    );
    const out: ParsedTemplate[] = [];
    for (const f of files.sort()) {
      const parsed = this.readFile(join(this.dir, f));
      if (parsed) out.push(parsed);
    }
    return out;
  }

  find(name: string): ParsedTemplate | null {
    if (!this.exists) return null;
    if (!TEMPLATE_FILE_PATTERN.test(`${name}.md`)) {
      // Defensive: an attacker-controlled `name` could attempt path
      // traversal through `--template ../../../etc/passwd`. We refuse
      // anything that doesn't fit the simple slug shape rather than
      // letting the filesystem decide. The list() filter uses the
      // same regex, so the two surfaces stay consistent.
      return null;
    }
    const path = join(this.dir, `${name}.md`);
    if (!existsSync(path)) return null;
    return this.readFile(path);
  }

  private readFile(path: string): ParsedTemplate | null {
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.onMalformed(path, `template read failed: ${msg}`);
      return null;
    }
    return parseTemplate(raw, path, this.onMalformed);
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
  // Skip the opening delimiter line, then find the closing one.
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
  };
}
