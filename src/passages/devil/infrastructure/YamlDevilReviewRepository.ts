import YAML from 'yaml';
import { join } from 'node:path';
import {
  Conclusion,
  DevilReview,
  DevilReviewIdCollision,
  DevilReviewVersionConflict,
  ReRunHistoryEntry,
  ResumeEntry,
  SuspensionEntry,
  parseReviewId,
} from '../domain/DevilReview.js';
import { Entry, parseEntryId } from '../domain/Entry.js';
import { DevilReviewRepository } from '../application/DevilReviewRepository.js';
import { GuildConfig } from '../../../infrastructure/config/GuildConfig.js';
import {
  existsSafe,
  listDirSafe,
  readTextSafe,
  writeTextSafe,
  writeTextSafeAtomic,
} from '../../../infrastructure/persistence/safeFs.js';
import { parseYamlSafe } from '../../../infrastructure/persistence/parseYamlSafe.js';

/**
 * devil-review YAML adapter.
 *
 * Layout: <content_root>/devil/reviews/<rev-id>.yaml
 *
 * Flat under reviews/ — no game subdir like agora's plays/. Reviews
 * target arbitrary refs (PRs, files, commits) and don't belong to a
 * higher-level grouping in v0. If a future organizational axis
 * surfaces (per-target-repo? per-author?), it can be added without
 * breaking the path shape — one rev-id maps to one file.
 *
 * Every mutating operation writes via writeTextSafeAtomic so readers
 * never see a torn file. Optimistic CAS on the relevant array length
 * (or `state` for conclude) protects against silent overwrite when
 * concurrent appenders hit the same review.
 */
const REVIEWS_DIR = 'reviews';
const REVIEW_FILE_PATTERN = /^rev-\d{4}-\d{2}-\d{2}-\d{3,4}\.yaml$/;

type AppendField = 'entries' | 'suspensions' | 'resumes' | 're_run_history';

export class YamlDevilReviewRepository implements DevilReviewRepository {
  private readonly base: string;

  constructor(private readonly config: GuildConfig) {
    this.base = join(this.config.contentRoot, 'devil');
  }

  pathFor(reviewId: string): string {
    parseReviewId(reviewId);
    return join(this.base, REVIEWS_DIR, `${reviewId}.yaml`);
  }

  async findById(id: string): Promise<DevilReview | null> {
    parseReviewId(id);
    const rel = join(REVIEWS_DIR, `${id}.yaml`);
    if (!existsSafe(this.base, rel)) return null;
    return this.loadFromRel(rel);
  }

  async listAll(): Promise<DevilReview[]> {
    const out: DevilReview[] = [];
    const files = listDirSafe(this.base, REVIEWS_DIR);
    for (const f of files) {
      if (!REVIEW_FILE_PATTERN.test(f)) continue;
      const rel = join(REVIEWS_DIR, f);
      const r = this.loadFromRel(rel);
      if (r) out.push(r);
    }
    // Most-recent-first by id (rev-YYYY-MM-DD-NNN sorts chronological).
    out.sort((a, b) => b.id.localeCompare(a.id));
    return out;
  }

  async nextSequence(dateKey: string): Promise<number> {
    let max = 0;
    for (const f of listDirSafe(this.base, REVIEWS_DIR)) {
      const m = f.match(/^rev-(\d{4}-\d{2}-\d{2})-(\d{3,4})\.yaml$/);
      if (m && m[1] === dateKey) {
        const n = parseInt(m[2] as string, 10);
        if (n > max) max = n;
      }
    }
    return max + 1;
  }

