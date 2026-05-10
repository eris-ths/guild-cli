// devil-review — composed lense catalog (#134 G).
//
// Layout: bundled defaults from BundledLenseCatalog merged with
// per-content_root extensions read from `<content_root>/devil/lenses/
// <name>.yaml` (one file per lense). Each extension YAML follows the
// same shape as Lense.create's input (name/title/description/
// ingest_sources?/delegate?/examples?). Source provenance is pinned on
// every Lense so review records and `devil schema` can disambiguate.
//
// Policy (records-outlive-writers):
//   - extend-only. A name collision between bundled and extension is
//     a hard error at load time (LenseCollision). The fix is to pick
//     a distinct extension name (e.g. "security-strict") rather than
//     silently shadow the bundled meaning, since older review records
//     would otherwise become ambiguous to re-read.
//   - file-system errors (missing dir → no extensions; malformed YAML
//     or schema validation failure) route through onMalformed so
//     `gate doctor` can surface them. Loader does NOT crash the CLI;
//     a bad extension drops out of the catalog with a notice.

import { join } from 'node:path';
import { Lense, LenseCollision } from '../domain/Lense.js';
import { LenseCatalog } from '../application/LenseCatalog.js';
import { BundledLenseCatalog } from './BundledLenseCatalog.js';
import {
  existsSafe,
  listDirSafe,
  readTextSafe,
} from '../../../infrastructure/persistence/safeFs.js';
import { parseYamlSafe } from '../../../infrastructure/persistence/parseYamlSafe.js';
import { OnMalformed } from '../../../application/ports/OnMalformed.js';

const EXTENSIONS_SUBDIR = 'devil/lenses';

export class ComposedLenseCatalog implements LenseCatalog {
  private readonly map: ReadonlyMap<string, Lense>;
  private readonly order: readonly string[];

  /**
   * @param bundled the bundled defaults (canonical-order anchor)
   * @param extensions content_root-loaded extras (after bundled in name list)
   */
  private constructor(
    bundled: BundledLenseCatalog,
    extensions: readonly Lense[],
  ) {
    const m = new Map<string, Lense>();
    for (const l of bundled.list()) m.set(l.name, l);
    for (const ext of extensions) {
      // collisions among extensions surface here too (later wins is
      // not the policy — but the loader already enforces no-dup at
      // read time, so this is defense-in-depth).
      m.set(ext.name, ext);
    }
    this.map = m;
    this.order = [
      ...bundled.names(),
      ...extensions.map((e) => e.name),
    ];
  }

  /**
   * Load extensions from <contentRoot>/devil/lenses/*.yaml. Missing
   * directory → no extensions (same shape as gate handlers when
   * members/ is empty). Malformed files route via onMalformed.
   */
  static load(
    bundled: BundledLenseCatalog,
    contentRoot: string,
    onMalformed: OnMalformed,
  ): ComposedLenseCatalog {
    const dir = join(contentRoot, EXTENSIONS_SUBDIR);
    if (!existsSafe(contentRoot, dir)) {
      return new ComposedLenseCatalog(bundled, []);
    }
    const files = listDirSafe(contentRoot, dir)
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
      .sort(); // stable order, file-name lex
    const bundledNames = new Set(bundled.names());
    const extByName = new Map<string, Lense>();
    for (const f of files) {
      const path = join(dir, f);
      const text = readTextSafe(contentRoot, path);
      const parsed = parseYamlSafe(text, path, onMalformed);
      if (parsed === undefined) continue; // YAML parse error already reported
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        onMalformed(path, 'lense extension must be a YAML mapping (one lense per file)');
        continue;
      }
      const r = parsed as Record<string, unknown>;
      let lense: Lense;
      try {
        lense = Lense.create({
          name: r['name'] as string,
          title: r['title'] as string,
          description: r['description'] as string,
          ingest_sources: (r['ingest_sources'] as readonly string[] | undefined) ?? [],
          ...(r['delegate'] !== undefined ? { delegate: r['delegate'] as string } : {}),
          ...(r['examples'] !== undefined
            ? { examples: r['examples'] as readonly string[] }
            : {}),
          source: 'extension',
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        onMalformed(path, `lense schema failed: ${msg}`);
        continue;
      }
      if (bundledNames.has(lense.name)) {
        // Hard error — extend-only policy. The CLI surfaces this as a
        // startup failure rather than a doctor finding because silently
        // dropping an extension that the team explicitly authored would
        // mask the problem; the actor who edited the file expects the
        // failure to be loud.
        throw new LenseCollision(lense.name, path);
      }
      if (extByName.has(lense.name)) {
        // duplicate within extensions → also LenseCollision, with the
        // second-seen path so the message points at the offending file.
        throw new LenseCollision(lense.name, path);
      }
      extByName.set(lense.name, lense);
    }
    return new ComposedLenseCatalog(bundled, [...extByName.values()]);
  }

  list(): readonly Lense[] {
    return this.order.map((n) => this.map.get(n) as Lense);
  }

  find(name: string): Lense | null {
    return this.map.get(name) ?? null;
  }

  names(): readonly string[] {
    return this.order;
  }
}
