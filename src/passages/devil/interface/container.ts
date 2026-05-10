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
import { ComposedLenseCatalog } from '../infrastructure/ComposedLenseCatalog.js';
import { BundledPersonaCatalog } from '../infrastructure/BundledPersonaCatalog.js';
import { LenseCatalog } from '../application/LenseCatalog.js';

export interface DevilContainer {
  config: GuildConfig;
  reviews: YamlDevilReviewRepository;
  lenses: LenseCatalog;
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
  // #134 G: bundled defaults + content_root extensions under
  // <contentRoot>/devil/lenses/*.yaml. Hard-errors at startup when an
  // extension collides with a bundled name (records-outlive-writers).
  const lenses = ComposedLenseCatalog.load(
    new BundledLenseCatalog(),
    config.contentRoot,
    config.onMalformed,
  );
  const personas = new BundledPersonaCatalog();
  return { config, reviews, lenses, personas };
}
