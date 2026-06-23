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
   * Supersede an older fact with a correction. Records a *new* fact whose
   * `supersedes` points back at `oldId`; the old record is left untouched
   * (immutable substrate). Throws SupersedeTargetMissing if the target id
   * has no record — a correction must point at something real, and a
   * dangling link would silently lose the correction's meaning.
   *
   * The domain guards shape + self-loop; existence is checked here because
   * only the application layer holds a repository. A chain is allowed
   * (B supersedes A, C supersedes B): each link names exactly one parent,
   * so the graph stays a forest and `latest` resolution walks it without
   * cycles — every node points strictly backward to an id that already
   * existed when it was written, so no cycle can form.
   */
  async supersede(input: {
    oldId: string;
    by: string;
    fact: string;
    tags?: readonly string[];
  }): Promise<Ctx> {
    const oldId = parseCtxId(input.oldId);
    const target = await this.repo.findById(oldId);
    if (target === null) {
      throw new SupersedeTargetMissing(oldId);
    }
    const now = this.now();
    const existing = await this.repo.listAllIds();
    const id = nextCtxId(existing, now);
    const ctx = Ctx.create({
      id,
      created_by: input.by,
      fact: input.fact,
      tags: input.tags ?? [],
      supersedes: oldId,
      now: () => now,
    });
    await this.repo.saveNew(ctx);
    return ctx;
  }

  /**
   * List recorded facts, newest first, optionally filtered by an exact
   * tag and/or author. Read-only.
   *
   * By default superseded facts are folded out (only the surviving head of
   * each supersession chain is shown), so the everyday list stays the
   * current view rather than drifting into a junk drawer. `includeAll`
   * keeps every fact, superseded ones included, for audit / history.
   */
  async list(
    filter: { tag?: string; by?: string; includeAll?: boolean } = {},
  ): Promise<readonly Ctx[]> {
    const all = [...(await this.repo.listAll())];
    // A fact is superseded iff some other fact's `supersedes` names it.
    const supersededIds = new Set<string>();
    for (const c of all) {
      if (c.supersedes !== undefined) supersededIds.add(c.supersedes);
    }
    let out = all;
    if (filter.includeAll !== true) {
      out = out.filter((c) => !supersededIds.has(c.id));
    }
    if (filter.tag !== undefined) {
      out = out.filter((c) => c.tags.includes(filter.tag!));
    }
    if (filter.by !== undefined) {
      out = out.filter((c) => c.created_by === filter.by);
    }
    // Newest first: created_at desc, id desc as a stable tiebreak.
    out.sort((a, b) =>
      a.created_at < b.created_at
        ? 1
        : a.created_at > b.created_at
          ? -1
          : a.id < b.id
            ? 1
            : a.id > b.id
              ? -1
              : 0,
    );
    return out;
  }

  /** Show a single fact by id, or null if absent. Read-only. */
  async show(id: string): Promise<Ctx | null> {
    return this.repo.findById(id);
  }

  /**
   * Find the fact that supersedes `id`, if any — the reverse of the
   * forward-only `supersedes` link. Read-only; returns null when `id` is
   * still the current head (nothing corrects it). Used by `show` to mark a
   * superseded fact with its successor.
   */
  async supersededBy(id: string): Promise<Ctx | null> {
    const all = await this.repo.listAll();
    for (const c of all) {
      if (c.supersedes === id) return c;
    }
    return null;
  }

  /**
   * Export every ctx fact as an OKF bundle under `dir`. Read-only over
   * the substrate (writes land outside `content_root`, in the chosen
   * bundle directory).
   */
  async exportOkf(input: { dir: string; force?: boolean }): Promise<OkfExportSummary> {
    const bundle = this.requireBundle();
    const facts = [...(await this.repo.listAll())].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    const docs = facts.map(ctxToOkfDocument);
    const res = await bundle.write(input.dir, docs, { force: input.force === true });
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
   * - Prose dedup (default on): a fact whose normalized prose already
   *   exists on the substrate — or appears twice in the same bundle — is
   *   skipped, so an id-less foreign bundle re-imported is also a no-op.
   *   `allowDuplicates` opts out for the rare deliberate re-record.
   */
  async importOkf(input: {
    dir: string;
    by: string;
    allowDuplicates?: boolean;
  }): Promise<OkfImportSummary> {
    const bundle = this.requireBundle();
    const { docs, skipped } = await bundle.read(input.dir);

    const existing = [...(await this.repo.listAllIds())];
    const now = this.now();
    const imported: OkfImportedFact[] = [];
    const allSkipped: OkfSkippedDoc[] = [...skipped];

    // Map normalized-prose -> the id that already carries it, so a
    // duplicate import is skipped *and* the skip reason can name the
    // record it duplicates. Built by hydrating the existing facts once
    // (import is a deliberate batch op, so the O(n) read is acceptable);
    // grows as the batch records new prose to catch in-bundle dups.
    const dedup = input.allowDuplicates ? false : true;
    const idByProse = new Map<string, string>();
    if (dedup) {
      for (const id of existing) {
        const ctx = await this.repo.findById(id);
        if (ctx !== null) idByProse.set(factDedupKey(ctx.fact), id);
      }
    }

    for (const doc of docs) {
      const mapped = okfDocumentToCtxFact(doc);
      if (mapped.kind === 'skip') {
        allSkipped.push({ path: doc.path, reason: mapped.reason });
        continue;
      }

      // Resolve the id. Preserve a well-formed guild id; allocate fresh
      // for missing/foreign ids. When a preserved id already exists,
      // distinguish a true round-trip (same prose -> idempotent skip)
      // from a foreign-id collision (different — or unreadable —
      // incumbent: don't drop the observation, allocate a fresh id).
      // Records-outlive-writers: a distinct fact must not be lost just
      // because a foreign bundle reused our `ctx-YYYY-MM-DD-NNN`
      // namespace. The incumbent is read on demand only on a collision,
      // so the common path stays a single id-set membership check.
      const proseKey = factDedupKey(mapped.fact);
      let id: string;
      const preserved = wellFormedCtxId(mapped.id);
      if (preserved !== null && existing.includes(preserved)) {
        const incumbent = await this.repo.findById(preserved);
        if (incumbent !== null && factDedupKey(incumbent.fact) === proseKey) {
          allSkipped.push({
            path: doc.path,
            reason: `id ${preserved} already present (idempotent skip)`,
          });
          continue;
        }
        id = nextCtxId(existing, now);
      } else if (preserved !== null) {
        id = preserved;
      } else {
        id = nextCtxId(existing, now);
      }

      // Prose dedup (after the id-match idempotent skip): a fact whose
      // normalized prose is already recorded — under any id — is a
      // duplicate observation. ctx records are immutable, so re-recording
      // the same prose adds noise rather than signal.
      if (dedup) {
        const dupId = idByProse.get(proseKey);
        if (dupId !== undefined) {
          allSkipped.push({
            path: doc.path,
            reason: `duplicate prose (already recorded as ${dupId})`,
          });
          continue;
        }
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
        if (dedup) idByProse.set(proseKey, ctx.id);
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

/**
 * Raised when `supersede` targets an id that has no record. A correction
 * must point at something real; a dangling link would silently strip the
 * correction of its referent. The interface layer maps this to a
 * recoverable not-found that names `ctx list` as the recovery path.
 */
export class SupersedeTargetMissing extends Error {
  constructor(public readonly id: string) {
    super(`ctx supersede target not found: ${id}`);
    this.name = 'SupersedeTargetMissing';
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

/**
 * Normalize fact prose into a dedup key: trim, then collapse internal
 * whitespace runs (including newlines) to a single space. Case is kept —
 * a case difference is treated as a distinct observation rather than
 * silently merged. Resilient to markdown re-wrapping, which is the
 * realistic source of "same fact, different bytes" across a round-trip.
 */
function factDedupKey(fact: string): string {
  return fact.trim().replace(/\s+/g, ' ');
}
