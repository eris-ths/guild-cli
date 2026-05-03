import {
  DevilReview,
  DevilReviewAlreadyConcluded,
  DevilReviewNotFound,
  parseReviewId,
} from '../../domain/DevilReview.js';
import {
  Entry,
  EntryKind,
  Severity,
  parseEntryKind,
  parseSeverity,
} from '../../domain/Entry.js';
import { LenseNotFound } from '../../domain/Lense.js';
import {
  PersonaIsIngestOnly,
  PersonaNotFound,
} from '../../domain/Persona.js';
import { DevilReviewRepository } from '../../application/DevilReviewRepository.js';
import { LenseCatalog } from '../../application/LenseCatalog.js';
import { PersonaCatalog } from '../../application/PersonaCatalog.js';
import {
  ParsedArgs,
  optionalOption,
  requireOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';

const ENTRY_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'persona',
  'lense',
  'kind',
  'text',
  'severity',
  'severity-rationale',
  'addresses',
  'by',
  'format',
]);

/**
 * devil entry — append a hand-rolled review entry.
 *
 * Usage:
 *   devil entry <rev-id> --persona <p> --lense <l> --kind <k>
 *                        --text "<prose>"
 *                        [--severity <c|h|m|l|info>]
 *                        [--severity-rationale "<prose>"]
 *                        [--addresses <entry-id>]
 *                        [--by <m>] [--format json|text]
 *
 * Per-kind required flags:
 *   finding   — --severity AND --severity-rationale required.
 *               status defaults to 'open' (use `devil dismiss` /
 *               `devil resolve` to transition status afterward).
 *   skip      — text declares why the lense is irrelevant.
 *   assumption / resistance / synthesis — base fields only.
 *   gate      — REJECTED via this verb. multi-stage automated
 *               check output goes through `devil ingest`, which
 *               can structure stages[] from a JSON file. Building
 *               stages[] from CLI flags would be too brittle.
 *
 * --persona must exist in the catalog AND not be ingest_only
 * (only `devil ingest` may attribute to ingest-only personas).
 *
 * --lense must exist in the catalog. Custom lenses (per-content_root
 * YAML overrides) land later; v0 catalog is the 11 bundled defaults.
 *
 * State-machine boundary: only `open` reviews accept entries.
 * Concluded reviews surface DevilReviewAlreadyConcluded.
 *
 * AI-natural per principle 11: optimistic CAS on entries.length so
 * concurrent appenders detect each other (DevilReviewVersionConflict).
 */
export interface EntryDeps {
  readonly reviews: DevilReviewRepository;
  readonly lenses: LenseCatalog;
  readonly personas: PersonaCatalog;
  readonly config: GuildConfig;
}

