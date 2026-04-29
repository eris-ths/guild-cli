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
    return new GuildConfig(root, contentRoot, paths, hostNames, lenses, doctorPlugins, onMalformed, configPath);
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
      onMalformed,
      null,
    );
  }
}

function findConfig(start: string): string | null {
  let dir = resolve(start);
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'guild.config.yaml');
    if (existsSync(candidate)) return candidate;
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
