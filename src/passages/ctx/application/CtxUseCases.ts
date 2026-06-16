import { Ctx, CtxIdCollision, nextCtxId, parseCtxId } from '../domain/Ctx.js';
import { CtxRepository } from './CtxRepository.js';
import { OkfBundlePort, OkfSkippedDoc } from './OkfBundlePort.js';
import { ctxToOkfDocument, okfDocumentToCtxFact } from './OkfCtxMapper.js';

/** Summary of an OKF export. */
export interface OkfExportSummary {
  readonly written: readonly string[];
  readonly count: number;
}

/** One fact created by an import. */
export interface OkfImportedFact {
  readonly id: string;
  readonly path: string;
}

/** Summary of an OKF import. */
export interface OkfImportSummary {
  readonly imported: readonly OkfImportedFact[];
  readonly skipped: readonly OkfSkippedDoc[];
}

/**
 * ctx use cases. Phase 1 shipped `record`; this adds the OKF interop
 * pair (`export` / `import`). The phase-2 lifecycle verbs (fork /
 * supersede / show / list / chain / status) remain separate.
 *
 * `now` is injected so tests can pin time and so id-generation and
 * timestamp authorship stay consistent within a single record. The OKF
 * bundle port is optional in the constructor only so existing
 * record-only wiring/tests need not supply it; the export/import paths
 * assert it is present.
 */
export class CtxUseCases {
  constructor(
    private readonly repo: CtxRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly bundle?: OkfBundlePort,
  ) {}

  async record(input: {
    by: string;
    fact: string;
    tags?: readonly string[];
  }): Promise<Ctx> {
    const now = this.now();
    const existing = await this.repo.listAllIds();
    const id = nextCtxId(existing, now);
    const ctx = Ctx.create({
      id,
      created_by: input.by,
      fact: input.fact,
      tags: input.tags ?? [],
      now: () => now,
    });
    await this.repo.saveNew(ctx);
    return ctx;
  }

  /**
   * Export every ctx fact as an OKF bundle under `dir`. Read-only over
   * the substrate (writes land outside `content_root`, in the chosen
   * bundle directory).
   */
  async exportOkf(input: { dir: string }): Promise<OkfExportSummary> {
    const bundle = this.requireBundle();
    const ids = [...(await this.repo.listAllIds())].sort();
    const docs = [];
    for (const id of ids) {
      const ctx = await this.repo.findById(id);
      if (ctx !== null) docs.push(ctxToOkfDocument(ctx));
    }
    const res = await bundle.write(input.dir, docs);
    return { written: res.written, count: docs.length };
  }

  /**
   * Import an OKF bundle from `dir` as ctx facts.
   *
   * - A guild-authored bundle round-trips: the `id` frontmatter is
   *   preserved, so re-importing the same bundle is idempotent (existing
   *   ids skip) and the original timestamp/author/tags are restored.
   * - A foreign bundle imports tolerantly: a missing/foreign id gets a
   *   fresh allocation; missing author falls back to `input.by`; a
   *   non-`Fact` type and non-conformant tags are preserved as tags.
   */
  async importOkf(input: { dir: string; by: string }): Promise<OkfImportSummary> {
    const bundle = this.requireBundle();
    const { docs, skipped } = await bundle.read(input.dir);

    const existing = [...(await this.repo.listAllIds())];
    const now = this.now();
    const imported: OkfImportedFact[] = [];
    const allSkipped: OkfSkippedDoc[] = [...skipped];

    for (const doc of docs) {
      const mapped = okfDocumentToCtxFact(doc);
      if (mapped.kind === 'skip') {
        allSkipped.push({ path: doc.path, reason: mapped.reason });
        continue;
      }

      // Resolve the id: preserve a well-formed guild id (idempotent skip
      // if it already exists); allocate fresh for missing/foreign ids.
      let id: string;
      const preserved = wellFormedCtxId(mapped.id);
      if (preserved !== null) {
        if (existing.includes(preserved)) {
          allSkipped.push({
            path: doc.path,
            reason: `id ${preserved} already present (idempotent skip)`,
          });
          continue;
        }
        id = preserved;
      } else {
        id = nextCtxId(existing, now);
      }

      // Preserve the original timestamp when present and parseable.
      const ts =
        mapped.created_at !== undefined && !Number.isNaN(Date.parse(mapped.created_at))
          ? mapped.created_at
          : undefined;
      const ctxNow = ts !== undefined ? () => new Date(ts) : () => now;
      const created_by = mapped.created_by ?? input.by;

      let ctx: Ctx;
      try {
        ctx = Ctx.create({
          id,
          fact: mapped.fact,
          created_by,
          tags: mapped.tags,
          now: ctxNow,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        allSkipped.push({ path: doc.path, reason: `could not record: ${msg}` });
        continue;
      }

      try {
        await this.repo.saveNew(ctx);
        existing.push(id);
        imported.push({ id: ctx.id, path: doc.path });
      } catch (e) {
        if (e instanceof CtxIdCollision) {
          allSkipped.push({
            path: doc.path,
            reason: `id ${id} already present (idempotent skip)`,
          });
        } else {
          throw e;
        }
      }
    }

    return { imported, skipped: allSkipped };
  }

  private requireBundle(): OkfBundlePort {
    if (this.bundle === undefined) {
      throw new Error('ctx OKF use cases require an OkfBundlePort (wiring bug)');
    }
    return this.bundle;
  }
}

/** Return `raw` if it is a well-formed ctx id, else null. */
function wellFormedCtxId(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  try {
    return parseCtxId(raw);
  } catch {
    return null;
  }
}
