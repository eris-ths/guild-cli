import { Persona } from '../domain/Persona.js';
import {
  buildDefaultPersonas,
  DEFAULT_PERSONA_NAMES,
} from '../domain/defaultPersonas.js';
import { PersonaCatalog } from '../application/PersonaCatalog.js';

/**
 * v0 persona catalog: the 3 hand-rolled defaults from
 * domain/defaultPersonas.ts (red-team / author-defender / mirror).
 * Ingest-only personas join the catalog when their matching ingest
 * verbs land in subsequent commits.
 */
export class BundledPersonaCatalog implements PersonaCatalog {
  private readonly map: ReadonlyMap<string, Persona>;

  constructor() {
    this.map = buildDefaultPersonas();
  }

  list(): readonly Persona[] {
    return DEFAULT_PERSONA_NAMES.map((n) => this.map.get(n) as Persona);
  }

  find(name: string): Persona | null {
    return this.map.get(name) ?? null;
  }

  names(): readonly string[] {
    return DEFAULT_PERSONA_NAMES;
  }
}
