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
import { YamlPlayRepository } from '../../passages/agora/infrastructure/YamlPlayRepository.js';
import { PlayRepository } from '../../passages/agora/application/PlayRepository.js';
import { FsTemplateRepository } from '../../infrastructure/template/TemplateRepository.js';
import { TemplateUseCases } from '../../application/template/TemplateUseCases.js';

export interface Container {
  config: GuildConfig;
  memberUC: MemberUseCases;
  requestUC: RequestUseCases;
  issueUC: IssueUseCases;
  messageUC: MessageUseCases;
  diagnosticUC: DiagnosticUseCases;
  repairUC: RepairUseCases;
  unrespondedConcernsQ: UnrespondedConcernsQuery;
  /**
   * Agora play storage adapter (#232). Wired into the gate container
   * so the `--from-agora <play_id>` bridge in `gate request` can lift
   * a play's cliff/invitation into the request action/reason without a
   * second top-level container or a cross-process shell-out. Both
   * passages share the same `content_root`, so re-using the gate's
   * GuildConfig means the bridge sees the same agora directory the
   * `agora` CLI verbs read/write.
   */
  playRepo: PlayRepository;
  /**
   * Wave-brief template registry adapter (#235). Wired so
   * `gate templates list/show` and `gate request --template <name>`
   * read from the per-instance template SOT under
   * `<content_root>/data/guild/templates/wave-brief/`.
   */
  templateUC: TemplateUseCases;
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
    playRepo: new YamlPlayRepository(config),
    templateUC: new TemplateUseCases(
      new FsTemplateRepository(config.contentRoot, config.onMalformed),
    ),
  };
}
