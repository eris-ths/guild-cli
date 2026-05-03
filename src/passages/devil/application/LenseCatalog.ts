import { Lense } from '../domain/Lense.js';

/**
 * Port for lense catalog access.
 *
 * The catalog is the substrate's source of truth for "which lenses
 * are valid in this content_root." v0 implementation just exposes
 * the bundled defaults; a future content_root override loader will
 * merge `<content_root>/devil/lenses/<custom>.yaml` over them
 * without changing this interface — the verbs talk to the catalog,
 * not the implementation.
 */
export interface LenseCatalog {
  /** All lenses in the catalog, in canonical order (defaults first). */
  list(): readonly Lense[];
  /** Lookup by name. Returns null if absent. */
  find(name: string): Lense | null;
  /** Names of every lense in the catalog. */
  names(): readonly string[];
}
