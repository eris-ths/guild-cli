import { GuildConfig } from '../../infrastructure/config/GuildConfig.js';
import { YamlMemberRepository } from '../../infrastructure/persistence/YamlMemberRepository.js';
import { YamlRequestRepository } from '../../infrastructure/persistence/YamlRequestRepository.js';
import { YamlIssueRepository } from '../../infrastructure/persistence/YamlIssueRepository.js';
import { YamlObservationRepository } from '../../infrastructure/persistence/YamlObservationRepository.js';
import { ObservationRepository } from '../../application/ports/ObservationRepository.js';
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
import { BundledLenseCatalog } from '../../passages/devil/infrastructure/BundledLenseCatalog.js';
import { ComposedLenseCatalog } from '../../passages/devil/infrastructure/ComposedLenseCatalog.js';
import { YamlPlayRepository } from '../../passages/agora/infrastructure/YamlPlayRepository.js';
import { PlayRepository } from '../../passages/agora/application/PlayRepository.js';
import {
  FsTemplateRepository,
  resolveBuiltinTemplatesDir,
} from '../../infrastructure/template/TemplateRepository.js';
import { TemplateUseCases } from '../../application/template/TemplateUseCases.js';
import {
  FsLoreRepository,
  resolveLoreBaseDir,
} from '../../infrastructure/lore/LoreRepository.js';
import { LoreUseCases } from '../../application/lore/LoreUseCases.js';
import { YamlSessionEventRepository } from '../../infrastructure/persistence/YamlSessionEventRepository.js';
import { SessionEventUseCases } from '../../application/session/SessionEventUseCases.js';
import {
  VerbPlugin,
  VerbPluginLoadError,
} from '../../application/plugin/VerbPlugin.js';
import type { HookSubscriptions } from '../../application/plugin/HookBus.js';
import type { HookPluginLoadError } from '../../application/plugin/HookPlugin.js';
import type {
  VoicePlugin,
  VoicePluginLoadError,
} from '../../application/plugin/VoicePlugin.js';

