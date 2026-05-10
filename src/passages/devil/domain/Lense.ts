// devil-review — Lense (a single review-axis the reviewer must
// touch before concluding a session).
//
// Lense catalog is substrate-level (lore/principle 10): the schema
// is the contract between writers and re-readers. A reviewer cannot
// conclude a devil-review session without leaving at least one entry
// per requested lense (a `kind: skip` entry counts, but must declare
// why the lense is irrelevant — silent skipping is not allowed).
//
// AI-first per lore/principles/11:
//   - immutable once parsed
//   - explicit fields (no implicit defaults the reviewer would have
//     to infer from a config file)
//   - snake_case JSON keys
//   - `delegate` is null/absent unless the lense MUST be filled by
//     an automated tool (e.g. supply-chain → scg). null is meaningful.

import { DomainError } from '../../../domain/shared/DomainError.js';

/**
 * Lense names: lowercase ASCII letters, digits, hyphens; starts with
 * a letter; max 48 chars. Tighter than game slugs (64) because
 * lenses are taxonomic — short stable identifiers.
 */
const LENSE_NAME_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;

export function parseLenseName(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new DomainError(`lense name must be a string, got: ${typeof raw}`, 'name');
  }
  if (!LENSE_NAME_PATTERN.test(raw)) {
    throw new DomainError(
      `lense name must match ${LENSE_NAME_PATTERN.source} (lowercase letters/digits/hyphens, leads with a letter, max 48 chars), got: ${raw}`,
      'name',
    );
  }
  return raw;
}

/**
 * Provenance marker (#134 G): is this lense from the bundled catalog
 * or from a content_root extension under `devil/lenses/*.yaml`?
 *
 * Pinning provenance lets entry records (and `devil schema`) name the
 * source of every lense they touch. Without it, a future bundled v2
 * that adds `security` would silently re-bind older entries that named
 * a then-extension lense `security` — records-outlive-writers requires
 * the record itself to disambiguate.
 */
export type LenseSource = 'bundled' | 'extension';

export interface LenseProps {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /**
   * Automated tools whose output naturally maps onto this lense
   * (`/ultrareview`, `claude-security`, `scg`, ...). Empty array if
   * the lense is hand-rolled only.
   */
  readonly ingest_sources: readonly string[];
  /**
   * Mandatory delegate tool. When set, devil-review fails closed if
   * the lense is requested but the tool is unavailable — see the
   * `supply-chain → scg` design in issue #126. `undefined` (omitted)
   * means hand-rolled or any-source-OK.
   */
  readonly delegate?: string;
  /**
   * Examples are illustrative for the reviewer; not enforced. The
   * substrate retains them so re-readers see the lense's intended
   * scope without re-deriving from the title alone.
   */
  readonly examples?: readonly string[];
  /** See LenseSource. Defaults to 'bundled' when omitted in create(). */
  readonly source?: LenseSource;
}

export class Lense {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly ingest_sources: readonly string[];
  readonly delegate?: string;
  readonly examples?: readonly string[];
  readonly source: LenseSource;

  private constructor(props: LenseProps) {
    this.name = props.name;
    this.title = props.title;
    this.description = props.description;
    this.ingest_sources = props.ingest_sources;
    if (props.delegate !== undefined) this.delegate = props.delegate;
    if (props.examples !== undefined) this.examples = props.examples;
    this.source = props.source ?? 'bundled';
  }

