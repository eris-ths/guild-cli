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
}

export class Lense {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly ingest_sources: readonly string[];
  readonly delegate?: string;
  readonly examples?: readonly string[];

  private constructor(props: LenseProps) {
    this.name = props.name;
    this.title = props.title;
    this.description = props.description;
    this.ingest_sources = props.ingest_sources;
    if (props.delegate !== undefined) this.delegate = props.delegate;
    if (props.examples !== undefined) this.examples = props.examples;
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
    const props: LenseProps = {
      name,
      title: input.title.trim(),
      description: input.description.trim(),
      ingest_sources,
      ...(input.delegate !== undefined ? { delegate: input.delegate } : {}),
      ...(input.examples !== undefined ? { examples: input.examples } : {}),
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
    return out;
  }
}

export class LenseNotFound extends Error {
  constructor(name: string) {
    super(`Lense not found in catalog: ${name}`);
    this.name = 'LenseNotFound';
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