  async saveNew(review: DevilReview): Promise<void> {
    const rel = join(REVIEWS_DIR, `${review.id}.yaml`);
    if (existsSafe(this.base, rel)) {
      throw new DevilReviewIdCollision(review.id);
    }
    const text = YAML.stringify(review.toJSON());
    try {
      writeTextSafe(this.base, rel, text, { createOnly: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new DevilReviewIdCollision(review.id);
      }
      throw e;
    }
  }

  async appendEntry(
    review: DevilReview,
    expectedEntriesCount: number,
    entry: Entry,
  ): Promise<void> {
    await this.appendArrayWithCAS(
      review,
      'entries',
      expectedEntriesCount,
      entry.toJSON(),
    );
  }

  async replaceEntry(
    review: DevilReview,
    expectedEntriesCount: number,
    targetEntryId: string,
    newEntry: Entry,
  ): Promise<void> {
    parseEntryId(targetEntryId);
    if (newEntry.id !== targetEntryId) {
      throw new Error(
        `replaceEntry: newEntry.id "${newEntry.id}" must match targetEntryId "${targetEntryId}"`,
      );
    }
    parseReviewId(review.id);
    const rel = join(REVIEWS_DIR, `${review.id}.yaml`);
    if (!existsSafe(this.base, rel)) {
      throw new DevilReviewVersionConflict(
        review.id,
        'entries',
        expectedEntriesCount,
        0,
      );
    }
    const obj = this.readForCAS(rel, review.id, 'entries', expectedEntriesCount);
    if (obj['state'] === 'concluded') {
      throw new DevilReviewVersionConflict(
        review.id,
        'entries',
        expectedEntriesCount,
        expectedEntriesCount, // counts match but state forbids mutation
      );
    }
    const entriesArr = Array.isArray(obj['entries'])
      ? (obj['entries'] as Record<string, unknown>[])
      : [];
    if (entriesArr.length !== expectedEntriesCount) {
      throw new DevilReviewVersionConflict(
        review.id,
        'entries',
        expectedEntriesCount,
        entriesArr.length,
      );
    }
    const idx = entriesArr.findIndex((e) => e['id'] === targetEntryId);
    if (idx === -1) {
      throw new DevilReviewVersionConflict(
        review.id,
        'entries',
        expectedEntriesCount,
        entriesArr.length,
      );
    }
    const updatedEntries = [...entriesArr];
    updatedEntries[idx] = newEntry.toJSON();
    const updated: Record<string, unknown> = {
      ...obj,
      entries: updatedEntries,
    };
    writeTextSafeAtomic(this.base, rel, YAML.stringify(updated));
  }

  async appendSuspension(
    review: DevilReview,
    expectedSuspensionsCount: number,
    entry: SuspensionEntry,
  ): Promise<void> {
    await this.appendArrayWithCAS(
      review,
      'suspensions',
      expectedSuspensionsCount,
      { ...entry } as Record<string, unknown>,
    );
  }

  async appendResume(
    review: DevilReview,
    expectedResumesCount: number,
    entry: ResumeEntry,
  ): Promise<void> {
    await this.appendArrayWithCAS(
      review,
      'resumes',
      expectedResumesCount,
      { ...entry } as Record<string, unknown>,
    );
  }

  async appendReRun(
    review: DevilReview,
    expectedReRunCount: number,
    entry: ReRunHistoryEntry,
  ): Promise<void> {
    await this.appendArrayWithCAS(
      review,
      're_run_history',
      expectedReRunCount,
      { ...entry } as Record<string, unknown>,
    );
  }

  async saveConclusion(
    review: DevilReview,
    expectedState: 'open',
    conclusion: Conclusion,
  ): Promise<void> {
    parseReviewId(review.id);
    const rel = join(REVIEWS_DIR, `${review.id}.yaml`);
    if (!existsSafe(this.base, rel)) {
      throw new DevilReviewVersionConflict(review.id, 'entries', 1, 0);
    }
    const raw = readTextSafe(this.base, rel);
    const parsed = parseYamlSafe(
      raw,
      join(this.base, rel),
      this.config.onMalformed,
    );
    if (parsed === undefined || parsed === null || typeof parsed !== 'object') {
      throw new DevilReviewVersionConflict(review.id, 'entries', 1, 0);
    }
    const obj = parsed as Record<string, unknown>;
    // CAS on state: we expect 'open'; anything else (concurrent
    // conclude) surfaces as a version conflict on the entries field
    // (we don't have a state-specific conflict shape in v0).
    if (obj['state'] !== expectedState) {
      throw new DevilReviewVersionConflict(review.id, 'entries', 1, 0);
    }
    const updated: Record<string, unknown> = {
      ...obj,
      state: 'concluded',
      conclusion: {
        at: conclusion.at,
        by: conclusion.by,
        synthesis: conclusion.synthesis,
        unresolved: [...conclusion.unresolved],
      },
    };
    writeTextSafeAtomic(this.base, rel, YAML.stringify(updated));
  }

  // ---- internals --------------------------------------------------------

  private loadFromRel(rel: string): DevilReview | null {
    const raw = readTextSafe(this.base, rel);
    const absSource = join(this.base, rel);
    const parsed = parseYamlSafe(raw, absSource, this.config.onMalformed);
    if (parsed === undefined) return null;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.config.onMalformed(
        absSource,
        'top-level YAML is not a mapping; skipping',
      );
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    try {
      return DevilReview.restore({
        id: typeof obj['id'] === 'string' ? (obj['id'] as string) : '',
        target: (obj['target'] ?? {}) as never,
        state: (typeof obj['state'] === 'string' ? obj['state'] : 'open') as never,
        opened_at:
          typeof obj['opened_at'] === 'string'
            ? (obj['opened_at'] as string)
            : new Date().toISOString(),
        opened_by:
          typeof obj['opened_by'] === 'string'
            ? (obj['opened_by'] as string)
            : 'unknown',
        entries: (Array.isArray(obj['entries'])
          ? (obj['entries'] as unknown[])
          : []) as never,
        suspensions: (Array.isArray(obj['suspensions'])
          ? (obj['suspensions'] as unknown[])
          : []) as never,
        resumes: (Array.isArray(obj['resumes'])
          ? (obj['resumes'] as unknown[])
          : []) as never,
        re_run_history: (Array.isArray(obj['re_run_history'])
          ? (obj['re_run_history'] as unknown[])
          : []) as never,
        ...(obj['conclusion'] !== undefined
          ? { conclusion: obj['conclusion'] as never }
          : {}),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.config.onMalformed(absSource, `hydrate failed, skipping: ${msg}`);
      return null;
    }
  }

  /**
   * Read on-disk YAML and run pre-CAS validation. Throws
   * DevilReviewVersionConflict if missing/malformed/concluded/count
   * mismatch. Returns the parsed object on success so the caller can
   * proceed with the append.
   */
  private readForCAS(
    rel: string,
    reviewId: string,
    field: AppendField,
    expectedCount: number,
  ): Record<string, unknown> {
    const raw = readTextSafe(this.base, rel);
    const parsed = parseYamlSafe(
      raw,
      join(this.base, rel),
      this.config.onMalformed,
    );
    if (parsed === undefined || parsed === null || typeof parsed !== 'object') {
      throw new DevilReviewVersionConflict(reviewId, field, expectedCount, 0);
    }
    return parsed as Record<string, unknown>;
  }

  /**
   * Shared append-with-CAS helper for entries / suspensions /
   * resumes / re_run_history. Re-reads the on-disk file, checks the
   * named array's length matches `expectedCount`, refuses if state
   * is `concluded` (terminal), appends the entry, atomic-writes back.
   *
   * Per principle 11 (AI-natural): re-entering instances detect
   * concurrent appenders rather than silently overwrite.
   */
  private async appendArrayWithCAS(
    review: DevilReview,
    field: AppendField,
    expectedCount: number,
    entryJson: Record<string, unknown>,
  ): Promise<void> {
    parseReviewId(review.id);
    const rel = join(REVIEWS_DIR, `${review.id}.yaml`);
    if (!existsSafe(this.base, rel)) {
      throw new DevilReviewVersionConflict(review.id, field, expectedCount, 0);
    }
    const obj = this.readForCAS(rel, review.id, field, expectedCount);
    if (obj['state'] === 'concluded') {
      // Concluded is terminal — surface as a count mismatch (caller
      // sees a version conflict and re-loads, will then see state
      // and refuse at the use-case layer with DevilReviewAlreadyConcluded).
      throw new DevilReviewVersionConflict(
        review.id,
        field,
        expectedCount,
        expectedCount,
      );
    }
    const onDiskCount = Array.isArray(obj[field])
      ? (obj[field] as unknown[]).length
      : 0;
    if (onDiskCount !== expectedCount) {
      throw new DevilReviewVersionConflict(
        review.id,
        field,
        expectedCount,
        onDiskCount,
      );
    }
    const updated: Record<string, unknown> = {
      ...obj,
      [field]: [
        ...(Array.isArray(obj[field]) ? (obj[field] as unknown[]) : []),
        entryJson,
      ],
    };
    writeTextSafeAtomic(this.base, rel, YAML.stringify(updated));
  }
}