  /**
   * Strict construction — used by both bundled defaults and future
   * content_root overrides. A malformed lense fails closed at the
   * domain boundary; we do not silently coerce.
   */
  static create(input: {
    name: string;
    title: string;
    description: string;
    ingest_sources?: readonly string[];
    delegate?: string;
    examples?: readonly string[];
    source?: LenseSource;
  }): Lense {
    const name = parseLenseName(input.name);
    if (typeof input.title !== 'string' || input.title.trim().length === 0) {
      throw new DomainError('title required (non-empty string)', 'title');
    }
    if (typeof input.description !== 'string' || input.description.trim().length === 0) {
      throw new DomainError('description required (non-empty string)', 'description');
    }
    const ingest_sources = input.ingest_sources ?? [];
    for (const src of ingest_sources) {
      if (typeof src !== 'string' || src.length === 0) {
        throw new DomainError('ingest_sources entries must be non-empty strings', 'ingest_sources');
      }
    }
    if (input.delegate !== undefined) {
      if (typeof input.delegate !== 'string' || input.delegate.length === 0) {
        throw new DomainError('delegate must be a non-empty string when set', 'delegate');
      }
    }
    if (input.examples !== undefined) {
      for (const ex of input.examples) {
        if (typeof ex !== 'string' || ex.length === 0) {
          throw new DomainError('examples entries must be non-empty strings', 'examples');
        }
      }
    }
    if (input.source !== undefined && input.source !== 'bundled' && input.source !== 'extension') {
      throw new DomainError(
        `source must be 'bundled' or 'extension', got: ${String(input.source)}`,
        'source',
      );
    }
    const props: LenseProps = {
      name,
      title: input.title.trim(),
      description: input.description.trim(),
      ingest_sources,
      ...(input.delegate !== undefined ? { delegate: input.delegate } : {}),
      ...(input.examples !== undefined ? { examples: input.examples } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
    };
    return new Lense(props);
  }

  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      name: this.name,
      title: this.title,
      description: this.description,
      ingest_sources: this.ingest_sources,
    };
    if (this.delegate !== undefined) out['delegate'] = this.delegate;
    if (this.examples !== undefined) out['examples'] = this.examples;
    // source is always present (default 'bundled') so the schema output
    // is unambiguous; consumers don't have to infer the default.
    out['source'] = this.source;
    return out;
  }
}

export class LenseCollision extends Error {
  /**
   * Hard-error at catalog load time when a content_root extension
   * names the same lense as a bundled default. records-outlive-writers:
   * silently shadowing bundled meaning across content_roots makes a
   * 2-year-old review record ambiguous to re-read. The fix is to pick
   * a distinct extension name.
   */
  readonly bundledName: string;
  readonly extensionPath: string;
  constructor(bundledName: string, extensionPath: string) {
    super(
      `Lense "${bundledName}" defined by extension at ${extensionPath} ` +
        `collides with a bundled lense of the same name. ` +
        `next: rename the extension lense to a distinct name (e.g. "${bundledName}-strict") — ` +
        `silent override would make older review records ambiguous to re-read.`,
    );
    this.name = 'LenseCollision';
    this.bundledName = bundledName;
    this.extensionPath = extensionPath;
  }
}

export class LenseNotFound extends Error {
  /**
   * `available` carries the catalog at the time of the failure so
   * the interface layer can render a did-you-mean hint without having
   * to round-trip back through the LenseCatalog. The domain layer
   * is the source of truth on which lenses exist; pushing the list
   * up via the error means error messages always reflect *what was
   * looked at*, not what the renderer thinks should exist.
   *
   * Empty `available` is allowed (catalog could legitimately be
   * empty in a malformed config) — the interface renders without
   * the suggestion line in that case.
   */
  readonly available: readonly string[];
  constructor(name: string, available: readonly string[] = []) {
    super(`Lense not found in catalog: ${name}`);
    this.name = 'LenseNotFound';
    this.available = available;
  }
}

export class LenseDelegateUnavailable extends Error {
  constructor(lense: string, delegate: string) {
    super(
      `Lense "${lense}" requires delegate "${delegate}" but it is not available. ` +
        `Install/configure ${delegate} or remove the lense from the requested set ` +
        `(skip is not allowed for delegate-bound lenses — see issue #126).`,
    );
    this.name = 'LenseDelegateUnavailable';
  }
}
