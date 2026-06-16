// ctx — passage container builder.
//
// Mirrors gate's `buildContainer` shape. Extracted from `main()` so
// the buildContainer-invariant pin test (issue #155 PR-B) can assert
// no on-disk writes happen here. The lock middleware acquires AFTER
// this call; any future write side-effect introduced inside the
// builder would silently break the cross-process serialization
// guarantee. The pin test exists to catch that regression.

import { GuildConfig } from '../../../infrastructure/config/GuildConfig.js';
import { YamlCtxRepository } from '../infrastructure/YamlCtxRepository.js';
import { FsOkfBundleRepository } from '../../../infrastructure/okf/FsOkfBundleRepository.js';
import { CtxUseCases } from '../application/CtxUseCases.js';

export interface CtxContainer {
  config: GuildConfig;
  repo: YamlCtxRepository;
  uc: CtxUseCases;
}

export interface BuildCtxContainerOpts {
  cwd?: string;
}

export function buildCtxContainer(
  opts: BuildCtxContainerOpts = {},
): CtxContainer {
  const config = GuildConfig.load(opts.cwd);
  const repo = new YamlCtxRepository(config);
  const bundle = new FsOkfBundleRepository(config.onMalformed);
  const uc = new CtxUseCases(repo, () => new Date(), bundle);
  return { config, repo, uc };
}
