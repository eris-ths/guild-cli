import { DevilReview, ReviewState, parseReviewState, parseTargetType } from '../../domain/DevilReview.js';
import { DevilReviewRepository } from '../../application/DevilReviewRepository.js';
import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';

const LIST_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'state',
  'target-type',
  'format',
]);

/**
 * devil list — enumerate review sessions in the content_root.
 *
 * Usage:
 *   devil list [--state open|concluded]
 *              [--target-type pr|file|function|commit]
 *              [--format json|text]
 *
 * Reads only — no mutation. Returns a summary view of each review
 * (state, target, opened_by, counts) suitable for an agent's
 * "what's open right now?" surface. For full detail use `devil show`.
 *
 * Filters compose: --state open --target-type pr returns only open
 * reviews on PR targets. Order is most-recent-first by id.
 */
export interface ListDeps {
  readonly reviews: DevilReviewRepository;
  readonly config: GuildConfig;
}

export async function listReviews(deps: ListDeps, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, LIST_KNOWN_FLAGS, 'list');

  const stateRaw = optionalOption(args, 'state');
  let stateFilter: ReviewState | undefined;
  if (stateRaw !== undefined) {
    stateFilter = parseReviewState(stateRaw); // throws DomainError on bad input
  }
  const typeRaw = optionalOption(args, 'target-type');
  let targetTypeFilter: ReturnType<typeof parseTargetType> | undefined;
  if (typeRaw !== undefined) {
    targetTypeFilter = parseTargetType(typeRaw);
  }

  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    process.stderr.write(`error: --format must be 'json' or 'text', got: ${format}\n`);
    return 1;
  }

  const all = await deps.reviews.listAll();
  const filtered = all.filter(
    (r) =>
      (stateFilter === undefined || r.state === stateFilter) &&
      (targetTypeFilter === undefined || r.target.type === targetTypeFilter),
  );

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          reviews: filtered.map(summarize),
          filters: {
            ...(stateFilter !== undefined ? { state: stateFilter } : {}),
            ...(targetTypeFilter !== undefined
              ? { target_type: targetTypeFilter }
              : {}),
          },
          config_file: deps.config.configFile,
        },
        null,
        2,
      ) + '\n',
    );
    return 0;
  }

  // text rendering — compact one-line-per-review summary
  if (filtered.length === 0) {
    const filterSegment = describeFilters(stateFilter, targetTypeFilter);
    process.stdout.write(`(no reviews${filterSegment})\n`);
    return 0;
  }
  process.stdout.write(`${filtered.length} review(s):\n`);
  for (const r of filtered) {
    const refTrunc = r.target.ref.length > 60 ? r.target.ref.slice(0, 57) + '...' : r.target.ref;
    process.stdout.write(
      `  ${r.id} [${r.state}] ${r.target.type}:${refTrunc}` +
        ` opened-by=${r.opened_by}` +
        ` entries=${r.entries.length}` +
        (r.suspensions.length > 0
          ? ` suspensions=${r.suspensions.length}`
          : '') +
        (r.isSuspended ? ` (currently paused)` : '') +
        `\n`,
    );
  }
  return 0;
}

function summarize(r: DevilReview): Record<string, unknown> {
  return {
    id: r.id,
    target: { type: r.target.type, ref: r.target.ref },
    state: r.state,
    opened_at: r.opened_at,
    opened_by: r.opened_by,
    entry_count: r.entries.length,
    suspension_count: r.suspensions.length,
    resume_count: r.resumes.length,
    re_run_count: r.re_run_history.length,
    is_suspended: r.isSuspended,
    has_conclusion: r.conclusion !== undefined,
  };
}

function describeFilters(
  state: ReviewState | undefined,
  targetType: ReturnType<typeof parseTargetType> | undefined,
): string {
  const parts: string[] = [];
  if (state !== undefined) parts.push(`state=${state}`);
  if (targetType !== undefined) parts.push(`target-type=${targetType}`);
  if (parts.length === 0) return '';
  return ` (filters: ${parts.join(', ')})`;
}
