import { Lense } from '../domain/Lense.js';
import { buildDefaultLenses, DEFAULT_LENSE_NAMES } from '../domain/defaultLenses.js';
import { LenseCatalog } from '../application/LenseCatalog.js';

/**
 * v0 lense catalog: just the 12 bundled defaults from
 * domain/defaultLenses.ts (injection / injection-parser / path-network
 * / auth-access / memory-safety / crypto / deserialization /
 * protocol-encoding / supply-chain / composition / temporal /
 * coherence). The content_root override loader (per issue #126)
 * lands as a separate adapter (ComposedLenseCatalog) that merges
 * this with a YAML reader for `<content_root>/devil/lenses/<custom>.yaml`.
 */
export class BundledLenseCatalog implements LenseCatalog {
  private readonly map: ReadonlyMap<string, Lense>;

  constructor() {
    this.map = buildDefaultLenses();
  }

  list(): readonly Lense[] {
    // Canonical order from DEFAULT_LENSE_NAMES (issue #126's table
    // order). Keeps `devil schema` output stable across runs.
    return DEFAULT_LENSE_NAMES.map((n) => this.map.get(n) as Lense);
  }

  find(name: string): Lense | null {
    return this.map.get(name) ?? null;
  }

  names(): readonly string[] {
    return DEFAULT_LENSE_NAMES;
  }
}
