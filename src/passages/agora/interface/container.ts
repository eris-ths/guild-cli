// agora — passage container builder.
//
// Mirrors gate's `buildContainer` shape (src/interface/shared/container.ts):
// a single pure factory that loads config and constructs the Yaml*
// repositories used by every handler in this passage. Extracted from
// `main()` so the cross-process lock invariant test (issue #155 PR-B)
// can verify the builder is side-effect-free — i.e. it does not write
// anything to `contentRoot` BEFORE `withGuildLock` would have a chance
// to serialize concurrent writers.
//
// Why the invariant matters: the lock middleware acquires AFTER
// buildContainer. If a future change introduces write side-effects in
// buildContainer (e.g. a config-migration auto-run in a constructor),
// those writes happen BEFORE the lock, silently breaking the
// cross-process serialization guarantee. A pin test asserts the
// directory snapshot before/after this call is byte-identical.

import { GuildConfig } from '../../../infrastructure/config/GuildConfig.js';
import { YamlGameRepository } from '../infrastructure/YamlGameRepository.js';
import { YamlPlayRepository } from '../infrastructure/YamlPlayRepository.js';

export interface AgoraContainer {
  config: GuildConfig;
  games: YamlGameRepository;
  plays: YamlPlayRepository;
}

export interface BuildAgoraContainerOpts {
  /**
   * Override `cwd` for `GuildConfig.load`. Tests pass a freshly
   * `mkdtemp`-ed directory; production never sets this.
   */
  cwd?: string;
}

export function buildAgoraContainer(
  opts: BuildAgoraContainerOpts = {},
): AgoraContainer {
  const config = GuildConfig.load(opts.cwd);
  const games = new YamlGameRepository(config);
  const plays = new YamlPlayRepository(config);
  return { config, games, plays };
}
