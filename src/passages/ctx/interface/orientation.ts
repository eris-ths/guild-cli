import { GuildConfig } from '../../../infrastructure/config/GuildConfig.js';
import { YamlCtxRepository } from '../infrastructure/YamlCtxRepository.js';
import {
  PassageOrientationProvider,
  PassageOrientationSummary,
} from '../../../interface/shared/PassageOrientation.js';

/**
 * ctx's orientation provider. Surfaces the count of recorded facts
 * and the most-recently-created id + timestamp.
 *
 * ctx has no state machine by design — a fact is append-only and
 * verdict-less, so it never transitions (supersede records a *new*
 * fact rather than mutating the old one; it doesn't add a state). So
 * `open` is the total count, `suspended` is always 0, and `last_state`
 * is the literal string `'recorded'` (the only state a ctx record can
 * be in). This keeps the cross-passage shape uniform for boot consumers
 * without forcing ctx to invent a lifecycle it doesn't have.
 *
 * Returns null when `<content_root>/ctx/` has no records at all
 * — gate boot omits the entry rather than rendering an empty
 * "ctx: 0 / 0 / null" structure (voice budget; principle 13).
 *
 * Closes the orientation gap surfaced during Wave 7 dogfood: ctx
 * records existed on the substrate but `gate boot` cross_passage
 * showed only agora/devil — the registry hadn't been updated when
 * ctx (the fourth passage) joined the family.
 */
export const ctxOrientation: PassageOrientationProvider = async (
  config: GuildConfig,
): Promise<PassageOrientationSummary | null> => {
  const repo = new YamlCtxRepository(config);
  const ids = await repo.listAllIds();
  if (ids.length === 0) return null;

  // ctx ids embed the date (ctx-YYYY-MM-DD-NNN). Lexicographic
  // descending sort puts the newest id first — same trick agora's
  // play ids use, no need to hydrate every record just to find
  // the latest. The actual created_at lives inside each YAML, but
  // for orientation the id-derived ordering is sufficient and
  // avoids reading N files on every boot.
  const sorted = [...ids].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const latestId = sorted[0]!;

  // Hydrate just the latest to surface its created_at — boot's
  // contract names `last_at` as the activity timestamp, and an
  // id-derived date wouldn't carry the H:M:S precision the other
  // providers do.
  const latest = await repo.findById(latestId);
  const lastAt = latest?.created_at ?? null;

  return {
    passage: 'ctx',
    open: ids.length,
    suspended: 0,
    last_id: latestId,
    last_state: 'recorded',
    last_at: lastAt,
  };
};
