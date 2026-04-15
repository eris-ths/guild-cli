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
}

export function buildContainer(): Container {
  const config = GuildConfig.load();
  const members = new YamlMemberRepository(config);
  const requests = new YamlRequestRepository(config);
  const issues = new YamlIssueRepository(config);
  const notifier = new FsInboxNotification(config);
  const clock = systemClock;
  // Diagnostic uses a fresh config per area so its collecting
  // onMalformed callback isn't shared with the stderr-emitting
  // default that the rest of the CLI uses.
  const buildDiagRepos = (om: OnMalformed): DiagnosticRepoBundle => {
    const cfg = GuildConfig.load(process.cwd(), om);
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
    requestUC: new RequestUseCases({ requests, members, notifier, clock }),
    issueUC: new IssueUseCases(issues, members, clock),
    messageUC: new MessageUseCases({ members, notifier, clock }),
    diagnosticUC: new DiagnosticUseCases(buildDiagRepos),
    repairUC: new RepairUseCases(quarantine),
  };
}
