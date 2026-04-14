import { Issue, IssueId, IssueState } from '../../domain/issue/Issue.js';

export interface IssueRepository {
  findById(id: IssueId): Promise<Issue | null>;
  listByState(state: IssueState): Promise<Issue[]>;
  save(issue: Issue): Promise<void>;
  nextSequence(dateKey: string): Promise<number>;
}
