import { Issue, IssueId, IssueState } from '../../domain/issue/Issue.js';

export interface IssueRepository {
  findById(id: IssueId): Promise<Issue | null>;
  listByState(state: IssueState): Promise<Issue[]>;
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
