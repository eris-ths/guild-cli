import {
  DevilReviewAlreadyConcluded,
  DevilReviewNotFound,
  SuspensionEntry,
  parseReviewId,
} from '../../domain/DevilReview.js';
import { DevilReviewRepository } from '../../application/DevilReviewRepository.js';
import {
  ParsedArgs,
  optionalOption,
  requireOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';

const SUSPEND_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'cliff',
  'invitation',
  'by',
  'format',
]);

/**
 * devil suspend — record a cliff/invitation pause on a review.
 *
 * Usage:
 *   devil suspend <rev-id> --cliff "<what just happened>"
 *                          --invitation "<what the next opener should do>"
 *                          [--by <m>] [--format json|text]
 *
 * Borrowed shape from agora's suspend (issue #117), with softer
 * semantics:
 *
 *   In agora, suspend FLIPS state to "suspended" and BLOCKS subsequent
 *   moves until resume restores "playing". The substrate-side
 *   Zeigarnik effect operates by gating the action surface.
 *
 *   In devil-review (per issue #126), state is only `open|concluded`.
 *   suspend/resume cycles are append-only HISTORY of "I paused here";
 *   they do NOT block other entries. Multiple reviewers can keep
 *   working while a thread is paused. The cliff/invitation simply
 *   records re-entry context for whoever picks up that thread later.
 *
 * Both --cliff and --invitation are required because the design
 * pivot (#126) says "an empty suspension defeats the design." A
 * reviewer leaving a thread paused must declare what they were on
 * and what the next opener of that thread should attempt.
 *
 * Per principle 11: optimistic CAS via appendSuspension.
 */
export interface SuspendDeps {
  readonly reviews: DevilReviewRepository;
  readonly config: GuildConfig;
}

export async function suspendReview(
  deps: SuspendDeps,
  args: ParsedArgs,
): Promise<number> {
  rejectUnknownFlags(args, SUSPEND_KNOWN_FLAGS, 'suspend');

  const reviewId = args.positional[0];
  if (!reviewId) {
    process.stderr.write(
      'error: positional <rev-id> required.\n' +
        '  Usage: devil suspend <rev-id> --cliff "..." --invitation "..." [--by <m>]\n',
    );
    return 1;
  }
  parseReviewId(reviewId);

  const cliff = requireOption(
    args,
    'cliff',
    '--cliff required (what just happened — the unfinished thread)',
  );
  const invitation = requireOption(
    args,
    'invitation',
    '--invitation required (what the next opener of this thread should attempt)',
  );

  const by = optionalOption(args, 'by') ?? process.env['GUILD_ACTOR'];
  if (!by) {
    process.stderr.write(
      'error: --by required (or set GUILD_ACTOR). devil suspend attributes the pause.\n',
    );
    return 1;
  }
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    process.stderr.write(`error: --format must be 'json' or 'text', got: ${format}\n`);
    return 1;
  }

  const review = await deps.reviews.findById(reviewId);
  if (!review) throw new DevilReviewNotFound(reviewId);
  if (review.state === 'concluded') {
    throw new DevilReviewAlreadyConcluded(review.id);
  }

  const entry: SuspensionEntry = {
    at: new Date().toISOString(),
    by,
    cliff,
    invitation,
  };
  const suspensionIndex = review.suspensions.length; // new entry's index
  await deps.reviews.appendSuspension(review, suspensionIndex, entry);

  const where_written = deps.reviews.pathFor(review.id);

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          review_id: review.id,
          // No state flip — devil-review doesn't have a 'suspended'
          // state. The pause is append-only history; entries continue.
          state: review.state,
          suspension_index: suspensionIndex,
          where_written,
          config_file: deps.config.configFile,
          suggested_next: {
            // After suspend, the natural next move is resume by
            // someone re-entering the thread. args.by intentionally
            // omitted (#122) — the resumer is often a different
            // actor (or a different session of the same actor).
            verb: 'resume',
            args: { review_id: review.id },
            reason:
              'Thread paused with cliff + invitation recorded. The next instance reading this review sees the suspension and can act on the invitation. Other reviewers continue adding entries (softer semantics than agora — suspend does NOT block).',
          },
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(
      `✓ thread suspended on ${review.id} [suspension #${suspensionIndex}] by ${by}\n` +
        `  cliff:      ${cliff}\n` +
        `  invitation: ${invitation}\n` +
        `  next: devil resume ${review.id} --by <m>  (when re-entering this thread)\n` +
        `        — other entries on this review are not blocked; suspension is just a re-entry context for this thread\n`,
    );
  }
  return 0;
}
