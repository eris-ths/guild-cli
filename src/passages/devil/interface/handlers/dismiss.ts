import {
  DevilReviewAlreadyConcluded,
  DevilReviewNotFound,
  parseReviewId,
} from '../../domain/DevilReview.js';
import {
  DismissalReason,
  Entry,
  parseDismissalReason,
  parseEntryId,
} from '../../domain/Entry.js';
import { DevilReviewRepository } from '../../application/DevilReviewRepository.js';
import {
  ParsedArgs,
  optionalOption,
  requireOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';

const DISMISS_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'reason',
  'note',
  'by',
  'format',
]);

/**
 * devil dismiss — mark a finding-entry dismissed with a structured reason.
 *
 * Usage:
 *   devil dismiss <rev-id> <entry-id> --reason <r>
 *                                      [--note "<prose>"]
 *                                      [--by <m>] [--format json|text]
 *
 * --reason is one of: not-applicable | accepted-risk | false-positive
 *                     out-of-scope | mitigated-elsewhere (per #126).
 *
 * Only `kind=finding` entries with `status=open` are dismissable in v0.
 * Already-dismissed or already-resolved entries surface a structured
 * error rather than silent re-dismiss. The substrate refuses to lose
 * the dismissal-trail audit value to a careless re-call.
 *
 * Concluded reviews refuse dismiss (terminal state). The review's
 * conclusion already named whatever the reviewer wanted to leave
 * unresolved — re-mutating findings after close defeats that
 * substrate-level final-statement.
 *
 * Per principle 11: optimistic CAS via replaceEntry — concurrent
 * status-mutators on the same finding surface a structured conflict.
 */
export interface DismissDeps {
  readonly reviews: DevilReviewRepository;
  readonly config: GuildConfig;
}

export async function dismissEntry(
  deps: DismissDeps,
  args: ParsedArgs,
): Promise<number> {
  rejectUnknownFlags(args, DISMISS_KNOWN_FLAGS, 'dismiss');

  const reviewId = args.positional[0];
  const entryId = args.positional[1];
  if (!reviewId || !entryId) {
    process.stderr.write(
      'error: positional <rev-id> AND <entry-id> required.\n' +
        '  Usage: devil dismiss <rev-id> <entry-id> --reason <r> [--note "..."] [--by <m>]\n',
    );
    return 1;
  }
  parseReviewId(reviewId);
  parseEntryId(entryId);

  const reasonRaw = requireOption(
    args,
    'reason',
    '--reason required (one of: not-applicable | accepted-risk | false-positive | out-of-scope | mitigated-elsewhere)',
  );
  const reason: DismissalReason = parseDismissalReason(reasonRaw);
  const note = optionalOption(args, 'note');

  const by = optionalOption(args, 'by') ?? process.env['GUILD_ACTOR'];
  if (!by) {
    process.stderr.write(
      'error: --by required (or set GUILD_ACTOR). devil dismiss attributes the dismissal.\n',
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
      `error: only kind='finding' entries can be dismissed (got kind='${target.kind}' on ${entryId}).\n` +
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

  // Build a new Entry with status=dismissed + reason (+ optional note),
  // preserving every other field from the original. Entry instances
  // are immutable values; the repository swaps the old at the same id
  // slot via replaceEntry.
  //
  // target.severity / severity_rationale are present here because
  // Entry.create enforces them when kind='finding'. The conditional
  // spreads keep TS's exactOptionalPropertyTypes mode happy by not
  // passing `undefined` explicitly.
  const dismissed = Entry.create({
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
    status: 'dismissed',
    dismissal_reason: reason,
    ...(note !== undefined ? { dismissal_note: note } : {}),
    ...(target.addresses !== undefined ? { addresses: target.addresses } : {}),
  });

  await deps.reviews.replaceEntry(review, review.entries.length, target.id, dismissed);

  const where_written = deps.reviews.pathFor(review.id);

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          review_id: review.id,
          entry_id: target.id,
          status: 'dismissed',
          dismissal_reason: reason,
          ...(note !== undefined ? { dismissal_note: note } : {}),
          dismissed_by: by,
          where_written,
          config_file: deps.config.configFile,
          suggested_next: {
            // After a dismiss, the natural next moves are: continue
            // reviewing other findings (entry), or close the review
            // (conclude). args.by intentionally omitted (#122).
            verb: 'show',
            args: { review_id: review.id },
            reason:
              'Finding dismissed. The dismissal reason is now in the substrate; show to verify, continue with another entry, or conclude when the review is complete.',
          },
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(
      `✓ entry ${target.id} dismissed in ${review.id} [reason=${reason}] by ${by}\n` +
        (note !== undefined ? `  note: ${note}\n` : '') +
        `  next: devil show ${review.id}  (verify the dismissal trail)\n` +
        `        or devil entry ${review.id} ...  (continue review)\n` +
        `        or devil conclude ${review.id} --synthesis "..."  (close)\n`,
    );
  }
  return 0;
}
