import { Ctx } from '../domain/Ctx.js';

/**
 * Port — Application's view of ctx persistence. Phase 1 needs three
 * operations: list existing ids (for nextCtxId allocation), save new,
 * and find by id (for handler verification, even though `ctx show`
 * itself ships in phase 2 — internal callers may need round-tripping).
 */
export interface CtxRepository {
  listAllIds(): Promise<readonly string[]>;
  saveNew(ctx: Ctx): Promise<void>;
  findById(id: string): Promise<Ctx | null>;
}
