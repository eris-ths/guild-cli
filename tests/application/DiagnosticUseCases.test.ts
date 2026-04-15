// DiagnosticUseCases — application tests.
// Verify that:
//   1. clean repos produce an empty findings list and isClean=true
//   2. malformed records surface as findings tagged with the right area
//   3. classification heuristics map known onMalformed messages to kinds
//   4. totals reflect successfully hydrated records (not malformed ones)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DiagnosticUseCases,
  DiagnosticRepoBundle,
} from '../../src/application/diagnostic/DiagnosticUseCases.js';
import { OnMalformed } from '../../src/application/ports/OnMalformed.js';
import { MemberRepository } from '../../src/application/ports/MemberRepository.js';
import { RequestRepository } from '../../src/application/ports/RequestRepository.js';
import { IssueRepository } from '../../src/application/ports/IssueRepository.js';
import { Member } from '../../src/domain/member/Member.js';
import { MemberName } from '../../src/domain/member/MemberName.js';
import { Issue, IssueId, IssueState } from '../../src/domain/issue/Issue.js';
import { Request } from '../../src/domain/request/Request.js';
import { RequestId } from '../../src/domain/request/RequestId.js';
import { RequestState } from '../../src/domain/request/RequestState.js';

class FakeMemberRepo implements MemberRepository {
  constructor(
    private items: Member[],
    private malformedMessages: string[] = [],
  ) {}
  async findByName(_n: MemberName): Promise<Member | null> {
    return null;
  }
  async exists(_n: MemberName): Promise<boolean> {
    return false;
  }
  async listAll(): Promise<Member[]> {
    for (const m of this.malformedMessages) this.onMalformed?.(m);
    return this.items;
  }
  async save(_m: Member): Promise<void> {}
  async listHostNames(): Promise<string[]> {
    return [];
  }
  onMalformed?: OnMalformed;
}

class FakeRequestRepo implements RequestRepository {
  constructor(
    private items: Request[],
    private malformedMessages: string[] = [],
  ) {}
  async listByState(_s: RequestState): Promise<Request[]> {
    return [];
  }
  async listAll(): Promise<Request[]> {
    for (const m of this.malformedMessages) this.onMalformed?.(m);
    return this.items;
  }
  async findById(_id: RequestId): Promise<Request | null> {
    return null;
  }
  async save(_r: Request): Promise<void> {}
  async saveNew(_r: Request): Promise<void> {}
  async nextSequence(_d: string): Promise<number> {
    return 1;
  }
  onMalformed?: OnMalformed;
}

class FakeIssueRepo implements IssueRepository {
  constructor(
    private items: Issue[],
    private malformedMessages: string[] = [],
  ) {}
  async findById(_id: IssueId): Promise<Issue | null> {
    return null;
  }
  async listByState(_s: IssueState): Promise<Issue[]> {
    return [];
  }
  async listAll(): Promise<Issue[]> {
    for (const m of this.malformedMessages) this.onMalformed?.(m);
    return this.items;
  }
  async save(_i: Issue): Promise<void> {}
  async saveNew(_i: Issue): Promise<void> {}
  async nextSequence(_d: string): Promise<number> {
    return 1;
  }
  onMalformed?: OnMalformed;
}

function makeFactory(
  members: FakeMemberRepo,
  requests: FakeRequestRepo,
  issues: FakeIssueRepo,
): (om: OnMalformed) => DiagnosticRepoBundle {
  // Each call rebuilds the closure binding so DiagnosticUseCases'
  // per-area collector wiring works correctly.
  return (om: OnMalformed) => {
    members.onMalformed = om;
    requests.onMalformed = om;
    issues.onMalformed = om;
    return { members, requests, issues };
  };
}

function mkMember(name: string): Member {
  return Member.create({ name, category: 'professional' });
}
function mkIssue(id: string): Issue {
  return Issue.create({
    id: IssueId.of(id),
    from: 'eris',
    severity: 'low',
    area: 'test',
    text: id,
  });
}

