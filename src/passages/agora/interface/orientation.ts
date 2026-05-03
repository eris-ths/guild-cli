import { GuildConfig } from '../../../infrastructure/config/GuildConfig.js';
import { YamlPlayRepository } from '../infrastructure/YamlPlayRepository.js';
import {
  PassageOrientationProvider,
  PassageOrientationSummary,
} from '../../../interface/shared/PassageOrientation.js';

/**
 * agora's orientation provider. Surfaces the count of plays in
 * non-terminal state (playing / suspended), the suspended subset
 * (paused with cliff/invitation awaiting re-entry), and the most-
 * recently-touched play's id + state + activity timestamp.
 *
 * Returns null when `<content_root>/agora/` has no plays at all
 * — gate boot omits the entry rather than rendering an empty
 * "agora: 0 / 0 / null" structure.
 *
 * "Most recent" is computed from each play's max-timestamp across
 * its move + suspension + resume + conclusion entries.
 */
export const agoraOrientation: PassageOrientationProvider = async (
  config: GuildConfig,
): Promise<PassageOrientationSummary | null> => {
  const repo = new YamlPlayRepository(config);
  const plays = await repo.listAll();
  if (plays.length === 0) return null;

  let openCount = 0;
  let suspendedCount = 0;
  let last: { id: string; state: string; at: string; game: string } | null = null;

  for (const play of plays) {
    if (play.state !== 'concluded') openCount += 1;
    if (play.state === 'suspended') suspendedCount += 1;

    // Latest activity timestamp on this play: max of started_at,
    // any move/suspension/resume timestamp, conclusion timestamp.
    const candidates: string[] = [play.started_at];
    for (const m of play.moves) candidates.push(m.at);
    for (const s of play.suspensions) candidates.push(s.at);
    for (const r of play.resumes) candidates.push(r.at);
    if (play.concluded_at) candidates.push(play.concluded_at);
    const latest = candidates.reduce((a, b) => (a > b ? a : b));

    if (last === null || latest > last.at) {
      last = { id: play.id, state: play.state, at: latest, game: play.game };
    }
  }

  return {
    passage: 'agora',
    open: openCount,
    suspended: suspendedCount,
    last_id: last ? last.id : null,
    last_state: last ? last.state : null,
    last_at: last ? last.at : null,
  };
};
