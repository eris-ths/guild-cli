import { Delta } from '../domain/Delta.js';

/**
 * Port — Application's view of delta persistence.
 *
 * - `listAllIds` — id enumeration (for nextDeltaId allocation).
 * - `saveNew` — create-only write; collides loudly on a duplicate id.
 * - `save` — overwrite an existing record. Used only by `deliver`,
 *   which the domain already restricts to a once-per-deposit
 *   transition (Delta.markDelivered refuses a second delivery), so
 *   this cannot quietly rewrite history.
 * - `findById` / `listAll` — point read + hydrate-all. Malformed
 *   records are skipped on read, so neither throws on one bad file.
 */
export interface DeltaRepository {
  listAllIds(): Promise<readonly string[]>;
  saveNew(delta: Delta): Promise<void>;
  save(delta: Delta): Promise<void>;
  findById(id: string): Promise<Delta | null>;
  listAll(): Promise<readonly Delta[]>;
}
