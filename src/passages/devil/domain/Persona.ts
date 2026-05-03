// devil-review — Persona (the role a reviewer commits to for an entry).
//
// Personas are the structural answer to "who is reading this code,
// from which framing?" Issue #126 names three hand-rolled defaults
// — red-team, author-defender, mirror — and an open extension point
// for automated personas (ultrareview-fleet, claude-security,
// scg-supply-chain-gate) that subsequent commits will add when the
// ingest verbs land.
//
// Per principle 11 (AI-first, human as projection): persona
// commitment is *structural*, not vibes. The Lense forces what to
// look at; the Persona forces from where. Same actor can wear
// multiple personas across entries — but never two personas inside
// one entry. That constraint is enforced by Entry, not here.

import { DomainError } from '../../../domain/shared/DomainError.js';

/**
 * Persona names share the same shape as lense names: lowercase
 * ASCII letters, digits, hyphens; starts with a letter; max 48
 * chars. Same shape so substrate-readers don't need two parsers.
 */
const PERSONA_NAME_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;

export function parsePersonaName(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new DomainError(`persona name must be a string, got: ${typeof raw}`, 'name');
  }
  if (!PERSONA_NAME_PATTERN.test(raw)) {
    throw new DomainError(
      `persona name must match ${PERSONA_NAME_PATTERN.source} (lowercase letters/digits/hyphens, leads with a letter, max 48 chars), got: ${raw}`,
      'name',
    );
  }
  return raw;
}

export interface PersonaProps {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /**
   * Prose the persona should commit to when authoring an entry. Not
   * a constraint the runtime enforces — it's substrate the reviewer
   * (human or AI) reads before opening the entry. The Persona is
   * the framing; this field tells the framer how to inhabit it.
   */
  readonly guidance: string;
  /**
   * `true` for personas that exist solely to attribute ingest from
   * an automated tool (ultrareview-fleet, claude-security,
   * scg-supply-chain-gate). Such personas cannot be used by hand
   * via `devil entry` — only by the corresponding `devil ingest`.
   * `false` (default) for hand-rolled personas a reviewer may pick.
   */
  readonly ingest_only: boolean;
}

export class Persona {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly guidance: string;
  readonly ingest_only: boolean;

  private constructor(props: PersonaProps) {
    this.name = props.name;
    this.title = props.title;
    this.description = props.description;
    this.guidance = props.guidance;
    this.ingest_only = props.ingest_only;
  }

  static create(input: {
    name: string;
    title: string;
    description: string;
    guidance: string;
    ingest_only?: boolean;
  }): Persona {
    const name = parsePersonaName(input.name);
    if (typeof input.title !== 'string' || input.title.trim().length === 0) {
      throw new DomainError('title required (non-empty string)', 'title');
    }
    if (typeof input.description !== 'string' || input.description.trim().length === 0) {
      throw new DomainError('description required (non-empty string)', 'description');
    }
    if (typeof input.guidance !== 'string' || input.guidance.trim().length === 0) {
      throw new DomainError(
        'guidance required (non-empty string) — the persona must declare what its inhabitant should commit to',
        'guidance',
      );
    }
    return new Persona({
      name,
      title: input.title.trim(),
      description: input.description.trim(),
      guidance: input.guidance.trim(),
      ingest_only: input.ingest_only ?? false,
    });
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      title: this.title,
      description: this.description,
      guidance: this.guidance,
      ingest_only: this.ingest_only,
    };
  }
}

export class PersonaNotFound extends Error {
  constructor(name: string) {
    super(`Persona not found in catalog: ${name}`);
    this.name = 'PersonaNotFound';
  }
}

export class PersonaIsIngestOnly extends Error {
  constructor(name: string) {
    super(
      `Persona "${name}" is ingest-only — cannot be used as the author of a hand-written entry. ` +
        `Use the matching \`devil ingest\` verb to attribute ingested findings to this persona.`,
    );
    this.name = 'PersonaIsIngestOnly';
  }
}
