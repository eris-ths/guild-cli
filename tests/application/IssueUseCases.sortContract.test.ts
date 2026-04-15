// D1 contract test (noir devil review on req 2026-04-15-0008):
// IssueUseCases.list / listAll must guarantee numeric-aware sort
// regardless of repository return order. Without this test, the
// "application sorts" boundary is convention only — a future refactor
// could quietly bypass it (i-2026-04-15-0014 risk).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IssueUseCases } from '../../src/application/issue/IssueUseCases.js';
import { Issue, IssueId, IssueState } from '../../src/domain/issue/Issue.js';
import { MemberName } from '../../src/domain/member/MemberName.js';
import { Member } from '../../src/domain/member/Member.js';
import {
  IssueRepository,
} from '../../src/application/ports/IssueRepository.js';
import { MemberRepository } from '../../src/application/ports/MemberRepository.js';
import { Clock } from '../../src/application/ports/Clock.js';

class ShuffledIssueRepo implements IssueRepository {
  constructor(private items: Issue[]) {}
  async findById(id: IssueId): Promise<Issue | null> {
    return this.items.find((i) => i.id.value === id.value) ?? null;
  }
  async listByState(state: IssueState): Promise<Issue[]> {
    // Return in deliberately wrong order to prove the UseCase sorts.
    return [...this.items].filter((i) => i.toJSON()['state'] === state);
  }
  async listAll(): Promise<Issue[]> {
    return [...this.items];
  }
  async save(_i: Issue): Promise<void> {}
  async saveNew(_i: Issue): Promise<void> {}
  async nextSequence(_d: string): Promise<number> {
    return 1;
  }
}

class StubMemberRepo implements MemberRepository {
  async findByName(name: MemberName): Promise<Member | null> {
    return Member.create({ name: name.value, category: 'professional' });
  }
  async exists(_n: MemberName): Promise<boolean> {
    return true;
  }
  async listAll(): Promise<Member[]> {
    return [];
  }
  async save(_m: Member): Promise<void> {}
  async listHostNames(): Promise<string[]> {
    return [];
  }
}

class FixedClock implements Clock {
  now(): Date {
    return new Date('2026-04-15T00:00:00Z');
  }
}

function mkIssue(idStr: string): Issue {
  return Issue.create({
    id: IssueId.of(idStr),
    from: 'eris',
    severity: 'low',
    area: 'test',
    text: idStr,
  });
}

test('IssueUseCases.list returns numeric-aware sorted order (mixed widths)', async () => {
  // Deliberately shuffled, mixed 3-digit / 4-digit, multiple dates.
  const repo = new ShuffledIssueRepo([
    mkIssue('i-2026-04-15-0011'),
    mkIssue('i-2026-04-15-002'),
    mkIssue('i-2026-04-14-0099'),
    mkIssue('i-2026-04-15-001'),
    mkIssue('i-2026-04-15-0020'),
    mkIssue('i-2026-04-15-009'),
  ]);
  const uc = new IssueUseCases(repo, new StubMemberRepo(), new FixedClock());
  const out = await uc.list();
  assert.deepEqual(
    out.map((i) => i.id.value),
    [
      'i-2026-04-14-0099',
      'i-2026-04-15-001',
      'i-2026-04-15-002',
      'i-2026-04-15-009',
      'i-2026-04-15-0011',
      'i-2026-04-15-0020',
    ],
  );
});

test('IssueUseCases.listAll also enforces numeric-aware sort', async () => {
  const repo = new ShuffledIssueRepo([
    mkIssue('i-2026-04-15-0011'),
    mkIssue('i-2026-04-15-001'),
    mkIssue('i-2026-04-15-002'),
  ]);
  const uc = new IssueUseCases(repo, new StubMemberRepo(), new FixedClock());
  const out = await uc.listAll();
  assert.deepEqual(
    out.map((i) => i.id.value),
    ['i-2026-04-15-001', 'i-2026-04-15-002', 'i-2026-04-15-0011'],
  );
});
