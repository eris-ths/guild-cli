// delta — passage container builder.
//
// Mirrors gate's `buildContainer` shape (and ctx's). Extracted from
// `main()` so the buildContainer-invariant pin test can assert no
// on-disk writes happen here: the lock middleware acquires AFTER this
// call, so a write side-effect introduced in the builder would silently
// break cross-process serialization.

import { GuildConfig } from '../../../infrastructure/config/GuildConfig.js';
import { YamlDeltaRepository } from '../infrastructure/YamlDeltaRepository.js';
import { DeltaUseCases } from '../application/DeltaUseCases.js';

export interface DeltaContainer {
  config: GuildConfig;
  repo: YamlDeltaRepository;
  uc: DeltaUseCases;
}

export interface BuildDeltaContainerOpts {
  cwd?: string;
}

export function buildDeltaContainer(
  opts: BuildDeltaContainerOpts = {},
): DeltaContainer {
  const config = GuildConfig.load(opts.cwd);
  const repo = new YamlDeltaRepository(config);
  const uc = new DeltaUseCases(repo, () => new Date());
  return { config, repo, uc };
}
