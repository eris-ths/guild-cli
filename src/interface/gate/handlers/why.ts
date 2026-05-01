import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { C } from './internal.js';
import { Request } from '../../../domain/request/Request.js';

const WHY_KNOWN_FLAGS: ReadonlySet<string> = new Set(['format']);

/**
 * gate why <id> [--format text|json]
 *
 * Trace the decision chain that led to the current state. Extracts
 * the reviews that influenced the outcome — not all reviews, just
 * the ones whose verdicts aligned with or contested the terminal
 * state. Read-only.
 *
 * The verb answers "why did this end up here?" by surfacing:
 *   - The terminal transition (who moved it to the final state, why)
 *   - Reviews that aligned with the outcome (predicted it)
 *   - Reviews that contested the outcome (were overridden)
 *
 * This is perception, not judgement (principle 07): the tool shows
 * which voices were heard and which weren't, but does not say
 * whether the decision was correct.
 */

interface WhyPayload {
  id: string;
  state: string;
  terminal_transition: {
    by: string;
    state: string;
    at: string;
    note: string | null;
  } | null;
  aligned_reviews: Array<{
    by: string;
    lense: string;
    verdict: string;
    comment: string;
  }>;
  contested_reviews: Array<{
    by: string;
    lense: string;
    verdict: string;
    comment: string;
  }>;
  review_count: number;
}

export async function whyCmd(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, WHY_KNOWN_FLAGS, 'why');
  const id = args.positional[0];
  if (!id) throw new Error('Usage: gate why <id> [--format text|json]');
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'text' && format !== 'json') {
    throw new Error(`--format must be 'text' or 'json', got: ${format}`);
  }
  const r = await c.requestUC.show(id);
  if (!r) {
    process.stderr.write(`not found: ${id}\n`);
    return 1;
  }
  const payload = buildWhy(r);
  if (format === 'json') {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    process.stdout.write(renderWhyText(payload) + '\n');
  }
  return 0;
}

function buildWhy(r: Request): WhyPayload {
  const j = r.toJSON();
  const id = String(j['id']);
  const state = String(j['state']);
  const log = Array.isArray(j['status_log'])
    ? (j['status_log'] as Array<Record<string, unknown>>)
    : [];
  const reviews = Array.isArray(j['reviews'])
    ? (j['reviews'] as Array<Record<string, unknown>>)
    : [];

  const lastEntry = log.length > 0 ? log[log.length - 1]! : null;
  const terminalTransition = lastEntry
    ? {
        by: String(lastEntry['by'] ?? ''),
        state: String(lastEntry['state'] ?? ''),
        at: String(lastEntry['at'] ?? ''),
        note: typeof lastEntry['note'] === 'string'
          ? (lastEntry['note'] as string)
          : null,
      }
    : null;

  const isPositiveOutcome = state === 'completed' || state === 'approved' || state === 'executing';

  const aligned: WhyPayload['aligned_reviews'] = [];
  const contested: WhyPayload['contested_reviews'] = [];

  for (const rv of reviews) {
    const verdict = String(rv['verdict'] ?? '');
    const entry = {
      by: String(rv['by'] ?? ''),
      lense: String(rv['lense'] ?? ''),
      verdict,
      comment: String(rv['comment'] ?? '').trim(),
    };
    if (isPositiveOutcome) {
      if (verdict === 'ok') aligned.push(entry);
      else contested.push(entry);
    } else {
      if (verdict === 'concern' || verdict === 'reject') aligned.push(entry);
      else contested.push(entry);
    }
  }

  return {
    id,
    state,
    terminal_transition: terminalTransition,
    aligned_reviews: aligned,
    contested_reviews: contested,
    review_count: reviews.length,
  };
}

function renderWhyText(p: WhyPayload): string {
  const lines: string[] = [];
  lines.push(`# why ${p.id} → ${p.state}`);
  lines.push('');

  if (p.terminal_transition) {
    const t = p.terminal_transition;
    const note = t.note ? `: "${t.note}"` : '';
    lines.push(`terminal: ${t.by} → ${t.state} at ${t.at}${note}`);
  } else {
    lines.push('terminal: (no transitions recorded)');
  }

  lines.push('');

  if (p.aligned_reviews.length > 0) {
    lines.push(`aligned with outcome (${p.aligned_reviews.length}):`);
    for (const r of p.aligned_reviews) {
      const short = r.comment.length > 80
        ? r.comment.slice(0, 77) + '...'
        : r.comment;
      lines.push(`  [${r.lense}/${r.verdict}] ${r.by}: ${short}`);
    }
  } else {
    lines.push('aligned: (none)');
  }

  lines.push('');

  if (p.contested_reviews.length > 0) {
    lines.push(`contested outcome (${p.contested_reviews.length}):`);
    for (const r of p.contested_reviews) {
      const short = r.comment.length > 80
        ? r.comment.slice(0, 77) + '...'
        : r.comment;
      lines.push(`  [${r.lense}/${r.verdict}] ${r.by}: ${short}`);
    }
  } else {
    lines.push('contested: (none)');
  }

  return lines.join('\n');
}
