import { Persona } from '../domain/Persona.js';

/**
 * Port for persona catalog access. Mirrors LenseCatalog's shape so
 * verbs use the same patterns regardless of which catalog they're
 * resolving against.
 *
 * Ingest-only personas (ultrareview-fleet, claude-security,
 * scg-supply-chain-gate) join the catalog when their respective
 * ingest verbs land — they are not in the v0 defaults.
 */
export interface PersonaCatalog {
  list(): readonly Persona[];
  find(name: string): Persona | null;
  names(): readonly string[];
}
