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

/**
 * Doctor plugin interface. A plugin is an ES module that default-exports
 * a function returning additional findings. Plugins run after the
 * built-in checks and their findings are merged into the report.
 *
 * The plugin receives the config root and content root so it can
 * locate files (README, docs, etc.) relative to the project.
 */
export interface DoctorPluginContext {
  readonly root: string;
  readonly contentRoot: string;
}

export type DoctorPluginFn = (
  ctx: DoctorPluginContext,
) => Promise<DiagnosticFinding[]>;

export class DiagnosticUseCases {
  constructor(
    private readonly buildRepos: DiagnosticRepoFactory,
    private readonly pluginPaths: readonly string[] = [],
    private readonly pluginContext?: DoctorPluginContext,
  ) {}

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
      (source: string, msg: string) =>
        findings.push({
          area,
          source,
          kind: classifyMessage(msg),
          message: msg,
        });

    const beforeMembers = findings.length;
    const memberBundle = this.buildRepos(areaCollector('members'));
    const members = await memberBundle.members.listAll();
    const memberMalformed = findings.length - beforeMembers;

    const beforeRequests = findings.length;
    const requestBundle = this.buildRepos(areaCollector('requests'));
    const requests = await requestBundle.requests.listAll();
    // Off-pattern .yaml files (typo'd names) and subdirectories
    // under <state>/ are silently dropped by listByState's regex.
    // Surface them as findings so a misplaced file that gate
    // ignored is no longer invisible. Fresh-agent dogfood
    // surfaced this gap (2026-05-01 design sandbox) — pre-fix,
    // a bad.yaml in requests/pending/ stayed there forever and
    // doctor reported the root as clean.
    const unrecognized = await requestBundle.requests.listUnrecognizedFiles();
    const requestCollector = areaCollector('requests');
    for (const u of unrecognized) {
      requestCollector(
        u.path,
        `unrecognized ${u.kind}: ${u.reason}`,
      );
    }
    const requestMalformed = findings.length - beforeRequests;

    const beforeIssues = findings.length;
    const issueBundle = this.buildRepos(areaCollector('issues'));
    const issues = await issueBundle.issues.listAll();
    const issueMalformed = findings.length - beforeIssues;

    // Run doctor plugins (if any)
    if (this.pluginPaths.length > 0 && this.pluginContext) {
      for (const pluginPath of this.pluginPaths) {
        try {
          const mod = await import(pluginPath);
          const fn: DoctorPluginFn = mod.default ?? mod;
          if (typeof fn === 'function') {
            const pluginFindings = await fn(this.pluginContext);
            findings.push(...pluginFindings);
          }
        } catch (e) {
          // Plugin errors become findings, never crash doctor
          findings.push({
            area: 'plugin',
            source: pluginPath,
            kind: 'unknown',
            message: `plugin error: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }
    }

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
