import { readFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute, join } from 'node:path';
import YAML from 'yaml';
import { DomainError } from '../../domain/shared/DomainError.js';

/**
 * Called by repository hydrate paths when a YAML record cannot be
 * parsed into a domain object. The CLI wires this to stderr so that
 * data-loss events surface instead of being silently swallowed.
 * Tests inject a collecting spy to assert the exact messages.
 */
export type OnMalformed = (msg: string) => void;

export const defaultOnMalformed: OnMalformed = (msg) => {
  process.stderr.write(`warn: ${msg}\n`);
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
    readonly onMalformed: OnMalformed,
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
          .map((x: string) => x.toLowerCase())
      : [...DEFAULT_HOSTS];
    return new GuildConfig(root, contentRoot, paths, hostNames, onMalformed);
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
      onMalformed,
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
 */
function resolveUnder(base: string, path: string): string {
  const absBase = resolve(base);
  const target = isAbsolute(path) ? resolve(path) : resolve(absBase, path);
  const rel = target.startsWith(absBase + '/') || target === absBase;
  if (!rel) {
    throw new DomainError(
      `Config path escapes base: ${path} → ${target}`,
      'paths',
    );
  }
  return target;
}