export interface Container {
  config: GuildConfig;
  memberUC: MemberUseCases;
  requestUC: RequestUseCases;
  issueUC: IssueUseCases;
  /**
   * Append-only machine observations (`gate rom record`). Exposed as
   * the repository itself, not behind a use-case: there is no policy
   * to enforce past the domain's own validation, and inventing a
   * pass-through layer would be ceremony.
   */
  observations: ObservationRepository;
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
   * Wave-brief template registry adapter (#235, two-tier #302).
   * `gate templates list/show` and `gate request --template <name>`
   * read from two sources, with content_root shadowing built-in:
   *   - user override: `<content_root>/data/guild/templates/wave-brief/`
   *   - built-in:      packaged `templates/wave-brief/` shipped with
   *                    guild-cli (resolved relative to this module).
   */
  templateUC: TemplateUseCases;
  /**
   * Package-shipped lore reader (`gate lore` verb). Resolves
   * `<packageRoot>/lore/principles/*.md` + `<packageRoot>/lore/traps/*.md`
   * at construction. `available` flips false when the directory cannot
   * be located (e.g. an incomplete install), which the handler surfaces
   * as a structured error instead of an empty list.
   */
  loreUC: LoreUseCases;
  /**
   * Session-boundary events (`gate rest` / `gate wake` /
   * `gate farewell`, #36 Phase 2). Phase 2's first slice ships
   * `gate rest` only; the use case accepts the full kind union so
   * follow-up PRs add wake / farewell handlers without a domain
   * change.
   */
  sessionEventUC: SessionEventUseCases;
  /**
   * Verb plugins loaded at CLI startup (issue #36 Phase 1 step 4).
   * Empty array when `plugins.trusted: true` is absent from
   * `guild.config.yaml` or no plugins are listed under `plugins.verbs`.
   * Built-in verb names are reserved — collisions are rejected by the
   * loader and surface as `verbPluginErrors` rather than overriding
   * core dispatch.
   */
  verbPlugins: readonly VerbPlugin[];
  /**
   * Per-path load failures from the verb plugin loader. Surfaced via
   * `gate doctor` so a broken plugin is visible to the operator
   * instead of silently dropping the verb. Empty array on a clean
   * load.
   */
  verbPluginErrors: readonly VerbPluginLoadError[];
  /**
   * Hook plugin subscriptions (#36 Phase 1 step 5). Empty map when no
   * hook plugins are loaded. Lifecycle handlers (`approve`, `deny`,
   * `execute`, `complete`, `fail`, `review`) call `fireBeforeHook` /
   * `fireAfterHook` against this map at fire points.
   */
  hookSubscriptions: HookSubscriptions;
  /**
   * Per-path hook plugin load errors. Surfaced via `gate doctor` as
   * `area: 'plugin'` findings, same channel as verb plugin errors.
   */
  hookPluginErrors: readonly HookPluginLoadError[];
  /**
   * Voice plugins (#345 — second dogfood validation of principle 15).
   * Empty array when no plugins are listed under `plugins.voices` or
   * `plugins.trusted: true` is absent. The active voice is picked at
   * runtime via `GUILD_VOICE=<name>` env; the container only holds
   * what was loaded, not which is active. Render via
   * `interface/shared/voiceRender.ts` at write-verb fire points.
   */
  voicePlugins: readonly VoicePlugin[];
  /**
   * Per-path voice plugin load errors. Surfaced via `gate doctor` as
   * `area: 'plugin'` findings, same channel as verb/hook plugin errors.
   */
  voicePluginErrors: readonly VoicePluginLoadError[];
}

export interface BuildContainerOpts {
  /**
   * Override `cwd` for `GuildConfig.load`. Tests pass a freshly
   * `mkdtemp`-ed directory to verify the builder is side-effect-free
   * (issue #155 PR-B pin test); production never sets this.
   */
  cwd?: string;
  /**
   * Pre-loaded verb plugins (issue #36 Phase 1 step 4). main() loads
   * them via `loadVerbPlugins` before constructing the container —
   * dynamic ESM import is async, so the loading can't live inside
   * the synchronous `buildContainer` call. Defaults to `[]` so tests
   * and use-cases that don't care about plugins stay unchanged.
   */
  verbPlugins?: readonly VerbPlugin[];
  /**
   * Per-path load errors collected by the verb plugin loader.
   * Defaults to `[]`. `gate doctor` reads this list and surfaces
   * each entry as a finding (`area: 'plugin'`).
   */
  verbPluginErrors?: readonly VerbPluginLoadError[];
  /**
   * Per-path load outcome (success + failure) from the verb plugin
   * loader. Mirrors the `PluginLoadInfo[]` shape doctor plugins use
   * so the doctor renderer can display verb plugin paths in the
   * same "plugins loaded" section. Defaults to `[]`.
   */
  verbPluginsLoaded?: ReadonlyArray<{ path: string; status: 'loaded' | 'error' }>;
  /**
   * Pre-loaded hook plugin subscription map (#36 Phase 1 step 5).
   * main() builds it via `loadHookPlugins`. Defaults to an empty
   * Map.
   */
  hookSubscriptions?: HookSubscriptions;
  /**
   * Per-path hook plugin load errors. Defaults to `[]`.
   */
  hookPluginErrors?: readonly HookPluginLoadError[];
  /**
   * Per-path load outcome (success + failure) from the hook plugin
   * loader. Mirrors `verbPluginsLoaded`.
   */
  hookPluginsLoaded?: ReadonlyArray<{ path: string; status: 'loaded' | 'error' }>;
  /**
   * Pre-loaded voice plugins (#345). main() loads via
   * `loadVoicePlugins`. Defaults to `[]`.
   */
  voicePlugins?: readonly VoicePlugin[];
  /** Per-path voice plugin load errors. Defaults to `[]`. */
  voicePluginErrors?: readonly VoicePluginLoadError[];
  /** Per-path voice plugin load outcome (loaded | error). Defaults to `[]`. */
  voicePluginsLoaded?: ReadonlyArray<{ path: string; status: 'loaded' | 'error' }>;
}

export function buildContainer(opts: BuildContainerOpts = {}): Container {
  const config = GuildConfig.load(opts.cwd);
  const members = new YamlMemberRepository(config);
  const requests = new YamlRequestRepository(config);
  const issues = new YamlIssueRepository(config);
  const observations = new YamlObservationRepository(config);
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
    requestUC: new RequestUseCases({
      requests,
      members,
      notifier,
      clock,
      // #134 H2: when gate.strict_lenses is on, the allowed-lense set
      // is the unified devil catalog (bundled + content_root extensions
      // from G). Otherwise the historical config.lenses list keeps
      // driving validation. Default is permanently opt-in.
      allowedLenses: config.gate.strictLenses
        ? ComposedLenseCatalog.load(
            new BundledLenseCatalog(),
            config.contentRoot,
            config.onMalformed,
          ).names()
        : config.lenses,
    }),
    issueUC: new IssueUseCases(issues, members, clock),
    // Observations are append-only machine facts — no use-case layer
    // wraps them because there is no policy to enforce beyond what the
    // domain already validates. The repository is the whole story.
    observations,
    messageUC: new MessageUseCases({ members, notifier, clock }),
    diagnosticUC: new DiagnosticUseCases(
      buildDiagRepos,
      config.doctorPlugins,
      { root: config.root, contentRoot: config.contentRoot },
      {
        // Surface every loader path (success + failure) so doctor
        // displays "what ran" identically to doctor plugins. Falls
        // back to a derived list when only `verbPlugins` was passed
        // (test convenience), but production main() always provides
        // both arrays explicitly via opts.
        pluginsLoaded: [
          ...(opts.verbPluginsLoaded ?? []),
          ...(opts.hookPluginsLoaded ?? []),
          ...(opts.voicePluginsLoaded ?? []),
        ],
        errors: [
          ...(opts.verbPluginErrors ?? []).map((e) => ({
            path: e.path,
            reason: `verb plugin: ${e.reason}`,
          })),
          ...(opts.hookPluginErrors ?? []).map((e) => ({
            path: e.path,
            reason: `hook plugin: ${e.reason}`,
          })),
          ...(opts.voicePluginErrors ?? []).map((e) => ({
            path: e.path,
            reason: `voice plugin: ${e.reason}`,
          })),
        ],
      },
    ),
    repairUC: new RepairUseCases(quarantine),
    unrespondedConcernsQ: new UnrespondedConcernsQuery(requests, issues),
    playRepo: new YamlPlayRepository(config),
    templateUC: new TemplateUseCases(
      new FsTemplateRepository(
        config.contentRoot,
        resolveBuiltinTemplatesDir(),
        config.onMalformed,
      ),
    ),
    loreUC: new LoreUseCases(new FsLoreRepository(resolveLoreBaseDir())),
    sessionEventUC: new SessionEventUseCases({
      events: new YamlSessionEventRepository(config),
      members,
      clock,
    }),
    verbPlugins: opts.verbPlugins ?? [],
    verbPluginErrors: opts.verbPluginErrors ?? [],
    hookSubscriptions: opts.hookSubscriptions ?? new Map(),
    hookPluginErrors: opts.hookPluginErrors ?? [],
    voicePlugins: opts.voicePlugins ?? [],
    voicePluginErrors: opts.voicePluginErrors ?? [],
  };
}
