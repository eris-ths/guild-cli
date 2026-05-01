import { Issue, IssueId, IssueState } from '../../domain/issue/Issue.js';
import { UnrecognizedRecordEntry } from './UnrecognizedRecordEntry.js';

export interface IssueRepository {
  findById(id: IssueId): Promise<Issue | null>;
  listByState(state: IssueState): Promise<Issue[]>;
  /**
   * List every issue regardless of state. Issues are stored in a
   * single flat directory (unlike requests which are split by
   * state), so this is a single scan — used by cross-cutting read
   * commands (gate chain) that need the full corpus.
   */
  listAll(): Promise<Issue[]>;
  /**
   * Walk the issues directory and surface entries that don't match
   * the expected layout — .yaml files whose name doesn't match the
   * `i-YYYY-MM-DD-NNNN.yaml` pattern (silent listAll drops) and
   * subdirectories (issues is a flat layout; nested dirs have no
   * legitimate place). Used exclusively by the diagnostic.
   */
  listUnrecognizedFiles(): Promise<UnrecognizedRecordEntry[]>;
  save(issue: Issue): Promise<void>;
  /**
   * Create a brand-new issue file. Must fail with `IssueIdCollision` if
   * a file for this id already exists — callers rely on the error to
   * drive sequence-allocation retry.
   */
  saveNew(issue: Issue): Promise<void>;
  nextSequence(dateKey: string): Promise<number>;
}

export class IssueIdCollision extends Error {
  constructor(id: string) {
    super(`Issue id already exists: ${id}`);
    this.name = 'IssueIdCollision';
  }
}

/**
 * Thrown when a concurrent writer advanced the on-disk version of
 * an issue between the moment we loaded it and the moment we tried
 * to save it back. Parallels `RequestVersionConflict` and
 * `InboxVersionConflict` — same optimistic-lock pattern, one
 * invariant per record class.
 *
 * Before this existed, two concurrent `gate issues resolve` /
 * `gate issues note` calls could last-writer-wins, dropping the
 * earlier state_log entry or note silently — which self-defeats
 * the Issue audit trail invariant that state_log is append-only.
 */
export class IssueVersionConflict extends Error {
  readonly code = 'ISSUE_VERSION_CONFLICT' as const;
  constructor(
    readonly id: string,
    readonly expected: number,
    readonly found: number,
  ) {
    super(
      `issue ${id} was modified concurrently ` +
        `(expected version ${expected}, found ${found}). ` +
        `Re-run the command to retry.`,
    );
    this.name = 'IssueVersionConflict';
  }
}