export async function entryOnReview(
  deps: EntryDeps,
  args: ParsedArgs,
): Promise<number> {
  rejectUnknownFlags(args, ENTRY_KNOWN_FLAGS, 'entry');

  const reviewId = args.positional[0];
  if (!reviewId) {
    process.stderr.write(
      'error: positional <rev-id> required.\n' +
        '  Usage: devil entry <rev-id> --persona <p> --lense <l> --kind <k> --text "..."\n',
    );
    return 1;
  }
  parseReviewId(reviewId); // domain-level format check

  const personaName = requireOption(args, 'persona', '--persona required');
  const lenseName = requireOption(args, 'lense', '--lense required');
  const kindRaw = requireOption(
    args,
    'kind',
    '--kind required (finding|assumption|resistance|skip|synthesis)',
  );
  const text = requireOption(args, 'text', '--text required');

  const by = optionalOption(args, 'by') ?? process.env['GUILD_ACTOR'];
  if (!by) {
    process.stderr.write(
      'error: --by required (or set GUILD_ACTOR). devil entry attributes the entry author.\n',
    );
    return 1;
  }
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    process.stderr.write(`error: --format must be 'json' or 'text', got: ${format}\n`);
    return 1;
  }

  // Catalog resolution. Throw structured errors so the dispatcher
  // surfaces them as named failures rather than generic message text.
  const persona = deps.personas.find(personaName);
  if (!persona) throw new PersonaNotFound(personaName);
  if (persona.ingest_only) throw new PersonaIsIngestOnly(personaName);

  const lense = deps.lenses.find(lenseName);
  if (!lense) throw new LenseNotFound(lenseName);

  // Kind handling. `gate` is reserved for ingest paths.
  const kind: EntryKind = parseEntryKind(kindRaw);
  if (kind === 'gate') {
    process.stderr.write(
      "error: kind='gate' is rejected by `devil entry` — multi-stage check output goes through `devil ingest` (which structures stages[] from a JSON input file). " +
        'See issue #126.\n',
    );
    return 1;
  }

  // finding-only flags: severity + severity_rationale.
  let severity: Severity | undefined;
  let severityRationale: string | undefined;
  if (kind === 'finding') {
    const sevRaw = optionalOption(args, 'severity');
    if (!sevRaw) {
      process.stderr.write(
        "error: --severity required when --kind=finding (critical|high|medium|low|info)\n",
      );
      return 1;
    }
    severity = parseSeverity(sevRaw);
    severityRationale = optionalOption(args, 'severity-rationale');
    if (!severityRationale) {
      process.stderr.write(
        "error: --severity-rationale required when --kind=finding " +
          '(prose explaining why this severity in this codebase, per Claude Security influence).\n',
      );
      return 1;
    }
  } else {
    // Catch misuse: caller passed --severity for a non-finding entry.
    if (optionalOption(args, 'severity') !== undefined) {
      process.stderr.write(
        `error: --severity only valid when --kind=finding (got --kind=${kind})\n`,
      );
      return 1;
    }
    if (optionalOption(args, 'severity-rationale') !== undefined) {
      process.stderr.write(
        `error: --severity-rationale only valid when --kind=finding (got --kind=${kind})\n`,
      );
      return 1;
    }
  }

  const addresses = optionalOption(args, 'addresses');

  // Load review, refuse if concluded.
  const review = await deps.reviews.findById(reviewId);
  if (!review) throw new DevilReviewNotFound(reviewId);
  if (review.state === 'concluded') {
    throw new DevilReviewAlreadyConcluded(review.id);
  }

  // Allocate next entry id (e-NNN sequence within this review).
  const entryId = `e-${String(review.entries.length + 1).padStart(3, '0')}`;

  const entry = Entry.create({
    id: entryId,
    at: new Date().toISOString(),
    by,
    persona: persona.name,
    lense: lense.name,
    kind,
    text,
    ...(severity !== undefined ? { severity } : {}),
    ...(severityRationale !== undefined
      ? { severity_rationale: severityRationale }
      : {}),
    ...(kind === 'finding' ? { status: 'open' as const } : {}),
    ...(addresses !== undefined ? { addresses } : {}),
  });

  await deps.reviews.appendEntry(review, review.entries.length, entry);

  const where_written = deps.reviews.pathFor(review.id);

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          review_id: review.id,
          entry_id: entry.id,
          persona: persona.name,
          lense: lense.name,
          kind: entry.kind,
          where_written,
          config_file: deps.config.configFile,
          suggested_next: nextSuggestion(review, entry, kind),
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(
      `✓ entry ${entry.id} appended to ${review.id} ` +
        `[persona=${persona.name}, lense=${lense.name}, kind=${entry.kind}] by ${by}\n` +
        `  next: devil entry ${review.id} --persona <p> --lense <l> --kind <k> --text "..."  (continue)\n` +
        `        or devil conclude ${review.id} --synthesis "..."  (close with synthesis)\n`,
    );
  }
  return 0;
}

function nextSuggestion(
  review: DevilReview,
  entry: Entry,
  kind: EntryKind,
): {
  verb: string;
  args: Record<string, string>;
  reason: string;
} {
  // After a finding, the natural next move is often dismiss or
  // resolve. After non-findings, continue with another entry or
  // conclude. We keep the reason prose factual; the verb advisory
  // points at `entry` (continuation) by default since it covers
  // the broadest case. args.by intentionally omitted (#122).
  if (kind === 'finding') {
    return {
      verb: 'entry',
      args: { review_id: review.id },
      reason:
        'Finding appended with status=open. Continue with another entry, dismiss the finding via `devil dismiss` if false-positive, mark resolved via `devil resolve` once a fix lands, or close the review via `devil conclude --synthesis "..."`.',
    };
  }
  return {
    verb: 'entry',
    args: { review_id: review.id },
    reason: `Entry of kind=${entry.kind} appended. Continue with another entry, leave a cliff via \`devil suspend\`, or close the review via \`devil conclude --synthesis "..."\`.`,
  };
}
