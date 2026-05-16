// Lore use cases — domain-level read API for package-shipped lore.
//
// Lore is read-only from the AI agent's perspective. There is no
// write surface (lore is authored by editing markdown files and
// shipping a PR, not by a CLI verb). Use cases here filter and
// project parsed entries.

import { LoreEntry, LoreRepository, LoreType } from '../../infrastructure/lore/LoreRepository.js';

export interface LoreFilter {
  readonly type?: LoreType;
  /**
   * For principles: filter by `applies_to` frontmatter. `all` (the
   * default scope for principles without an explicit `applies_to`)
   * is treated as universal — it surfaces regardless of the filter
   * value. This matches the `scripts/lore-scope.sh` semantics.
   */
  readonly appliesTo?: string;
  /**
   * For traps: filter by `relevant_until` frontmatter.
   *   - `current`:    `indefinite` OR a future date
   *   - `expired`:    a past date
   *   - `indefinite`: literal `indefinite` only
   */
  readonly relevantUntil?: 'current' | 'expired' | 'indefinite';
}

export class LoreUseCases {
  constructor(private readonly repo: LoreRepository) {}

  get available(): boolean {
    return this.repo.available;
  }

  get baseDir(): string | null {
    return this.repo.baseDir;
  }

  /** All entries, filtered. Sorted by name (stable across calls). */
  list(filter: LoreFilter = {}): LoreEntry[] {
    const all = this.repo.listAll();
    return all.filter((e) => matchesFilter(e, filter));
  }

  /**
   * Lookup by exact name (canonical slug, e.g. `11-ai-first-human-as-projection`)
   * with a numeric-prefix fallback (e.g. `11` resolves to that file).
   * Numeric fallback matches when the input is purely digits and
   * exactly one entry starts with `<digits>-`. Disambiguates only the
   * common "I remember the number, not the slug" cold-read case;
   * ambiguous matches (multiple hits, or non-digit input) fall through
   * to null so the caller's `next: gate lore list` hint stays
   * meaningful (eris touch-feel 2026-05-16 finding 4.6).
   */
  find(name: string): LoreEntry | null {
    const exact = this.repo.find(name);
    if (exact !== null) return exact;
    if (!/^\d+$/.test(name)) return null;
    const prefix = `${name}-`;
    const candidates = this.repo.listAll().filter((e) => e.name.startsWith(prefix));
    return candidates.length === 1 ? candidates[0]! : null;
  }
}

function matchesFilter(entry: LoreEntry, filter: LoreFilter): boolean {
  if (filter.type !== undefined && entry.type !== filter.type) return false;
  if (filter.appliesTo !== undefined && entry.type === 'principle') {
    // Default scope is `all` — entries without an explicit
    // `applies_to` are universal and match every filter value.
    const declared = entry.frontmatter['applies_to'] ?? 'all';
    if (declared !== 'all' && declared !== filter.appliesTo) return false;
  }
  if (filter.relevantUntil !== undefined && entry.type === 'trap') {
    const v = entry.frontmatter['relevant_until'] ?? '';
    if (filter.relevantUntil === 'indefinite') {
      if (v !== 'indefinite') return false;
    } else {
      const isIndef = v === 'indefinite';
      const parsed = isIndef ? null : Date.parse(v);
      const isFuture = parsed !== null && !Number.isNaN(parsed) && parsed >= Date.now();
      const isPast = parsed !== null && !Number.isNaN(parsed) && parsed < Date.now();
      if (filter.relevantUntil === 'current') {
        if (!isIndef && !isFuture) return false;
      } else if (filter.relevantUntil === 'expired') {
        if (!isPast) return false;
      }
    }
  }
  return true;
}
