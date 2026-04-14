import {
  Issue,
  IssueId,
  IssueState,
  parseIssueState,
} from '../../domain/issue/Issue.js';
import { DomainError } from '../../domain/shared/DomainError.js';
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
    if (state === undefined) {
      return this.issues.listByState('open');
    }
    return this.issues.listByState(parseIssueState(state));
  }

  async setState(id: string, state: string): Promise<Issue> {
    const issueId = IssueId.of(id);
    const issue = await this.issues.findById(issueId);
    if (!issue) throw new DomainError(`Issue not found: ${id}`, 'id');
    issue.setState(parseIssueState(state) as IssueState);
    await this.issues.save(issue);
    return issue;
  }
}
