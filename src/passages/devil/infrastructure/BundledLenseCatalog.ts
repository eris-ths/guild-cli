import { Lense } from '../domain/Lense.js';
import { buildDefaultLenses, DEFAULT_LENSE_NAMES } from '../domain/defaultLenses.js';
import { LenseCatalog } from '../application/LenseCatalog.js';

/**
 * v0 lense catalog: just the 11 bundled defaults from
 * domain/defaultLenses.ts. The content_root override loader (per
 * issue #126) lands later as a separate adapter — likely a
 * ComposedLenseCatalog that merges this with a YAML reader for
 * `<content_root>/devil/lenses/<custom>.yaml`. Until then, this is
 * the only adapter wired into the CLI.
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
