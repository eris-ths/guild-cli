import { Persona } from '../domain/Persona.js';
import {
  buildDefaultPersonas,
  DEFAULT_PERSONA_NAMES,
} from '../domain/defaultPersonas.js';
import { PersonaCatalog } from '../application/PersonaCatalog.js';

/**
 * v1 persona catalog: 6 personas total — 3 hand-rolled
 * (red-team / author-defender / mirror) + 3 ingest-only
 * (ultrareview-fleet / claude-security / scg-supply-chain-gate).
 * Ingest-only personas are in the catalog so `devil ingest --from
 * <source>` can attribute to them; `devil entry` refuses them via
 * `PersonaIsIngestOnly`.
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
