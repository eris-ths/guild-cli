import { DevilReview, DevilReviewNotFound, parseReviewId } from '../../domain/DevilReview.js';
import { Entry } from '../../domain/Entry.js';
import { DevilReviewRepository } from '../../application/DevilReviewRepository.js';
import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';

const SHOW_KNOWN_FLAGS: ReadonlySet<string> = new Set(['format']);

/**
 * devil show — detail view of one review session.
 *
 * Usage:
 *   devil show <rev-id> [--format json|text]
 *
 * Reads only. Returns the full review including all entries,
 * suspensions, resumes, re_run_history, and conclusion if present.
 * The JSON form is review.toJSON() — same shape as the YAML on
 * disk so an agent can pipe `devil show <id> --format json` into
 * tooling without learning a second format.
 */
export interface ShowDeps {
  readonly reviews: DevilReviewRepository;
  readonly config: GuildConfig;
}

export async function showReview(deps: ShowDeps, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, SHOW_KNOWN_FLAGS, 'show');

  const reviewId = args.positional[0];
  if (!reviewId) {
    process.stderr.write(
      'error: positional <rev-id> required.\n  Usage: devil show <rev-id> [--format json|text]\n',
    );
    return 1;
  }
  parseReviewId(reviewId); // domain format check (throws DomainError)

  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    process.stderr.write(`error: --format must be 'json' or 'text', got: ${format}\n`);
    return 1;
  }

  const review = await deps.reviews.findById(reviewId);
  if (!review) throw new DevilReviewNotFound(reviewId);

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          review: review.toJSON(),
          where_read: deps.reviews.pathFor(review.id),
          config_file: deps.config.configFile,
        },
        null,
        2,
      ) + '\n',
    );
    return 0;
  }

  // text rendering — multi-line, agent + human readable
  process.stdout.write(formatReview(review));
  return 0;
}

function formatReview(r: DevilReview): string {
  const lines: string[] = [];
  lines.push(`${r.id} [${r.state}] against ${r.target.type}:${r.target.ref}`);
  lines.push(`opened: ${r.opened_at} by ${r.opened_by}`);
  if (r.isSuspended) {
    lines.push('(currently paused — last suspension not yet resumed)');
  }
  lines.push('');

  if (r.entries.length === 0) {
    lines.push('entries: (none yet)');
  } else {
    lines.push(`entries: (${r.entries.length})`);
    for (const e of r.entries) {
      lines.push(`  ${e.id}  [${formatEntryHeader(e)}]`);
      // Indent the text body; trim each line for clean display.
      for (const ln of e.text.split('\n')) {
        lines.push(`    ${ln}`);
      }
      if (e.addresses !== undefined) {
        lines.push(`    addresses: ${e.addresses}`);
      }
      if (e.kind === 'finding') {
        lines.push(`    severity_rationale: ${e.severity_rationale ?? ''}`);
        if (e.status === 'dismissed') {
          lines.push(
            `    dismissed: ${e.dismissal_reason ?? ''}` +
              (e.dismissal_note !== undefined ? ` — ${e.dismissal_note}` : ''),
          );
        }
        if (e.status === 'resolved' && e.resolved_by_commit !== undefined) {
          lines.push(`    resolved by commit: ${e.resolved_by_commit}`);
        }
      }
      if (e.kind === 'gate' && e.stages !== undefined) {
        lines.push(`    stages:`);
        for (const s of e.stages) {
          lines.push(`      ${s.name} → ${s.verdict}`);
          lines.push(`        ${s.reasoning}`);
        }
      }
    }
  }
  lines.push('');

  if (r.suspensions.length > 0) {
    lines.push(`suspensions: (${r.suspensions.length})`);
    r.suspensions.forEach((s, i) => {
      lines.push(`  [${i}] ${s.at} by ${s.by}`);
      lines.push(`      cliff: ${s.cliff}`);
      lines.push(`      invitation: ${s.invitation}`);
      const matchingResume = r.resumes[i];
      if (matchingResume !== undefined) {
        lines.push(
          `      resumed: ${matchingResume.at} by ${matchingResume.by}` +
            (matchingResume.note !== undefined ? ` — ${matchingResume.note}` : ''),
        );
      } else {
        lines.push(`      resumed: (not yet)`);
      }
    });
    lines.push('');
  }

  if (r.re_run_history.length > 0) {
    lines.push(`re-run history: (${r.re_run_history.length})`);
    for (const rr of r.re_run_history) {
      lines.push(`  ${rr.at} ${rr.source} by ${rr.by}`);
    }
    lines.push('');
  }

  if (r.conclusion !== undefined) {
    lines.push(`conclusion:`);
    lines.push(`  ${r.conclusion.at} by ${r.conclusion.by}`);
    lines.push(`  synthesis: ${r.conclusion.synthesis}`);
    if (r.conclusion.unresolved.length > 0) {
      lines.push(`  unresolved: ${r.conclusion.unresolved.join(', ')}`);
    }
  }

  return lines.join('\n') + '\n';
}

function formatEntryHeader(e: Entry): string {
  const parts: string[] = [`persona=${e.persona}`, `lense=${e.lense}`, `kind=${e.kind}`];
  if (e.kind === 'finding') {
    parts.push(`severity=${e.severity ?? '?'}`);
    parts.push(`status=${e.status ?? '?'}`);
  }
  parts.push(`by=${e.by}`);
  return parts.join(' / ');
}
