// agora — Game (the design artifact, NOT a play session).
//
// A Game is a definition: rules, kind, title, who created it. Plays
// reference a Game; one Game can have many Plays. This separation
// is structural — Quest and Sandbox are both Games with different
// `kind` values; the play surface is the same regardless.
//
// AI-first per lore/principles/11:
//   - immutable on save (mutations would surprise an agent re-reading)
//   - explicit fields (no implicit defaults that humans would infer)
//   - snake_case JSON keys
//   - explicit `kind` discriminator (not inferred from rules content)

import { DomainError } from '../../../domain/shared/DomainError.js';

/**
 * Two game kinds in the v0 surface, decided in the design discussion
 * (issue #117): Quest = goal-oriented branching path; Sandbox =
 * no-goal, emergence-shaped. Match (competitive) is intentionally
 * out of scope — it doesn't fit the AI-first / narrative direction.
 */
export type GameKind = 'quest' | 'sandbox';

const VALID_KINDS: ReadonlySet<GameKind> = new Set(['quest', 'sandbox']);

export function parseGameKind(raw: unknown): GameKind {
  if (typeof raw !== 'string') {
    throw new DomainError(
      `kind must be a string, got: ${typeof raw}`,
      'kind',
    );
  }
  if (!VALID_KINDS.has(raw as GameKind)) {
    throw new DomainError(
      `kind must be one of ${[...VALID_KINDS].join(', ')}, got: ${raw}`,
      'kind',
    );
  }
  return raw as GameKind;
}

/**
 * Slug — filesystem-safe identifier. Lowercase ASCII letters, digits,
 * hyphens; starts with a letter; max 64 chars. Tighter than member
 * names (which are 32) because game definitions can have descriptive
 * slugs (e.g., `agora-design-council`, `daily-noir-rabbit-tracker`).
 */
const SLUG_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

export function parseGameSlug(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new DomainError(
      `slug must be a string, got: ${typeof raw}`,
      'slug',
    );
  }
  if (!SLUG_PATTERN.test(raw)) {
    throw new DomainError(
      `slug must match ${SLUG_PATTERN.source} (lowercase letters/digits/hyphens, leads with a letter, max 64 chars), got: ${raw}`,
      'slug',
    );
  }
  return raw;
}

export interface GameProps {
  readonly slug: string;
  readonly kind: GameKind;
  readonly title: string;
  readonly created_at: string; // ISO timestamp
  readonly created_by: string; // member name or host name
  readonly description?: string; // optional prose, agent-authored
}

export class Game {
  readonly slug: string;
  readonly kind: GameKind;
  readonly title: string;
  readonly created_at: string;
  readonly created_by: string;
  readonly description?: string;

  private constructor(props: GameProps) {
    this.slug = props.slug;
    this.kind = props.kind;
    this.title = props.title;
    this.created_at = props.created_at;
    this.created_by = props.created_by;
    if (props.description !== undefined) this.description = props.description;
  }

  static create(input: {
    slug: string;
    kind: string;
    title: string;
    created_by: string;
    description?: string;
    now?: () => Date;
  }): Game {
    const slug = parseGameSlug(input.slug);
    const kind = parseGameKind(input.kind);
    if (typeof input.title !== 'string' || input.title.trim().length === 0) {
      throw new DomainError('title required (non-empty string)', 'title');
    }
    const created_at = (input.now ?? (() => new Date()))().toISOString();
    const props: GameProps = {
      slug,
      kind,
      title: input.title.trim(),
      created_at,
      created_by: input.created_by,
    };
    return new Game(
      input.description !== undefined && input.description.trim().length > 0
        ? { ...props, description: input.description.trim() }
        : props,
    );
  }

  /**
   * Restore from on-disk YAML. Used by repository hydrate paths.
   * Validation is the same as create — a tampered file fails closed.
   */
  static restore(input: GameProps): Game {
    return new Game({
      slug: parseGameSlug(input.slug),
      kind: parseGameKind(input.kind),
      title: input.title,
      created_at: input.created_at,
      created_by: input.created_by,
      ...(input.description !== undefined ? { description: input.description } : {}),
    });
  }

  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      slug: this.slug,
      kind: this.kind,
      title: this.title,
      created_at: this.created_at,
      created_by: this.created_by,
    };
    // omit-when-undefined per the JSON convention (gate inbox / member)
    if (this.description !== undefined) {
      out['description'] = this.description;
    }
    return out;
  }
}

export class GameSlugCollision extends Error {
  constructor(slug: string) {
    super(`Game slug already exists: ${slug}`);
    this.name = 'GameSlugCollision';
  }
}
