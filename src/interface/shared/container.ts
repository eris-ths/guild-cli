import { GuildConfig } from '../../infrastructure/config/GuildConfig.js';
import { YamlMemberRepository } from '../../infrastructure/persistence/YamlMemberRepository.js';
import { YamlRequestRepository } from '../../infrastructure/persistence/YamlRequestRepository.js';
import { YamlIssueRepository } from '../../infrastructure/persistence/YamlIssueRepository.js';
import { FsInboxNotification } from '../../infrastructure/persistence/FsInboxNotification.js';
import { systemClock } from '../../application/ports/Clock.js';
import { MemberUseCases } from '../../application/member/MemberUseCases.js';
import { RequestUseCases } from '../../application/request/RequestUseCases.js';
import { IssueUseCases } from '../../application/issue/IssueUseCases.js';

export interface Container {
  config: GuildConfig;
  memberUC: MemberUseCases;
  requestUC: RequestUseCases;
  issueUC: IssueUseCases;
}

export function buildContainer(): Container {
  const config = GuildConfig.load();
  const members = new YamlMemberRepository(config);
  const requests = new YamlRequestRepository(config);
  const issues = new YamlIssueRepository(config);
  const notifier = new FsInboxNotification(config);
  const clock = systemClock;
  return {
    config,
    memberUC: new MemberUseCases(members),
    requestUC: new RequestUseCases({ requests, members, notifier, clock }),
    issueUC: new IssueUseCases(issues, members, clock),
  };
}
