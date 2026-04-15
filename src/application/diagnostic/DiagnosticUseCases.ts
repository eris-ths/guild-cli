// DiagnosticUseCases — observation layer for `gate doctor`.
//
// The application layer assembles a fresh set of repositories with a
// *collecting* onMalformed callback, drives every listAll, and
// returns a DiagnosticReport. We deliberately do NOT use the shared
// container's repos: those are wired with stderr-emitting callbacks
// for normal CLI flows, and we want diagnostic to capture findings
// without spamming stderr a second time.
//
// The injector is a closure that builds three repos for a given
// onMalformed. Tests inject fakes; the production wiring uses
// GuildConfig.load(cwd, collector). This keeps the application layer
// pure (no infra import) and the production wiring a one-liner.

import { MemberRepository } from '../ports/MemberRepository.js';
import { RequestRepository } from '../ports/RequestRepository.js';
import { IssueRepository } from '../ports/IssueRepository.js';
import { OnMalformed } from '../ports/OnMalformed.js';
import {
  DiagnosticArea,
  DiagnosticFinding,
  DiagnosticReport,
  classifyMessage,
} from '../../domain/diagnostic/DiagnosticReport.js';

export interface DiagnosticRepoBundle {
  readonly members: MemberRepository;
  readonly requests: RequestRepository;
  readonly issues: IssueRepository;
}

export type DiagnosticRepoFactory = (
  onMalformed: OnMalformed,
) => DiagnosticRepoBundle;

export class DiagnosticUseCases {
  constructor(private readonly buildRepos: DiagnosticRepoFactory) {}

  async run(): Promise<DiagnosticReport> {
    // Findings accumulate across all three areas. Two invariants
    // (D1/D2 from noir devil review on req 2026-04-15-0009):
    //   - area tagging is owned by the area-bound collector closure,
    //     not by post-hoc filtering. The repo never sees an area —
    //     the collector bakes it in at construction time.
    //   - per-area count is a local delta over `findings.length`,
    //     not a filter pass. This keeps the count correct even if
    //     classifyMessage or area tagging ever drift.
    const findings: DiagnosticFinding[] = [];

    const areaCollector = (area: DiagnosticArea): OnMalformed =>
      (msg: string) =>
        findings.push({ area, kind: classifyMessage(msg), message: msg });

    const beforeMembers = findings.length;
    const memberBundle = this.buildRepos(areaCollector('members'));
    const members = await memberBundle.members.listAll();
    const memberMalformed = findings.length - beforeMembers;

    const beforeRequests = findings.length;
    const requestBundle = this.buildRepos(areaCollector('requests'));
    const requests = await requestBundle.requests.listAll();
    const requestMalformed = findings.length - beforeRequests;

    const beforeIssues = findings.length;
    const issueBundle = this.buildRepos(areaCollector('issues'));
    const issues = await issueBundle.issues.listAll();
    const issueMalformed = findings.length - beforeIssues;

    return new DiagnosticReport(
      {
        members: { total: members.length, malformed: memberMalformed },
        requests: { total: requests.length, malformed: requestMalformed },
        issues: { total: issues.length, malformed: issueMalformed },
      },
      findings,
    );
  }
}
