import { readFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute, join } from 'node:path';
import YAML from 'yaml';
import { DomainError } from '../../domain/shared/DomainError.js';
import { MemberName } from '../../domain/member/MemberName.js';
import { isUnderBase } from '../persistence/pathSafety.js';
import { DEFAULT_LENSES } from '../../domain/shared/Lense.js';

/**
 * Called by repository hydrate paths when a YAML record cannot be
 * parsed into a domain object. The CLI wires this to stderr so that
 * data-loss events surface instead of being silently swallowed.
 * Tests inject a collecting spy to assert the exact messages.
 *
 * `source` is the absolute filesystem path of the offending file.
 * The path is mandatory and structured: gate repair consumes it
 * directly without parsing the message string.
 */
export type OnMalformed = (source: string, msg: string) => void;

export const defaultOnMalformed: OnMalformed = (source, msg) => {
  process.stderr.write(`warn: ${source}: ${msg}\n`);
};

/**
 * Guild profile (#231). `standard` is the default, single-machine /
 * single-cwd workflow. `swarm` is a stricter mode that enforces per-
 * cwd isolation for parallel waves — its primary effect is to default
 * `features.worktree_required_for_parallel` to true. Profiles are
 * intentionally coarse: a small set of named presets reads better in
 * `guild.config.yaml` than a sprawl of per-feature booleans, and most
 * deployments fall cleanly into one bucket or the other.
 */
export type GuildProfile = 'standard' | 'swarm';

/**
 * Tri-state policy for self-approval on `gate approve` (#233).
 *
 *   - `allowed`   : pass silently (no notice). For deployments that
 *                   actively rely on self-approve as a primitive.
 *   - `warn`      : pass, emit a stderr notice pointing at fast-track.
 *                   The historical default — preserved under
 *                   profile=standard so existing flows keep working.
 *   - `forbidden` : refuse with an actionable error. Default under
 *                   profile=swarm, where parallel waves and
 *                   bias-checked approvals are the explicit point.
 *
 * Three states (not a boolean) because the failure modes differ:
 * `allowed` removes the audit notice for callers who deliberately
 * accept the risk, and `forbidden` is a hard stop with a recovery
 * hint, not a softer noticed pass. Collapsing to two would either
 * lose the silent-allow surface or muddle the swarm error path.
 */
export type SelfApprovePolicy = 'allowed' | 'warn' | 'forbidden';

export interface GuildFeatures {
  /**
   * When true, parallel waves (multi-executor requests) carry a
   * `requires_worktree_isolation: true` flag, and `gate execute`
   * refuses a second concurrent invocation from the same filesystem
   * cwd. Defaults to false under profile=standard, true under
   * profile=swarm — the explicit feature key lets a deployment opt
   * in/out without flipping the whole profile.
   */
  worktreeRequiredForParallel: boolean;
  /**
   * Tri-state self-approve policy on `gate approve` (#233). Profile
   * default: `warn` under standard, `forbidden` under swarm. An
   * explicit `features.self_approve` always overrides the profile
   * default — same opt-in/opt-out shape as worktree_required_for_parallel.
   */
  selfApprove: SelfApprovePolicy;
}

export interface GuildConfigProps {
  root: string;
  contentRoot: string;
  paths: {
    members: string;
    requests: string;
    issues: string;
    inbox: string;
  };
  hostNames: readonly string[];
  lenses: readonly string[];
  doctorPlugins: readonly string[];
  /**
   * Absolute paths of verb plugins to load at CLI startup
   * (issue #36 Phase 1 step 4). Populated only when `plugins.trusted:
   * true` is set in `guild.config.yaml`; without that consent the
   * loader skips every entry under `plugins.verbs` and emits an
   * `onMalformed` notice. Same trust contract as `doctorPlugins` —
   * see `SECURITY.md` § "Plugin trust model".
   */
  verbPluginPaths: readonly string[];
  profile: GuildProfile;
  features: GuildFeatures;
  onMalformed: OnMalformed;
}

const DEFAULT_HOSTS = ['eris', 'nao'] as const;

/**
 * GuildConfig — file-based config with path safety.
 *
 * All resolved paths must live under `contentRoot`. This is the single
 * enforcement point for filesystem reach-out.
 */
