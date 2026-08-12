// delta — passage container builder.
//
// Mirrors gate's `buildContainer` shape (and ctx's). Extracted from
// `main()` so the buildContainer-invariant pin test can assert no
// on-disk writes happen here: the lock middleware acquires AFTER this
// call, so a write side-effect introduced in the builder would silently
// break cross-process serialization.

import { GuildConfig } from '../../../infrastructure/config/GuildConfig.js';
import { DeltaRepository } from '../application/DeltaRepository.js';
import { YamlDeltaRepository } from '../infrastructure/YamlDeltaRepository.js';
import { MarkdownDeltaRepository } from '../infrastructure/MarkdownDeltaRepository.js';
import { DeltaUseCases } from '../application/DeltaUseCases.js';

/**
 * Env key selecting the markdown ledger adapter.
 *
 * An env var rather than a config key, matching `GUILD_CONFIG`: the
 * ledger path is a property of *where this deployment keeps its
 * deposits*, which is the same class of thing as where its config lives,
 * and both need to be answerable before any file is read.
 */
export const DELTA_LEDGER_ENV = 'GUILD_DELTA_LEDGER';

export interface DeltaContainer {
  config: GuildConfig;
  repo: DeltaRepository;
  uc: DeltaUseCases;
}

export interface BuildDeltaContainerOpts {
  cwd?: string;
  /** Overrides `GUILD_DELTA_LEDGER`; tests use it to avoid env mutation. */
  ledgerPath?: string;
}

export function buildDeltaContainer(
  opts: BuildDeltaContainerOpts = {},
): DeltaContainer {
  const config = GuildConfig.load(opts.cwd);
  // A deployment that keeps its deposits in a markdown ledger points at
  // the file; everything else gets the per-deposit YAML store. Neither
  // adapter reads the other's substrate, so a deployment cannot end up
  // with two ledgers that each look authoritative.
  const ledger = (opts.ledgerPath ?? process.env[DELTA_LEDGER_ENV] ?? '').trim();
  const repo: DeltaRepository =
    ledger === ''
      ? new YamlDeltaRepository(config)
      : new MarkdownDeltaRepository(config, ledger);
  const uc = new DeltaUseCases(repo, () => new Date());
  return { config, repo, uc };
}
