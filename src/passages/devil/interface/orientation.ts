import { GuildConfig } from '../../../infrastructure/config/GuildConfig.js';
import { YamlDevilReviewRepository } from '../infrastructure/YamlDevilReviewRepository.js';
import {
  PassageOrientationProvider,
  PassageOrientationSummary,
} from '../../../interface/shared/PassageOrientation.js';

/**
 * devil's orientation provider. Surfaces the count of open reviews
 * (state = 'open'), the subset currently paused (suspensions.length
 * > resumes.length), and the most-recently-touched review's id +
 * state + activity timestamp.
 *
 * Returns null when `<content_root>/devil/` has no reviews at all.
 *
 * "Most recent" is computed from each review's max-timestamp
 * across opened_at, entry timestamps, suspension/resume entries,
 * and conclusion timestamp.
 *
 * Note: devil's state machine is thinner than agora's. There is
 * no 'suspended' state — suspend/resume on a review records re-
 * entry context but does NOT block other entries. So the
 * "suspended count" here is the count of reviews where the
 * trailing suspension is unmatched by a resume; i.e. one suspend
 * primitive is in flight even though the review itself is still
 * accepting entries.
 */
export const devilOrientation: PassageOrientationProvider = async (
  config: GuildConfig,
): Promise<PassageOrientationSummary | null> => {
  const repo = new YamlDevilReviewRepository(config);
  const reviews = await repo.listAll();
  if (reviews.length === 0) return null;

  let openCount = 0;
  let suspendedCount = 0;
  let last: { id: string; state: string; at: string } | null = null;

  for (const review of reviews) {
    if (review.state === 'open') openCount += 1;
    if (review.suspensions.length > review.resumes.length) suspendedCount += 1;

    const candidates: string[] = [review.opened_at];
    for (const e of review.entries) candidates.push(e.at);
    for (const s of review.suspensions) candidates.push(s.at);
    for (const r of review.resumes) candidates.push(r.at);
    if (review.conclusion) candidates.push(review.conclusion.at);
    const latest = candidates.reduce((a, b) => (a > b ? a : b));

    if (last === null || latest > last.at) {
      last = { id: review.id, state: review.state, at: latest };
    }
  }

  return {
    passage: 'devil',
    open: openCount,
    suspended: suspendedCount,
    last_id: last ? last.id : null,
    last_state: last ? last.state : null,
    last_at: last ? last.at : null,
  };
};
