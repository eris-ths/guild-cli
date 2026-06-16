// OKF — Open Knowledge Format document model (domain, dependency-free).
//
// OKF (https://cloud.google.com/blog/products/data-analytics/how-the-
// open-knowledge-format-can-improve-data-sharing/) is a vendor-neutral
// interchange format: a bundle is a *directory of markdown files*, each
// being YAML frontmatter + a markdown body. File paths are concept
// identities; markdown links between files form the relationship graph.
//
// guild-cli treats OKF as an interop *projection* (principle 11), not a
// storage format. The on-disk substrate stays YAML/JSON-envelope; OKF is
// another surface records can be exported to and imported from, the way
// `--format text` is a human projection of the JSON contract. Keeping it
// a projection means an OKF v0.x churn costs a projector edit, never a
// stored-data migration.
//
// This module is pure: the document shape, the conformance rule, and the
// small string helpers the export/import mappers share. YAML (de)serial-
// ization and filesystem IO live in infrastructure — domain stays free
// of external dependencies (Clean Architecture; CLAUDE.md "Style").

import { DomainError } from '../shared/DomainError.js';

/** The OKF spec revision this projector targets. */
export const OKF_VERSION = '0.1';

/**
 * Reserved filenames the spec gives special meaning. `index.md` is the
 * bundle's table of contents; `log.md` is its chronological history.
 * Both are *generated views* on export and *skipped* on import — they
 * are projections of the concept set, not concepts themselves.
 */
export const OKF_RESERVED_FILENAMES: ReadonlySet<string> = new Set([
  'index.md',
  'log.md',
]);

/**
 * OKF frontmatter. The spec requires exactly one field — `type` — and
 * standardizes a handful of optional ones; everything else is left to
 * the producer. We model the standard fields explicitly and keep an
 * open index for producer-defined extras (guild emits `id` and `author`
 * there so a guild-authored bundle round-trips losslessly).
 */
export interface OkfFrontmatter {
  /** Required: the concept's type (e.g. `Fact`, `BigQuery Table`). */
  type: string;
  title?: string;
  description?: string;
  resource?: string;
  tags?: readonly string[];
  /** ISO-8601 last-update timestamp. */
  timestamp?: string;
  /** Producer-defined extras (guild: `id`, `author`). */
  [key: string]: unknown;
}

/**
 * One OKF concept document.
 *
 * `path` is the concept's identity within the bundle — a relative path
 * like `ctx-2026-06-16-001.md`. `body` is the markdown after the
 * frontmatter block (for a guild fact, the fact prose).
 */
export interface OkfDocument {
  readonly path: string;
  readonly frontmatter: OkfFrontmatter;
  readonly body: string;
}

/** True when `filename` is one of OKF's reserved view files. */
export function isReservedOkfFilename(filename: string): boolean {
  return OKF_RESERVED_FILENAMES.has(filename);
}

/**
 * Conformance check: every OKF concept must carry a non-empty `type`.
 * This is the one hard rule the spec states, enforced at the boundary
 * so a malformed produced document fails loud rather than shipping a
 * non-conformant bundle.
 */
export function assertOkfConformant(doc: OkfDocument): void {
  const t = doc.frontmatter.type;
  if (typeof t !== 'string' || t.trim().length === 0) {
    throw new DomainError(
      `OKF document ${doc.path} is missing the required 'type' field`,
      'type',
    );
  }
}

/**
 * Slugify an OKF `type` (or any free text) into the value half of a
 * guild tag — lowercase, ASCII alphanumerics and hyphens, collapsed and
 * trimmed, capped at 48 chars (the `parseCtxTag` value bound). Returns
 * `null` when nothing usable survives (e.g. an all-symbol input), so the
 * caller can drop rather than emit an invalid tag.
 *
 * Example: `"BigQuery Table"` → `"bigquery-table"`.
 */
export function slugifyForTagValue(raw: string): string | null {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  // Value must start with an alphanumeric (parseCtxTag bound). A leading
  // hyphen can't survive the trims above, but an empty result can.
  return /^[a-z0-9]/.test(slug) ? slug : null;
}