export class GuildConfig implements GuildConfigProps {
  private constructor(
    readonly root: string,
    readonly contentRoot: string,
    readonly paths: GuildConfigProps['paths'],
    readonly hostNames: readonly string[],
    readonly lenses: readonly string[],
    readonly doctorPlugins: readonly string[],
    readonly verbPluginPaths: readonly string[],
    readonly profile: GuildProfile,
    readonly features: GuildFeatures,
    readonly onMalformed: OnMalformed,
    /**
     * Absolute path to the `guild.config.yaml` that produced this
     * config, or `null` when no config was found and `cwd` was used
     * as a fallback content_root. Lets callers distinguish
     * "intentional fresh start" (config present, 0 data) from
     * "misconfigured cwd" (no config, 0 data).
     */
    readonly configFile: string | null,
  ) {}

  static load(
    cwd: string = process.cwd(),
    onMalformed: OnMalformed = defaultOnMalformed,
  ): GuildConfig {
    const configPath = findConfig(cwd);
    if (!configPath) {
      // Default: treat cwd as guild root
      return GuildConfig.default(cwd, onMalformed);
    }
    const raw = YAML.parse(readFileSync(configPath, 'utf8')) ?? {};
    const root = resolve(configPath, '..');
    const contentRoot = resolveUnder(
      root,
      typeof raw.content_root === 'string' ? raw.content_root : '.',
    );
    const p = raw.paths ?? {};
    const paths = {
      members: resolveUnder(contentRoot, p.members ?? 'members'),
      requests: resolveUnder(contentRoot, p.requests ?? 'requests'),
      issues: resolveUnder(contentRoot, p.issues ?? 'issues'),
      inbox: resolveUnder(contentRoot, p.inbox ?? 'inbox'),
    };
    const hostNames = Array.isArray(raw.host_names)
      ? raw.host_names
          .filter((x: unknown): x is string => typeof x === 'string')
          .map((x: string) => validateHostName(x))
      : [...DEFAULT_HOSTS];
    const lenses = Array.isArray(raw.lenses)
      ? raw.lenses
          .filter((x: unknown): x is string => typeof x === 'string')
          .map((x: string) => x.toLowerCase())
      : [...DEFAULT_LENSES];
    const doctor = raw.doctor ?? {};
    const pluginsTrusted = doctor.trusted === true;
    const doctorPlugins = Array.isArray(doctor.plugins) && pluginsTrusted
      ? doctor.plugins
          .filter((x: unknown): x is string => typeof x === 'string')
          .map((x: string) => resolveUnder(root, x))
      : [];
    if (Array.isArray(doctor.plugins) && doctor.plugins.length > 0 && !pluginsTrusted) {
      onMalformed(
        configPath,
        'doctor.plugins present but doctor.trusted is not true — plugins will NOT be loaded. ' +
          'Add `trusted: true` under `doctor:` in guild.config.yaml to enable.',
      );
    }
    // Verb plugins (#36 Phase 1 step 4). Separate consent gate from
    // doctor.trusted: `plugins.trusted: true` lights up the unified
    // `plugins:` section that future hook / transform extensions will
    // share. Without it, every entry under `plugins.verbs` is dropped
    // with an onMalformed notice. The trust model is identical to
    // doctor's — plugins run in-process with full Node capabilities,
    // and the YAML alone is not consent. See `SECURITY.md` § "Plugin
    // trust model".
    const pluginsRaw = raw.plugins ?? {};
    const verbPluginsTrusted = pluginsRaw.trusted === true;
    const verbPluginPaths = Array.isArray(pluginsRaw.verbs) && verbPluginsTrusted
      ? pluginsRaw.verbs
          .filter((x: unknown): x is string => typeof x === 'string')
          .map((x: string) => resolveUnder(root, x))
      : [];
    if (Array.isArray(pluginsRaw.verbs) && pluginsRaw.verbs.length > 0 && !verbPluginsTrusted) {
      onMalformed(
        configPath,
        'plugins.verbs present but plugins.trusted is not true — verb plugins will NOT be loaded. ' +
          'Add `trusted: true` under `plugins:` in guild.config.yaml to enable.',
      );
    }
    // Profile + features (#231). The two interact: `profile: swarm`
    // flips the default of `features.worktree_required_for_parallel`
    // to true, but an explicit `features:` block always wins so a
    // deployment can opt in/out without changing profile. Unknown
    // profile values fall back to 'standard' with an onMalformed
    // notice — same conservative read pattern other optional fields
    // use (per principle 04, records / configs outlive writers).
    let profile: GuildProfile = 'standard';
    if (typeof raw.profile === 'string') {
      if (raw.profile === 'standard' || raw.profile === 'swarm') {
        profile = raw.profile;
      } else {
        onMalformed(
          configPath,
          `unknown profile "${raw.profile}" — falling back to 'standard'. ` +
            `Valid: standard | swarm.`,
        );
      }
    }
    const featuresRaw = raw.features ?? {};
    const explicitWorktreeRequired =
      typeof featuresRaw.worktree_required_for_parallel === 'boolean'
        ? featuresRaw.worktree_required_for_parallel
        : undefined;
    // self_approve (#233): tri-state with profile-derived default.
    // Malformed values (non-string, or string outside the enum) fall
    // back to the profile default with an onMalformed notice — same
    // conservative read pattern other optional fields use.
    const selfApproveDefault: SelfApprovePolicy =
      profile === 'swarm' ? 'forbidden' : 'warn';
    let selfApprove: SelfApprovePolicy = selfApproveDefault;
    if (featuresRaw.self_approve !== undefined) {
      const v = featuresRaw.self_approve;
      if (v === 'allowed' || v === 'warn' || v === 'forbidden') {
        selfApprove = v;
      } else {
        onMalformed(
          configPath,
          `unknown features.self_approve ${JSON.stringify(v)} — ` +
            `falling back to profile default '${selfApproveDefault}'. ` +
            `Valid: allowed | warn | forbidden.`,
        );
      }
    }
    const features: GuildFeatures = {
      worktreeRequiredForParallel:
        explicitWorktreeRequired ?? (profile === 'swarm'),
      selfApprove,
    };
    return new GuildConfig(root, contentRoot, paths, hostNames, lenses, doctorPlugins, verbPluginPaths, profile, features, onMalformed, configPath);
  }

