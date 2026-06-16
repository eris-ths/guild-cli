// FsOkfBundleRepository — filesystem adapter for OKF bundles.
//
// Implements OkfBundlePort. Writes go through safeFs (path containment,
// no-symlink-traversal); reads walk the bundle directory recursively so
// nested foreign bundles (e.g. `datasets/`, `tables/` subtrees) import,
// not just guild's own flat export. Symlinked directories are not
// followed — a hostile bundle can't redirect the walk outside `dir`.
//
// The generated `index.md` / `log.md` view files derive their timestamp
// from the concept set (latest fact), never from wall-clock `now`, so a
// re-export of the same facts is byte-identical.

import {
  existsSync,
  lstatSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import {
  OkfDocument,
  isReservedOkfFilename,
  assertOkfConformant,
} from '../../domain/okf/OkfDocument.js';
import {
  OkfBundlePort,
  OkfBundleReadResult,
  OkfBundleWriteResult,
  OkfBundleWriteOptions,
  OkfSkippedDoc,
} from '../../passages/ctx/application/OkfBundlePort.js';
import { OnMalformed } from '../../application/ports/OnMalformed.js';
import { DomainError } from '../../domain/shared/DomainError.js';
import {
  assertUnder,
  readTextSafe,
  writeTextSafe,
  MAX_DIR_ENTRIES,
} from '../persistence/safeFs.js';
import { serializeOkfDocument, parseOkfDocument } from './OkfFrontmatter.js';

export class FsOkfBundleRepository implements OkfBundlePort {
  constructor(private readonly onMalformed: OnMalformed) {}

  async write(
    dir: string,
    docs: readonly OkfDocument[],
    opts: OkfBundleWriteOptions = {},
  ): Promise<OkfBundleWriteResult> {
    // Overwrite guard: refuse to write into a non-empty directory unless
    // forced, so an export can't silently clobber an unrelated tree (its
    // own index.md / log.md / colliding <id>.md). An absent or empty dir
    // is created by the writes below.
    const baseAbs = assertUnder(dir, '.');
    if (existsSync(baseAbs)) {
      if (!statSync(baseAbs).isDirectory()) {
        throw new DomainError(
          `export target ${dir} exists and is not a directory`,
          'dir',
        );
      }
      if (!opts.force && readdirSync(baseAbs).length > 0) {
        throw new DomainError(
          `export target ${dir} is not empty; pass --force to overwrite`,
          'dir',
        );
      }
    }

    const written: string[] = [];
    const sorted = [...docs].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    for (const doc of sorted) {
      assertOkfConformant(doc);
      writeTextSafe(dir, doc.path, serializeOkfDocument(doc));
      written.push(doc.path);
    }

    writeTextSafe(dir, 'index.md', serializeOkfDocument(buildIndex(sorted)));
    written.push('index.md');
    writeTextSafe(dir, 'log.md', serializeOkfDocument(buildLog(sorted)));
    written.push('log.md');

    return { written };
  }

  async read(dir: string): Promise<OkfBundleReadResult> {
    const baseAbs = assertUnder(dir, '.');
    if (!existsSync(baseAbs)) {
      return { docs: [], skipped: [] };
    }
    if (!statSync(baseAbs).isDirectory()) {
      throw new DomainError(`OKF bundle path is not a directory: ${dir}`, 'dir');
    }

    const rels = this.collectMdFiles(baseAbs, '').sort();
    const docs: OkfDocument[] = [];
    const skipped: OkfSkippedDoc[] = [];

    for (const rel of rels) {
      if (isReservedOkfFilename(basename(rel))) continue; // generated views

      const text = readTextSafe(dir, rel);
      const source = join(baseAbs, rel);
      // Capture a frontmatter parse failure for this one file: a
      // corrupt frontmatter is a real signal, so the document is
      // reported as skipped rather than half-imported.
      let failure: string | null = null;
      const capture: OnMalformed = (src, msg) => {
        failure = msg;
        this.onMalformed(src, msg);
      };
      const doc = parseOkfDocument(rel, text, source, capture);
      if (failure !== null) {
        skipped.push({ path: rel, reason: failure });
      } else {
        docs.push(doc);
      }
    }

    return { docs, skipped };
  }

  /**
   * Recursively collect relative paths of `.md` files under `relDir`.
   * Symlinks (file or directory) are skipped — the walk never leaves the
   * bundle root. Entries are bounded by MAX_DIR_ENTRIES per directory to
   * mirror the substrate's oversized-directory guard.
   */
  private collectMdFiles(baseAbs: string, relDir: string): string[] {
    const dirAbs = relDir === '' ? baseAbs : join(baseAbs, relDir);
    const entries = readdirSync(dirAbs, { withFileTypes: true });
    if (entries.length > MAX_DIR_ENTRIES) {
      throw new DomainError(
        `OKF bundle directory exceeds ${MAX_DIR_ENTRIES} entries: ${dirAbs}`,
        'dir',
      );
    }
    const out: string[] = [];
    for (const entry of entries) {
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      // Defeat symlink traversal explicitly (Dirent.isSymbolicLink is
      // set from lstat, but re-confirm to be robust across node versions).
      if (lstatSync(join(baseAbs, rel)).isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        out.push(...this.collectMdFiles(baseAbs, rel));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push(rel);
      }
    }
    return out;
  }
}

/** First non-empty line of `body`, collapsed and truncated for a view. */
function snippet(body: string, max = 80): string {
  const line = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('#'));
  if (line === undefined) return '';
  const collapsed = line.replace(/\s+/g, ' ');
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

/** Bundle id (file stem) for a concept document. */
function conceptId(doc: OkfDocument): string {
  return basename(doc.path).replace(/\.md$/, '');
}

/** Latest `timestamp` across the concept set, or undefined if none. */
function latestTimestamp(docs: readonly OkfDocument[]): string | undefined {
  let latest: string | undefined;
  for (const d of docs) {
    const t = d.frontmatter.timestamp;
    if (typeof t === 'string' && (latest === undefined || t > latest)) latest = t;
  }
  return latest;
}

function buildIndex(docs: readonly OkfDocument[]): OkfDocument {
  const lines = docs.map((d) => {
    const id = conceptId(d);
    const snip = snippet(d.body);
    return snip ? `- [${id}](${d.path}) — ${snip}` : `- [${id}](${d.path})`;
  });
  const body = `# Index\n\n${docs.length} concept${docs.length === 1 ? '' : 's'}.\n\n${lines.join('\n')}`;
  const frontmatter: OkfDocument['frontmatter'] = {
    type: 'Index',
    title: 'ctx facts',
    description: `${docs.length} fact${docs.length === 1 ? '' : 's'} exported from the guild substrate.`,
  };
  const ts = latestTimestamp(docs);
  if (ts !== undefined) frontmatter.timestamp = ts;
  return { path: 'index.md', frontmatter, body };
}

function buildLog(docs: readonly OkfDocument[]): OkfDocument {
  const dated = docs
    .map((d) => ({
      id: conceptId(d),
      path: d.path,
      ts: typeof d.frontmatter.timestamp === 'string' ? d.frontmatter.timestamp : '',
    }))
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const lines = dated.map((d) => `- ${d.ts || '(no timestamp)'} — [${d.id}](${d.path})`);
  const body = `# Log\n\nChronological record of exported concepts.\n\n${lines.join('\n')}`;
  const frontmatter: OkfDocument['frontmatter'] = { type: 'Log', title: 'ctx log' };
  const ts = latestTimestamp(docs);
  if (ts !== undefined) frontmatter.timestamp = ts;
  return { path: 'log.md', frontmatter, body };
}
