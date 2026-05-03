import { DevilReview, Target, parseTargetType } from '../../domain/DevilReview.js';
import { DevilReviewRepository } from '../../application/DevilReviewRepository.js';
import {
  ParsedArgs,
  optionalOption,
  requireOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';

const OPEN_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'type',
  'by',
  'format',
]);

/**
 * devil open — start a new review session against a target.
 *
 * Usage:
 *   devil open <target-ref> --type <pr|file|function|commit>
 *                           [--by <m>] [--format json|text]
 *
 * Produces: <content_root>/devil/reviews/<rev-id>.yaml where
 * <rev-id> = rev-YYYY-MM-DD-NNN (sequence per content_root per day).
 *
 * Initial state: open. Subsequent verbs (entry / ingest / dismiss /
 * resolve / suspend / resume / conclude) drive the lifecycle.
 *
 * The target is what's being reviewed:
 *   pr        — a GitHub PR URL ("https://github.com/.../pull/N")
 *   file      — a path under the repo
 *   function  — a symbol identifier (informal; for narrow reviews)
 *   commit    — a commit sha
 *
 * AI-first per principle 11: --by attribution is required (or
 * GUILD_ACTOR), the same shape gate / agora use.
 */
export interface OpenDeps {
  readonly reviews: DevilReviewRepository;
  readonly config: GuildConfig;
}

export async function openReview(deps: OpenDeps, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, OPEN_KNOWN_FLAGS, 'open');

  const ref = args.positional[0];
  if (!ref) {
    process.stderr.write(
      'error: positional <target-ref> required.\n' +
        '  Usage: devil open <target-ref> --type <pr|file|function|commit> [--by <m>]\n',
    );
    return 1;
  }

  const typeRaw = requireOption(
    args,
    'type',
    '--type required (pr|file|function|commit)',
  );
  // parseTargetType throws DomainError on invalid input — let it
  // bubble to the dispatcher's catch (turns into stderr error: ...).
  const type = parseTargetType(typeRaw);

  const by = optionalOption(args, 'by') ?? process.env['GUILD_ACTOR'];
  if (!by) {
    process.stderr.write(
      'error: --by required (or set GUILD_ACTOR). devil open attributes the review opener.\n',
    );
    return 1;
  }
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    process.stderr.write(`error: --format must be 'json' or 'text', got: ${format}\n`);
    return 1;
  }

  // Allocate sequence: rev-YYYY-MM-DD-NNN. The dateKey comes from the
  // runtime clock — same source pattern as agora play and gate
  // request id allocation.
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const seq = await deps.reviews.nextSequence(today);
  const reviewId = `rev-${today}-${String(seq).padStart(3, '0')}`;

  const target: Target = { type, ref };
  const review = DevilReview.open({
    id: reviewId,
    target,
    opened_by: by,
  });

  const where_written = deps.reviews.pathFor(review.id);
  await deps.reviews.saveNew(review);

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          review_id: review.id,
          target: { type: target.type, ref: target.ref },
          state: review.state,
          where_written,
          config_file: deps.config.configFile,
          suggested_next: {
            // args.by intentionally omitted — devil-review review
            // sessions accept multi-actor entries by default; the
            // opener doesn't bind subsequent --by. Same alternation-
            // neutral policy as agora (issue #122).
            verb: 'entry',
            args: { review_id: review.id },
            reason:
              'Review opened. Add an entry per lense as red-team / author-defender / mirror, or ingest from /ultrareview / claude-security / scg. Concluding requires at least one entry per requested lense.',
          },
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(
      `✓ devil-review opened: ${review.id} [${review.state}] against ${target.type}:${target.ref} by ${by}\n` +
        `  next: devil entry ${review.id} --persona <p> --lense <l> --kind <k> --text "..."\n` +
        `        or devil ingest ${review.id} --from <ultrareview|claude-security|scg> <input>\n`,
    );
  }
  const configSegment =
    deps.config.configFile === null
      ? 'config: none — cwd used as fallback root'
      : `config: ${deps.config.configFile}`;
  process.stderr.write(`notice: wrote ${where_written} (${configSegment})\n`);
  return 0;
}
