// devil-review — passage container builder.
//
// Mirrors gate's `buildContainer` shape. Extracted from `main()` so
// the buildContainer-invariant pin test (issue #155 PR-B) can assert
// no on-disk writes happen here. The lock middleware acquires AFTER
// this call; any future write side-effect introduced inside the
// builder would silently break the cross-process serialization
// guarantee. The pin test exists to catch that regression.

import { GuildConfig } from '../../../infrastructure/config/GuildConfig.js';
import { YamlDevilReviewRepository } from '../infrastructure/YamlDevilReviewRepository.js';
import { BundledLenseCatalog } from '../infrastructure/BundledLenseCatalog.js';
import { BundledPersonaCatalog } from '../infrastructure/BundledPersonaCatalog.js';

export interface DevilContainer {
  config: GuildConfig;
  reviews: YamlDevilReviewRepository;
  lenses: BundledLenseCatalog;
  personas: BundledPersonaCatalog;
}

export interface BuildDevilContainerOpts {
  cwd?: string;
}

export function buildDevilContainer(
  opts: BuildDevilContainerOpts = {},
): DevilContainer {
  const config = GuildConfig.load(opts.cwd);
  const reviews = new YamlDevilReviewRepository(config);
  const lenses = new BundledLenseCatalog();
  const personas = new BundledPersonaCatalog();
  return { config, reviews, lenses, personas };
}
