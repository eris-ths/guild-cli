import {
  Conclusion,
  DevilReviewAlreadyConcluded,
  DevilReviewNotFound,
  parseReviewId,
} from '../../domain/DevilReview.js';
import { DevilReviewRepository } from '../../application/DevilReviewRepository.js';
import { LenseCatalog } from '../../application/LenseCatalog.js';
import {
  ParsedArgs,
  optionalOption,
  requireOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';
import { DomainError } from '../../../../domain/shared/DomainError.js';

const CONCLUDE_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'synthesis',
  'unresolved',
  'by',
  'format',
]);

/**
 * devil conclude — terminal state transition (open → concluded).
 *
 * Usage:
 *   devil conclude <rev-id> --synthesis "<prose>"
 *                            [--unresolved <e-001,e-002,...>]
 *                            [--by <m>] [--format json|text]
 *
 * --synthesis is required prose — devil-review's conclusion is
 * verdict-less by design (issue #126). The synthesis is what the
 * reviewer concluded across all lenses, not a single ok/concern
 * label. Empty synthesis defeats the purpose, so it's enforced
 * non-empty at the domain boundary.
 *
 * --unresolved is optional: a comma-separated list of entry ids
 * the reviewer chose not to dismiss-or-resolve before concluding.
 * Substrate-explicit "these threads are deliberately left open"
 * — distinct from "these are all closed", and distinct from
 * "we forgot to update them."
 *
 * Lense coverage gate (issue #126's substrate-as-floor design):
 *   Before flipping state, every lense in the catalog must have
 *   at least one entry in this review (a `kind: skip` entry
 *   counts when its text declares why the lense is irrelevant).
 *   Silent skipping defeats the floor-raising design — reviewers
 *   either touch the lense or explicitly skip with reason. The
 *   gate refuses conclude until the catalog is covered, naming
 *   the missing lenses so the reviewer knows what to add.
 *
 * Once concluded, no further entries / suspensions / resumes /
 * re-runs are accepted (terminal state).
 *
 * suggested_next is null per the terminal-verb convention agora's
 * conclude established.
 */
export interface ConcludeDeps {
  readonly reviews: DevilReviewRepository;
  readonly lenses: LenseCatalog;
  readonly config: GuildConfig;
}

export async function concludeReview(
  deps: ConcludeDeps,
  args: ParsedArgs,
): Promise<number> {
  rejectUnknownFlags(args, CONCLUDE_KNOWN_FLAGS, 'conclude');

  const reviewId = args.positional[0];
  if (!reviewId) {
    process.stderr.write(
      'error: positional <rev-id> required.\n' +
        '  Usage: devil conclude <rev-id> --synthesis "..." [--unresolved e-001,e-002,...] [--by <m>]\n',
    );
    return 1;
  }
  parseReviewId(reviewId);

  const synthesis = requireOption(
    args,
    'synthesis',
    '--synthesis required (verdict-less prose; what the review concluded across all lenses)',
  );
  const unresolvedRaw = optionalOption(args, 'unresolved');
  const unresolved: string[] = unresolvedRaw
    ? unresolvedRaw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : [];

  const by = optionalOption(args, 'by', 'GUILD_ACTOR');
  if (!by) {
    process.stderr.write(
      'error: --by required (or set GUILD_ACTOR). devil conclude attributes the close.\n',
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

  // Validate unresolved entry ids: every id must exist in this
  // review. The substrate stays honest — you can't reference an
  // entry that isn't there. Validated before the lense gate so a
  // typo in --unresolved surfaces immediately, regardless of
  // catalog coverage state.
  for (const id of unresolved) {
    if (review.findEntry(id) === null) {
      throw new DomainError(
        `unresolved entry id "${id}" not found in this review (entries: ${review.entries.map((e) => e.id).join(', ') || '(none)'})`,
        'unresolved',
      );
    }
  }

  // Lense coverage gate (issue #126 substrate-as-floor; surfaced
  // by mirror-persona dogfood e-006). Every lense in the catalog
  // must have at least one entry — `kind: skip` counts when its
  // text declares why the lense is irrelevant. The substrate
  // refuses silent skipping by construction.
  const catalogLenses = deps.lenses.names();
  const touchedLenses = new Set(review.entries.map((e) => e.lense));
  const missingLenses = catalogLenses.filter((l) => !touchedLenses.has(l));
  if (missingLenses.length > 0) {
    process.stderr.write(
      `error: cannot conclude — these lenses have no entries: ${missingLenses.join(', ')}\n` +
        `  Per #126's substrate-as-floor design, every lense in the catalog requires at least one entry before conclude.\n` +
        `  A 'skip' entry counts when explicitly declared with reason. For each missing lense:\n` +
        `    devil entry ${review.id} --persona <p> --lense <l> --kind skip --text "irrelevant because ..."\n`,
    );
    return 1;
  }

  const conclusion: Conclusion = {
    at: new Date().toISOString(),
    by,
    synthesis,
    unresolved,
  };

  await deps.reviews.saveConclusion(review, 'open', conclusion);

  const where_written = deps.reviews.pathFor(review.id);

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          review_id: review.id,
          state: 'concluded',
          from_state: 'open',
          conclusion: {
            at: conclusion.at,
            by: conclusion.by,
            synthesis: conclusion.synthesis,
            unresolved: conclusion.unresolved,
          },
          where_written,
          config_file: deps.config.configFile,
          // Terminal verb: no suggested_next. Same convention agora's
          // conclude uses (issue #119 / #122).
          suggested_next: null,
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(
      `✓ devil-review concluded: ${review.id} [open → concluded] by ${by}\n` +
        `  synthesis: ${synthesis}\n` +
        (unresolved.length > 0
          ? `  unresolved: ${unresolved.join(', ')}\n`
          : '') +
        `  this review is now terminal — no further entries, suspensions, resumes, or re-runs.\n`,
    );
  }
  return 0;
}
