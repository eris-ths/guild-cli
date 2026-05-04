import { Ctx, nextCtxId } from '../domain/Ctx.js';
import { CtxRepository } from './CtxRepository.js';

/**
 * ctx use cases — phase 1 has only `record`. Phase 2 will add
 * fork / supersede / show / list / chain / status.
 *
 * `now` is injected so tests can pin time and so the same allocator
 * is used by id-generation (nextCtxId) and timestamp authorship,
 * keeping them consistent within a single record.
 */
export class CtxUseCases {
  constructor(
    private readonly repo: CtxRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async record(input: {
    by: string;
    fact: string;
    tags?: readonly string[];
  }): Promise<Ctx> {
    const now = this.now();
    const existing = await this.repo.listAllIds();
    const id = nextCtxId(existing, now);
    const ctx = Ctx.create({
      id,
      created_by: input.by,
      fact: input.fact,
      tags: input.tags ?? [],
      now: () => now,
    });
    await this.repo.saveNew(ctx);
    return ctx;
  }
}
