// Filesystem-backed lore reader.
//
// Lore lives at `<packageRoot>/lore/principles/*.md` and
// `<packageRoot>/lore/traps/*.md`. There is no per-content_root tier
// for lore — principles and traps are package-shipped doctrine, not
// substrate state.
//
// Each markdown file carries:
//   - optional YAML frontmatter (`---\n<key>: <value>\n---\n`)
//   - a body whose first `# <title>` line we expose as a summary header
//
// Frontmatter keys we recognize:
//   - principles: `applies_to` (default: `all`)
//   - traps:      `relevant_until` (string: `indefinite` or ISO date)
//
// All other frontmatter keys are preserved opaquely on the parsed
// entry so callers can read them without this module growing a known-
// keys allowlist.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type LoreType = 'principle' | 'trap';

export interface LoreEntry {
  readonly type: LoreType;
  /** filename without `.md` extension, e.g. `11-ai-first-human-as-projection`. */
  readonly name: string;
  /** absolute path to the source file. */
  readonly path: string;
  /** first `# <title>` line, or null when the file has no H1. */
  readonly title: string | null;
  /** parsed frontmatter as a plain key→value record (string values only). */
  readonly frontmatter: Readonly<Record<string, string>>;
  /** markdown body without the frontmatter block. */
  readonly body: string;
}

export interface LoreRepository {
  /** True iff the underlying lore directories resolved at construction. */
  readonly available: boolean;
  /** Absolute path the repo resolved (null when nothing was found). */
  readonly baseDir: string | null;
  /** Every lore entry, sorted by `name`. Empty array when unavailable. */
  listAll(): LoreEntry[];
  /** Lookup by exact `name`. Returns null when no such file exists. */
  find(name: string): LoreEntry | null;
}

/**
 * Resolve `<packageRoot>/lore/` from the runtime file path. The
 * candidate list mirrors `resolveBuiltinTemplatesDir` so the same
 * dev / prod / jest path shapes are covered:
 *   - `<root>/dist/src/infrastructure/lore/`  (production via bin/)
 *   - `<root>/src/infrastructure/lore/`        (jest ts-source tests)
 */
export function resolveLoreBaseDir(): string | null {
  const here = fileURLToPath(import.meta.url);
  const candidates = [
    join(here, '..', '..', '..', '..', '..', 'lore'),
    join(here, '..', '..', '..', '..', 'lore'),
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c) && statSync(c).isDirectory()) return c;
    } catch {
      // ignore — try next
    }
  }
  return null;
}

export class FsLoreRepository implements LoreRepository {
  readonly available: boolean;
  readonly baseDir: string | null;
  // Lazy cache: list() and find() share the same parse pass. Lore is
  // small (<50 files) and read-only at this layer, so a single in-
  // process scan is fine.
  private cached: LoreEntry[] | null = null;

  constructor(baseDir: string | null) {
    this.baseDir = baseDir;
    this.available = baseDir !== null && existsSync(baseDir);
  }

  listAll(): LoreEntry[] {
    if (!this.available || this.baseDir === null) return [];
    if (this.cached !== null) return this.cached;
    const entries: LoreEntry[] = [];
    for (const sub of ['principles', 'traps'] as const) {
      const dir = join(this.baseDir, sub);
      if (!existsSync(dir)) continue;
      const type: LoreType = sub === 'principles' ? 'principle' : 'trap';
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.md')) continue;
        if (f === 'README.md') continue; // index, not a lore entry
        const path = join(dir, f);
        const name = f.replace(/\.md$/, '');
        const raw = readFileSync(path, 'utf8');
        const parsed = parseMarkdown(raw);
        entries.push({
          type,
          name,
          path,
          title: parsed.title,
          frontmatter: parsed.frontmatter,
          body: parsed.body,
        });
      }
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    this.cached = entries;
    return entries;
  }

  find(name: string): LoreEntry | null {
    for (const e of this.listAll()) {
      if (e.name === name) return e;
    }
    return null;
  }
}

interface ParsedMarkdown {
  readonly frontmatter: Readonly<Record<string, string>>;
  readonly title: string | null;
  readonly body: string;
}

/**
 * Minimal frontmatter parser. Supports `---\nkey: value\n---\n` at
 * the file head. Values are string-only (no nesting, no arrays).
 * Anything more complex falls through to the body unparsed — by
 * design, lore frontmatter is intentionally trivial.
 */
function parseMarkdown(raw: string): ParsedMarkdown {
  // Normalize line endings before any structural parsing. Files
  // checked out on Windows with `core.autocrlf=true` arrive as CRLF;
  // the frontmatter delimiter is matched as the literal `---\n`,
  // and `body.split('\n')` leaves trailing `\r` on every line which
  // confuses substring math even when individual regex tolerates it.
  // Stripping CRs once at the top makes every downstream check
  // platform-agnostic.
  raw = raw.replace(/\r\n/g, '\n');
  let body = raw;
  const frontmatter: Record<string, string> = {};
  if (raw.startsWith('---\n')) {
    const end = raw.indexOf('\n---\n', 4);
    if (end !== -1) {
      const fm = raw.slice(4, end);
      body = raw.slice(end + 5);
      for (const line of fm.split('\n')) {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (key) frontmatter[key] = value;
      }
    }
  }
  // First `# <title>` line, scanning only the first 20 lines so we
  // don't accidentally pick up an H1 deep inside a long file.
  let title: string | null = null;
  const lines = body.split('\n').slice(0, 20);
  for (const l of lines) {
    const m = l.match(/^#\s+(.+)$/);
    if (m) {
      title = m[1]!.trim();
      break;
    }
  }
  return { frontmatter, title, body };
}
