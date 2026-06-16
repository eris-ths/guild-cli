import { Ctx } from '../domain/Ctx.js';

/**
 * Port — Application's view of ctx persistence.
 *
 * - `listAllIds` — id enumeration (for nextCtxId allocation).
 * - `saveNew` / `findById` — write + point read.
 * - `listAll` — hydrate every fact (for `ctx list` and OKF export).
 *   Malformed records are skipped on read (same tolerance as findById),
 *   so this never throws on a single bad file.
 */
export interface CtxRepository {
  listAllIds(): Promise<readonly string[]>;
  saveNew(ctx: Ctx): Promise<void>;
  findById(id: string): Promise<Ctx | null>;
  listAll(): Promise<readonly Ctx[]>;
}