test('DiagnosticUseCases.run: clean repos return isClean=true', async () => {
  const members = new FakeMemberRepo([mkMember('eris'), mkMember('noir')]);
  const requests = new FakeRequestRepo([]);
  const issues = new FakeIssueRepo([mkIssue('i-2026-04-15-0001')]);
  const uc = new DiagnosticUseCases(makeFactory(members, requests, issues));
  const report = await uc.run();
  assert.equal(report.isClean, true);
  assert.equal(report.findings.length, 0);
  assert.equal(report.summary.members.total, 2);
  assert.equal(report.summary.members.malformed, 0);
  assert.equal(report.summary.issues.total, 1);
});

test('DiagnosticUseCases.run: malformed messages surface tagged by area', async () => {
  const members = new FakeMemberRepo([], [
    'member eris.yaml: top-level YAML is not a mapping; skipping',
  ]);
  const requests = new FakeRequestRepo([], [
    'request 2026-04-15-0001.yaml: failed to hydrate (DomainError: Invalid id)',
  ]);
  const issues = new FakeIssueRepo([], [
    'issue i-bogus.yaml: top-level YAML is not a mapping; skipping',
    'issue dup: duplicate id detected during hydrate',
  ]);
  const uc = new DiagnosticUseCases(makeFactory(members, requests, issues));
  const report = await uc.run();
  assert.equal(report.isClean, false);
  assert.equal(report.findings.length, 4);

  const byArea = (a: string) =>
    report.findings.filter((f) => f.area === a);
  assert.equal(byArea('members').length, 1);
  assert.equal(byArea('requests').length, 1);
  assert.equal(byArea('issues').length, 2);
});

test('DiagnosticUseCases.run: classifyMessage maps known prefixes', async () => {
  const issues = new FakeIssueRepo([], [
    'issue a.yaml: top-level YAML is not a mapping; skipping',
    'issue b.yaml: failed to hydrate (DomainError: Invalid sequence)',
    'issue c.yaml: duplicate id collision',
    'issue d.yaml: something completely unexpected here',
  ]);
  const uc = new DiagnosticUseCases(
    makeFactory(new FakeMemberRepo([]), new FakeRequestRepo([]), issues),
  );
  const report = await uc.run();
  const kinds = report.findings.map((f) => f.kind);
  assert.deepEqual(kinds, [
    'top_level_not_mapping',
    'hydration_error',
    'duplicate_id',
    'unknown',
  ]);
});

test('DiagnosticUseCases.run: totals count successful hydrations only', async () => {
  // Hydrated items are returned as Member/Issue/Request instances;
  // malformed messages are reported separately and do NOT inflate totals.
  const members = new FakeMemberRepo(
    [mkMember('eris')],
    ['member broken.yaml: top-level YAML is not a mapping; skipping'],
  );
  const uc = new DiagnosticUseCases(
    makeFactory(members, new FakeRequestRepo([]), new FakeIssueRepo([])),
  );
  const report = await uc.run();
  assert.equal(report.summary.members.total, 1);
  assert.equal(report.summary.members.malformed, 1);
});

test('DiagnosticReport.toJSON: stable shape for future repair consumer', async () => {
  const issues = new FakeIssueRepo([mkIssue('i-2026-04-15-0001')], [
    'issue x.yaml: top-level YAML is not a mapping; skipping',
  ]);
  const uc = new DiagnosticUseCases(
    makeFactory(new FakeMemberRepo([]), new FakeRequestRepo([]), issues),
  );
  const report = await uc.run();
  const json = report.toJSON() as {
    summary: unknown;
    findings: { area: string; kind: string; message: string }[];
  };
  assert.ok(json.summary);
  assert.equal(json.findings.length, 1);
  assert.equal(json.findings[0]?.area, 'issues');
  assert.equal(json.findings[0]?.kind, 'top_level_not_mapping');
});
