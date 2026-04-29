import { ParsedArgs, optionalOption } from '../../shared/parseArgs.js';
import { C } from './internal.js';
import { Request } from '../../../domain/request/Request.js';

/**
 * gate summarize <id> [--format text|json]
 *
 * Compressed view of a request's current state: decision, risks,
 * and unresolved items. Where transcript tells the full story,
 * summarize tells the conclusion. Read-only.
 *
 * Designed for the "I have 30 seconds" reader who needs:
 *   - What state is this in?
 *   - What concerns remain open?
 *   - What was the final decision and who made it?
 * without parsing the full status_log + reviews array.
 */

interface SummarizePayload {
  id: string;
  state: string;
  decision: string;
  open_concerns: Array<{
    by: string;
    lense: string;
    verdict: string;
    comment: string;
  }>;
  review_count: number;
  thank_count: number;
  actors: readonly string[];
}

export async function summarizeCmd(c: C, args: ParsedArgs): Promise<number> {
  const id = args.positional[0];
  if (!id) throw new Error('Usage: gate summarize <id> [--format text|json]');
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'text' && format !== 'json') {
    throw new Error(`--format must be 'text' or 'json', got: ${format}`);
  }
  const r = await c.requestUC.show(id);
  if (!r) {
    process.stderr.write(`not found: ${id}\n`);
    return 1;
  }
  const payload = buildSummary(r);
  if (format === 'json') {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    process.stdout.write(renderSummaryText(payload) + '\n');
  }
  return 0;
}

function buildSummary(r: Request): SummarizePayload {
  const j = r.toJSON();
  const id = String(j['id']);
  const state = String(j['state']);
  const log = Array.isArray(j['status_log'])
    ? (j['status_log'] as Array<Record<string, unknown>>)
    : [];
  const reviews = Array.isArray(j['reviews'])
    ? (j['reviews'] as Array<Record<string, unknown>>)
    : [];
  const thanks = Array.isArray(j['thanks'])
    ? (j['thanks'] as Array<Record<string, unknown>>)
    : [];

  const lastEntry = log.length > 0 ? log[log.length - 1]! : null;
  const decision = lastEntry
    ? `${lastEntry['by']} → ${lastEntry['state']}` +
      (lastEntry['note'] ? `: ${lastEntry['note']}` : '')
    : '(no transitions)';

  const openConcerns: SummarizePayload['open_concerns'] = [];
  for (const rv of reviews) {
    const verdict = String(rv['verdict'] ?? '');
    if (verdict === 'concern' || verdict === 'reject') {
      openConcerns.push({
        by: String(rv['by'] ?? ''),
        lense: String(rv['lense'] ?? ''),
        verdict,
        comment: String(rv['comment'] ?? '').trim(),
      });
    }
  }

  const actors = new Set<string>();
  for (const e of log) {
    if (typeof e['by'] === 'string') actors.add(e['by']);
  }
  for (const rv of reviews) {
    if (typeof rv['by'] === 'string') actors.add(rv['by']);
  }

  return {
    id,
    state,
    decision,
    open_concerns: openConcerns,
    review_count: reviews.length,
    thank_count: thanks.length,
    actors: [...actors],
  };
}

function renderSummaryText(p: SummarizePayload): string {
  const lines: string[] = [];
  lines.push(`# ${p.id} — ${p.state}`);
  lines.push('');
  lines.push(`decision:  ${p.decision}`);
  lines.push(`reviews:   ${p.review_count}    thanks: ${p.thank_count}`);
  lines.push(`actors:    ${p.actors.join(', ')}`);

  if (p.open_concerns.length > 0) {
    lines.push('');
    lines.push(`open concerns (${p.open_concerns.length}):`);
    for (const c of p.open_concerns) {
      const short = c.comment.length > 80
        ? c.comment.slice(0, 77) + '...'
        : c.comment;
      lines.push(`  [${c.lense}/${c.verdict}] ${c.by}: ${short}`);
    }
  } else {
    lines.push('');
    lines.push('no open concerns');
  }
  return lines.join('\n');
}
