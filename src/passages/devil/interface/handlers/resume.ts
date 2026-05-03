import {
  DevilReviewAlreadyConcluded,
  DevilReviewNotFound,
  ResumeEntry,
  parseReviewId,
} from '../../domain/DevilReview.js';
import { DevilReviewRepository } from '../../application/DevilReviewRepository.js';
import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';
import { DomainError } from '../../../../domain/shared/DomainError.js';

const RESUME_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'note',
  'by',
  'format',
]);

/**
 * devil resume — pick up a previously suspended thread.
 *
 * Usage:
 *   devil resume <rev-id> [--note "<resume prose>"]
 *                         [--by <m>] [--format json|text]
 *
 * Pairs with suspend: resumes the most recent un-paired suspension.
 * State-derivation invariant (same as agora's Play, borrowed shape):
 *
 *   suspensions.length === resumes.length     → thread not paused
 *   suspensions.length === resumes.length + 1 → thread paused
 *
 * If no thread is currently paused (counts equal), resume refuses
 * with a structured error rather than silently appending.
 *
 * Surfaces the closing cliff/invitation in the success output so
 * the resuming actor reads the paused-on context without a
 * separate `devil show` query — substrate-side Zeigarnik per the
 * design borrowed from agora.
 *
 * Concluded reviews refuse resume (terminal-state refusal).
 *
 * Per principle 11: optimistic CAS via appendResume.
 */
export interface ResumeDeps {
  readonly reviews: DevilReviewRepository;
  readonly config: GuildConfig;
}

export async function resumeReview(
  deps: ResumeDeps,
  args: ParsedArgs,
): Promise<number> {
  rejectUnknownFlags(args, RESUME_KNOWN_FLAGS, 'resume');

  const reviewId = args.positional[0];
  if (!reviewId) {
    process.stderr.write(
      'error: positional <rev-id> required.\n' +
        '  Usage: devil resume <rev-id> [--note "..."] [--by <m>]\n',
    );
    return 1;
  }
  parseReviewId(reviewId);

  const note = optionalOption(args, 'note');

  const by = optionalOption(args, 'by', 'GUILD_ACTOR');
  if (!by) {
    process.stderr.write(
      'error: --by required (or set GUILD_ACTOR). devil resume attributes the re-entry.\n',
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
  if (!review.isSuspended) {
    throw new DomainError(
      `no thread is currently paused on ${review.id} ` +
        `(suspensions=${review.suspensions.length}, resumes=${review.resumes.length}). ` +
        `Resume requires a trailing suspension that hasn't been resumed yet.`,
      'state',
    );
  }

  // The suspension being resumed is the most recent un-paired one.
  // Per the invariant, suspensions.length === resumes.length + 1
  // when paused, so the entry being closed is at suspensions[resumes.length].
  const closing = review.suspensions[review.resumes.length];

  const entry: ResumeEntry = {
    at: new Date().toISOString(),
    by,
    ...(note !== undefined ? { note } : {}),
  };
  const resumeIndex = review.resumes.length;
  await deps.reviews.appendResume(review, resumeIndex, entry);

  const where_written = deps.reviews.pathFor(review.id);

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          review_id: review.id,
          state: review.state, // unchanged (open)
          resumed_suspension: closing
            ? {
                at: closing.at,
                by: closing.by,
                cliff: closing.cliff,
                invitation: closing.invitation,
              }
            : null,
          where_written,
          config_file: deps.config.configFile,
          suggested_next: {
            // After resume, the natural next move is an entry that
            // addresses the invitation (or another suspend if
            // addressing surfaces another thread). args.by
            // intentionally omitted (#122).
            verb: 'entry',
            args: { review_id: review.id },
            reason:
              'Thread resumed. The cliff and invitation that paused it are in resumed_suspension; address the invitation with a new entry, or pause again with a fresh cliff if a different thread surfaced.',
          },
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(
      `✓ thread resumed on ${review.id} [suspension #${resumeIndex}] by ${by}\n`,
    );
    if (closing) {
      process.stdout.write(
        `  closing cliff:      ${closing.cliff}\n` +
          `  closing invitation: ${closing.invitation}\n`,
      );
    }
    process.stdout.write(
      `  next: devil entry ${review.id} --persona <p> --lense <l> --kind <k> --text "<addresses the invitation>"\n`,
    );
  }
  return 0;
}
