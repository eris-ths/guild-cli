import {
  DevilReview,
  ReRunHistoryEntry,
  ResumeEntry,
  SuspensionEntry,
  Conclusion,
} from '../domain/DevilReview.js';
import { Entry } from '../domain/Entry.js';

/**
 * Port for devil-review session storage.
 *
 * Reviews live under `<content_root>/devil/reviews/<rev-id>.yaml`.
 * Flat layout (no game subdirectory) because reviews are
 * container-scoped — they don't belong to an agora Game; they
 * reference a target (PR / file / commit / function) that is
 * orthogonal to game definitions.
 *
 * Every mutating operation is optimistic-CAS (per principle 11):
 * concurrent appenders and re-runners surface a structured conflict
 * instead of silently overwriting. A re-entering instance reads the
 * substrate, sees a version mismatch, and re-loads — never loses
 * state to a race.
 */
export interface DevilReviewRepository {
  /** Find a review by id; null if absent. */
  findById(id: string): Promise<DevilReview | null>;
  /** Every review in the content_root. Sorted most-recent-first by id. */
  listAll(): Promise<DevilReview[]>;
  /** Allocate a fresh sequence for the given date (YYYY-MM-DD). */
  nextSequence(dateKey: string): Promise<number>;
  /** Create a brand-new review; throws DevilReviewIdCollision on duplicate. */
  saveNew(review: DevilReview): Promise<void>;

  /**
   * Append an entry. CAS on `expectedEntriesCount` (the load-time
   * entries.length); concurrent appenders surface a structured
   * DevilReviewVersionConflict.
   */
  appendEntry(
    review: DevilReview,
    expectedEntriesCount: number,
    entry: Entry,
  ): Promise<void>;

  /**
   * Replace an existing entry by id. Used by `dismiss` / `resolve`
   * which mutate the finding's status field. CAS on
   * `expectedEntriesCount` AND the target id existing at the same
   * index (caller passes both). The new entry must have the same id
   * as the one being replaced.
   */
  replaceEntry(
    review: DevilReview,
    expectedEntriesCount: number,
    targetEntryId: string,
    newEntry: Entry,
  ): Promise<void>;

  /** Append a suspension. CAS on suspensions.length. */
  appendSuspension(
    review: DevilReview,
    expectedSuspensionsCount: number,
    entry: SuspensionEntry,
  ): Promise<void>;

  /** Append a resume. CAS on resumes.length. */
  appendResume(
    review: DevilReview,
    expectedResumesCount: number,
    entry: ResumeEntry,
  ): Promise<void>;

  /** Append a re-run-history entry. CAS on re_run_history.length. */
  appendReRun(
    review: DevilReview,
    expectedReRunCount: number,
    entry: ReRunHistoryEntry,
  ): Promise<void>;

  /**
   * Save the conclusion and flip state from `open` to `concluded`.
   * `expectedState` (must be `open`) is checked against on-disk; a
   * concurrent conclude surfaces a DevilReviewVersionConflict.
   * Concluded is terminal — no further entries / suspensions /
   * resumes / re-runs after this returns.
   */
  saveConclusion(
    review: DevilReview,
    expectedState: 'open',
    conclusion: Conclusion,
  ): Promise<void>;

  /** Absolute path the given review would land at. */
  pathFor(reviewId: string): string;
}