  static default(
    root: string,
    onMalformed: OnMalformed = defaultOnMalformed,
  ): GuildConfig {
    const abs = resolve(root);
    return new GuildConfig(
      abs,
      abs,
      {
        members: join(abs, 'members'),
        requests: join(abs, 'requests'),
        issues: join(abs, 'issues'),
        inbox: join(abs, 'inbox'),
      },
      [...DEFAULT_HOSTS],
      [...DEFAULT_LENSES],
      [],
      [],
      'standard',
      { worktreeRequiredForParallel: false, selfApprove: 'warn' },
      onMalformed,
      null,
    );
  }
}

function findConfig(start: string): string | null {
  let dir = resolve(start);
  for (let i = 0; i < 10; i++) {
    // Prefer in-repo `.gate-sessions/` convention adopted by repos that
    // sandbox guild data into a single subdirectory (projector,
    // yori-code, ...). When the config lives there, content_root and
    // path entries inside the file resolve relative to `.gate-sessions/`,
    // which is what those repos already write.
    const inSubdir = join(dir, '.gate-sessions', 'guild.config.yaml');
    if (existsSync(inSubdir)) return inSubdir;
    // Legacy top-level placement: when the project IS the guild
    // (THS-style content_root where everything sits at the top of the
    // tree), guild.config.yaml lives directly next to requests/issues/...
    const topLevel = join(dir, 'guild.config.yaml');
    if (existsSync(topLevel)) return topLevel;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Resolve `path` under `base`, rejecting any attempt to escape via `..`,
 * absolute paths, or symlinks later handled by the repo layer.
 *
 * Containment is checked via `isUnderBase` (see ../persistence/pathSafety.ts)
 * which uses `path.relative` for cross-platform correctness — the
 * previous `startsWith(absBase + '/')` form crashed every Windows
 * startup because the literal `/` never matched a backslash-separated
 * subpath.
 */
/**
 * Pass host names through the same validation gate as members so a
 * malformed host_names entry (shell metachars, path traversal, reserved
 * names) surfaces at config-load time rather than leaking into
 * `--from` / `--by` / `--to` where hosts are otherwise accepted.
 */
function validateHostName(raw: string): string {
  try {
    return MemberName.of(raw).value;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new DomainError(
      `Invalid host_names entry "${raw}": ${msg}`,
      'host_names',
    );
  }
}

function resolveUnder(base: string, path: string): string {
  const absBase = resolve(base);
  const target = isAbsolute(path) ? resolve(path) : resolve(absBase, path);
  if (!isUnderBase(target, absBase)) {
    throw new DomainError(
      `Config path escapes base: ${path} (resolved=${target}, base=${absBase})`,
      'paths',
    );
  }
  return target;
}
