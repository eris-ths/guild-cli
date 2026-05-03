import {
  DevilReviewAlreadyConcluded,
  DevilReviewNotFound,
  parseReviewId,
} from '../../domain/DevilReview.js';
import { Entry, parseEntryId } from '../../domain/Entry.js';
import { DevilReviewRepository } from '../../application/DevilReviewRepository.js';
import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';

const RESOLVE_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'commit',
  'by',
  'format',
]);

/**
 * devil resolve — mark a finding-entry resolved, optionally citing a commit.
 *
 * Usage:
 *   devil resolve <rev-id> <entry-id> [--commit <sha>]
 *                                      [--by <m>] [--format json|text]
 *
 * --commit is optional but recommended: when present, the substrate
 * carries `resolved_by_commit` so a future audit can hop from the
 * finding to the fix without external bookkeeping. Mirrors the way
 * gate's request_log carries provenance.
 *
 * Only `kind=finding` entries with `status=open` are resolvable. The
 * substrate refuses re-resolve / refuses flipping a dismissed entry
 * to resolved (or vice versa). If the prior status was wrong, file a
 * new entry that --addresses the disputed one explaining the
 * disagreement — substrate stays append-only at the contest level.
 *
 * Concluded reviews refuse resolve (terminal-state refusal). Same
 * shape as dismiss; the conclusion already named whatever was
 * unresolved.
 *
 * Per principle 11: optimistic CAS via replaceEntry.
 */
export interface ResolveDeps {
  readonly reviews: DevilReviewRepository;
  readonly config: GuildConfig;
}

export async function resolveEntry(
  deps: ResolveDeps,
  args: ParsedArgs,
): Promise<number> {
  rejectUnknownFlags(args, RESOLVE_KNOWN_FLAGS, 'resolve');

  const reviewId = args.positional[0];
  const entryId = args.positional[1];
  if (!reviewId || !entryId) {
    process.stderr.write(
      'error: positional <rev-id> AND <entry-id> required.\n' +
        '  Usage: devil resolve <rev-id> <entry-id> [--commit <sha>] [--by <m>]\n',
    );
    return 1;
  }
  parseReviewId(reviewId);
  parseEntryId(entryId);

  const commit = optionalOption(args, 'commit');
  if (commit !== undefined && commit.trim().length === 0) {
    process.stderr.write('error: --commit must be non-empty when set.\n');
    return 1;
  }

  const by = optionalOption(args, 'by') ?? process.env['GUILD_ACTOR'];
  if (!by) {
    process.stderr.write(
      'error: --by required (or set GUILD_ACTOR). devil resolve attributes the resolution.\n',
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

  const target = review.findEntry(entryId);
  if (target === null) {
    process.stderr.write(
      `error: entry "${entryId}" not found in ${review.id} ` +
        `(entries: ${review.entries.map((e) => e.id).join(', ') || '(none)'})\n`,
    );
    return 1;
  }
  if (target.kind !== 'finding') {
    process.stderr.write(
      `error: only kind='finding' entries can be resolved (got kind='${target.kind}' on ${entryId}).\n` +
        `  assumption / resistance / synthesis entries don't carry status — they're held as substrate, not transitioned.\n`,
    );
    return 1;
  }
  if (target.status !== 'open') {
    process.stderr.write(
      `error: entry ${entryId} status is '${target.status}', not 'open' — refusing to overwrite the existing transition.\n` +
        `  If the prior status is wrong, file a new entry that --addresses ${entryId} explaining the disagreement.\n`,
    );
    return 1;
  }

  // Build a new Entry with status=resolved (+ optional resolved_by_commit),
  // preserving every other field. See dismiss.ts for the same
  // immutability-+-CAS-replace pattern.
  const resolved = Entry.create({
    id: target.id,
    at: target.at,
    by: target.by,
    persona: target.persona,
    lense: target.lense,
    kind: target.kind,
    text: target.text,
    ...(target.severity !== undefined ? { severity: target.severity } : {}),
    ...(target.severity_rationale !== undefined
      ? { severity_rationale: target.severity_rationale }
      : {}),
    status: 'resolved',
    ...(commit !== undefined ? { resolved_by_commit: commit } : {}),
    ...(target.addresses !== undefined ? { addresses: target.addresses } : {}),
  });

  await deps.reviews.replaceEntry(review, review.entries.length, target.id, resolved);

  const where_written = deps.reviews.pathFor(review.id);

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          review_id: review.id,
          entry_id: target.id,
          status: 'resolved',
          ...(commit !== undefined ? { resolved_by_commit: commit } : {}),
          resolved_by: by,
          where_written,
          config_file: deps.config.configFile,
          suggested_next: {
            // After resolve, natural next is verify via show, continue
            // reviewing other findings, or close. args.by intentionally
            // omitted (#122).
            verb: 'show',
            args: { review_id: review.id },
            reason:
              'Finding resolved. The fix linkage (resolved_by_commit) is now in the substrate when set; show to verify, continue with another entry, or conclude when the review is complete.',
          },
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(
      `✓ entry ${target.id} resolved in ${review.id} by ${by}\n` +
        (commit !== undefined ? `  commit: ${commit}\n` : '') +
        `  next: devil show ${review.id}  (verify the fix linkage)\n` +
        `        or devil entry ${review.id} ...  (continue review)\n` +
        `        or devil conclude ${review.id} --synthesis "..."  (close)\n`,
    );
  }
  return 0;
}
