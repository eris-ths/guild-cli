// OkfCtxMapper — pure ctx Fact <-> OKF document mapping.
//
// Application-layer because it bridges two domain modules (ctx `Ctx`
// and `OkfDocument`); knowing both is the application's job, and keeping
// the mapping pure (no IO) means the round-trip is unit-testable without
// touching the filesystem.
//
// Direction-of-fit:
//   - export (ctx -> OKF): lossless. A guild fact carries id, author,
//     timestamp and `prefix:value` tags; all survive into frontmatter so
//     a re-import reconstructs the same record.
//   - import (OKF -> ctx): tolerant (the guild "strict on write, tolerant
//     on read" discipline). Foreign bundles whose tags aren't `prefix:
//     value` are coerced under a `topic:` prefix rather than dropped, and
//     a non-`Fact` `type` is preserved as an `okf:<type>` provenance tag.

import { Ctx, parseCtxTag } from '../domain/Ctx.js';
import { OkfDocument, slugifyForTagValue } from '../../../domain/okf/OkfDocument.js';

/**
 * Result of mapping one OKF document toward a ctx fact. `skip` carries a
 * human reason the import handler surfaces (so a partially-importable
 * bundle reports *what* it dropped rather than silently shrinking).
 */
export type OkfImportMapping =
  | {
      readonly kind: 'fact';
      readonly id?: string;
      readonly fact: string;
      readonly created_by?: string;
      readonly created_at?: string;
      readonly tags: readonly string[];
    }
  | { readonly kind: 'skip'; readonly reason: string };

/**
 * ctx Fact -> OKF concept document. The guild id becomes both the file
 * stem (OKF identity = path) and an explicit `id` frontmatter field so
 * import can recover the exact record. `author` is a producer-defined
 * extra; OKF permits fields beyond its standard set.
 */
export function ctxToOkfDocument(ctx: Ctx): OkfDocument {
  const frontmatter: OkfDocument['frontmatter'] = {
    type: 'Fact',
    id: ctx.id,
    timestamp: ctx.created_at,
    author: ctx.created_by,
  };
  if (ctx.tags.length > 0) {
    frontmatter.tags = [...ctx.tags];
  }
  return {
    path: `${ctx.id}.md`,
    frontmatter,
    body: ctx.fact,
  };
}

/**
 * Coerce one free-form tag toward a valid ctx `prefix:value` tag, or
 * return null if nothing usable survives.
 *
 * - `tech:typescript` (already conformant) -> kept as-is.
 * - `Sales` (no prefix) -> `topic:sales` (bare tags land under `topic:`).
 * - `Owner: Data Team` (prefix present) -> `owner:data-team`.
 *
 * Validation is delegated to the domain `parseCtxTag` so the mapper and
 * the persistence boundary can never disagree about what a legal tag is.
 */
function normalizeToCtxTag(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  let prefixRaw: string;
  let valueRaw: string;
  const colon = trimmed.indexOf(':');
  if (colon >= 0) {
    prefixRaw = trimmed.slice(0, colon);
    valueRaw = trimmed.slice(colon + 1);
  } else {
    prefixRaw = 'topic';
    valueRaw = trimmed;
  }

  const value = slugifyForTagValue(valueRaw);
  if (value === null) return null;

  // Prefix bound is stricter (must start with a letter, <=16 chars). A
  // slug that starts with a digit or empties out falls back to `topic:`
  // rather than dropping the tag's value entirely.
  let prefix = (slugifyForTagValue(prefixRaw) ?? '').slice(0, 16);
  if (!/^[a-z]/.test(prefix)) prefix = 'topic';

  try {
    return parseCtxTag(`${prefix}:${value}`);
  } catch {
    return null;
  }
}

/**
 * OKF concept document -> ctx fact input (or a skip reason). Pure: the
 * handler decides id allocation and author fallback from this result.
 *
 * Tolerant by design — type-less or foreign-typed documents still import
 * (their body is the fact), with provenance preserved as tags.
 */
export function okfDocumentToCtxFact(doc: OkfDocument): OkfImportMapping {
  const fact = doc.body.trim();
  if (fact.length === 0) {
    return { kind: 'skip', reason: 'empty body (no fact prose to record)' };
  }

  const fm = doc.frontmatter;
  const id = typeof fm.id === 'string' ? fm.id : undefined;
  const created_at = typeof fm.timestamp === 'string' ? fm.timestamp : undefined;
  const created_by = typeof fm.author === 'string' ? fm.author : undefined;

  const tags: string[] = [];
  const seen = new Set<string>();
  const push = (t: string | null): void => {
    if (t !== null && !seen.has(t)) {
      seen.add(t);
      tags.push(t);
    }
  };

  if (Array.isArray(fm.tags)) {
    for (const t of fm.tags) {
      if (typeof t === 'string') push(normalizeToCtxTag(t));
    }
  }

  // Provenance via the `type` field:
  //   - `Fact`        -> no tag (guild's own export type, kept tag-clean)
  //   - any other type -> `okf:<type-slug>`
  //   - missing / empty / unusable type -> `okf:untyped`
  // The import side is deliberately tolerant (a frontmatter-less or
  // type-less .md still records — its body is the fact), but OKF requires
  // a `type` on every concept, so a doc without a usable one isn't a
  // conformant concept. Tagging it `okf:untyped` keeps the tolerance while
  // making the gap auditable: `ctx list --tag okf:untyped` surfaces every
  // fact that came in without a real OKF type (e.g. a stray README.md), so
  // it can be reviewed or culled rather than silently passing as a Fact.
  const rawType = typeof fm.type === 'string' ? fm.type : '';
  const typeSlug = slugifyForTagValue(rawType);
  if (typeSlug === null) {
    push('okf:untyped');
  } else if (typeSlug !== 'fact') {
    push(`okf:${typeSlug}`);
  }

  return {
    kind: 'fact',
    fact,
    tags,
    ...(id !== undefined ? { id } : {}),
    ...(created_by !== undefined ? { created_by } : {}),
    ...(created_at !== undefined ? { created_at } : {}),
  };
}
