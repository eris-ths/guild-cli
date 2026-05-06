import { GuildConfig } from '../../infrastructure/config/GuildConfig.js';
import { YamlMemberRepository } from '../../infrastructure/persistence/YamlMemberRepository.js';
import { YamlRequestRepository } from '../../infrastructure/persistence/YamlRequestRepository.js';
import { YamlIssueRepository } from '../../infrastructure/persistence/YamlIssueRepository.js';
import { FsInboxNotification } from '../../infrastructure/persistence/FsInboxNotification.js';
import { systemClock } from '../../application/ports/Clock.js';
import { MemberUseCases } from '../../application/member/MemberUseCases.js';
import { RequestUseCases } from '../../application/request/RequestUseCases.js';
import { IssueUseCases } from '../../application/issue/IssueUseCases.js';
import { MessageUseCases } from '../../application/message/MessageUseCases.js';
import {
  DiagnosticUseCases,
  DiagnosticRepoBundle,
} from '../../application/diagnostic/DiagnosticUseCases.js';
import { RepairUseCases } from '../../application/repair/RepairUseCases.js';
import { UnrespondedConcernsQuery } from '../../application/concern/UnrespondedConcernsQuery.js';
import { SafeFsQuarantineStore } from '../../infrastructure/persistence/SafeFsQuarantineStore.js';
import { OnMalformed } from '../../application/ports/OnMalformed.js';

export interface Container {
  config: GuildConfig;
  memberUC: MemberUseCases;
  requestUC: RequestUseCases;
  issueUC: IssueUseCases;
  messageUC: MessageUseCases;
  diagnosticUC: DiagnosticUseCases;
  repairUC: RepairUseCases;
  unrespondedConcernsQ: UnrespondedConcernsQuery;
}

export interface BuildContainerOpts {
  /**
   * Override `cwd` for `GuildConfig.load`. Tests pass a freshly
   * `mkdtemp`-ed directory to verify the builder is side-effect-free
   * (issue #155 PR-B pin test); production never sets this.
   */
  cwd?: string;
}

export function buildContainer(opts: BuildContainerOpts = {}): Container {
  const config = GuildConfig.load(opts.cwd);
  const members = new YamlMemberRepository(config);
  const requests = new YamlRequestRepository(config);
  const issues = new YamlIssueRepository(config);
  const notifier = new FsInboxNotification(config);
  const clock = systemClock;
  // Diagnostic uses a fresh config per area so its collecting
  // onMalformed callback isn't shared with the stderr-emitting
  // default that the rest of the CLI uses.
  const buildDiagRepos = (om: OnMalformed): DiagnosticRepoBundle => {
    const cfg = GuildConfig.load(opts.cwd ?? process.cwd(), om);
    return {
      members: new YamlMemberRepository(cfg),
      requests: new YamlRequestRepository(cfg),
      issues: new YamlIssueRepository(cfg),
    };
  };
  // Repair quarantine store is constructed per-CLI-run so its
  // timestamp directory groups all actions from a single invocation.
  const quarantine = new SafeFsQuarantineStore(config.contentRoot);
  return {
    config,
    memberUC: new MemberUseCases(members),
    requestUC: new RequestUseCases({ requests, members, notifier, clock, allowedLenses: config.lenses }),
    issueUC: new IssueUseCases(issues, members, clock),
    messageUC: new MessageUseCases({ members, notifier, clock }),
    diagnosticUC: new DiagnosticUseCases(
      buildDiagRepos,
      config.doctorPlugins,
      { root: config.root, contentRoot: config.contentRoot },
    ),
    repairUC: new RepairUseCases(quarantine),
    unrespondedConcernsQ: new UnrespondedConcernsQuery(requests, issues),
  };
}
