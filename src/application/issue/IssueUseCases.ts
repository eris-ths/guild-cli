import {
  Issue,
  IssueId,
  IssueNote,
  IssueState,
  parseIssueState,
} from '../../domain/issue/Issue.js';
import { DomainError } from '../../domain/shared/DomainError.js';
import { compareSequenceIds } from '../../domain/shared/compareSequenceIds.js';
import {
  IssueRepository,
  IssueIdCollision,
} from '../ports/IssueRepository.js';
import { MemberRepository } from '../ports/MemberRepository.js';
import { Clock } from '../ports/Clock.js';
import { assertActor } from '../shared/assertActor.js';

export class IssueUseCases {
  constructor(
    private readonly issues: IssueRepository,
    private readonly members: MemberRepository,
    private readonly clock: Clock,
  ) {}

  async add(input: {
    from: string;
    severity: string;
    area: string;
    text: string;
  }): Promise<Issue> {
    await assertActor(input.from, '--from', this.members);
    const now = this.clock.now();
    const key = `${now.getUTCFullYear()}-${(now.getUTCMonth() + 1)
      .toString()
      .padStart(2, '0')}-${now.getUTCDate().toString().padStart(2, '0')}`;
    let seq = await this.issues.nextSequence(key);
    for (let attempt = 0; attempt < 10; attempt++) {
      const issue = Issue.create({
        id: IssueId.generate(now, seq),
        from: input.from,
        severity: input.severity,
        area: input.area,
        text: input.text,
        createdAt: now.toISOString(),
      });
      try {
        await this.issues.saveNew(issue);
        return issue;
      } catch (e) {
        if (e instanceof IssueIdCollision) {
          seq += 1;
          continue;
        }
        throw e;
      }
    }
    throw new Error('Failed to allocate issue id after 10 attempts');
  }

  async find(id: string): Promise<Issue | null> {
    return this.issues.findById(IssueId.of(id));
  }

  async list(state?: string): Promise<Issue[]> {
    const items =
      state === undefined
        ? await this.issues.listByState('open')
        : await this.issues.listByState(parseIssueState(state));
    return sortIssues(items);
  }

  /**
   * Return every issue regardless of state. Delegates to the repo.
   * Used by cross-cutting read commands (gate chain) that need the
   * full corpus without lifecycle filtering.
   */
  async listAll(): Promise<Issue[]> {
    return sortIssues(await this.issues.listAll());
  }

  async setState(id: string, state: string): Promise<Issue> {
    const issueId = IssueId.of(id);
    const issue = await this.issues.findById(issueId);
    if (!issue) throw new DomainError(`Issue not found: ${id}`, 'id');
    issue.setState(parseIssueState(state) as IssueState);
    await this.issues.save(issue);
    return issue;
  }

  /**
   * Append a note (free-form comment) to an existing issue. The issue's
   * original severity/area/text remain immutable — notes are the
   * mechanism for revised understanding, follow-up observations, or
   * cross-references without destroying the first-frame record.
   */
  async addNote(input: {
    id: string;
    by: string;
    text: string;
  }): Promise<{ issue: Issue; note: IssueNote }> {
    await assertActor(input.by, '--by', this.members);
    const issueId = IssueId.of(input.id);
    const issue = await this.issues.findById(issueId);
    if (!issue) throw new DomainError(`Issue not found: ${input.id}`, 'id');
    const note = issue.addNote(input.by, input.text, this.clock.now().toISOString());
    await this.issues.save(issue);
    return { issue, note };
  }
}

function sortIssues(items: Issue[]): Issue[] {
  return [...items].sort((a, b) => compareSequenceIds(a.id.value, b.id.value));
}
