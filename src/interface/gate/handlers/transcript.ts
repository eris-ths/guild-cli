import { ParsedArgs, optionalOption } from '../../shared/parseArgs.js';
import { C } from './internal.js';
import { Request } from '../../../domain/request/Request.js';

/**
 * gate transcript <id> [--format text|json]
 *
 * Narrative rendering of a single request's life — the arc from
 * filing through every transition and review in plain prose. Sibling
 * of `gate show` (structured) and `gate voices <name>` (per-actor
 * stream); `transcript` is per-request and prose-first.
 *
 * Why this exists (explore-branch experiment):
 *   Current tooling gives agents structured access (show --format
 *   json) or lifecycle bullets (show --format text, status_log), but
 *   the narrative — "what happened with this request, as a story" —
 *   is a synthesis step the agent has to run itself on top of the
 *   raw data. For agents that then summarise work back to humans,
 *   that's duplicated effort; for agents reading others' history,
 *   it's a reconstruction cost on every lookup.
 *
 *   If this verb feels valuable in practice, the cost of keeping it
 *   is tiny (read-only, composed from existing data). If it feels
 *   like synthetic prose that agents would render better themselves,
 *   drop it — the data path isn't disturbed.
 *
 * Output:
 *   text (default) — narrative paragraphs.
 *   json           — { id, arc, summary } where `arc` is the same
 *                    prose as text and `summary` carries the
 *                    structured shape (actors, review_verdicts,
 *                    duration_ms) for a programmatic consumer.
 */

interface TranscriptSummary {
  actors: readonly string[];
  actor_count: number;
  review_count: number;
  review_verdicts: readonly string[];
  final_state: string;
  duration_ms: number | null;
}

interface TranscriptPayload {
  id: string;
  arc: string;
  summary: TranscriptSummary;
}

export async function transcriptCmd(c: C, args: ParsedArgs): Promise<number> {
  const id = args.positional[0];
  if (!id) throw new Error('Usage: gate transcript <id> [--format text|json]');
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'text' && format !== 'json') {
    throw new Error(`--format must be 'text' or 'json', got: ${format}`);
  }
  const r = await c.requestUC.show(id);
  if (!r) {
    process.stderr.write(`not found: ${id}\n`);
    return 1;
  }
  const payload = buildTranscript(r);
  if (format === 'json') {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    process.stdout.write(payload.arc + '\n');
  }
  return 0;
}

function buildTranscript(r: Request): TranscriptPayload {
  const j = r.toJSON();
  const id = String(j['id']);
  const from = String(j['from']);
  const action = String(j['action']);
  const reason = String(j['reason']);
  const executor = j['executor'] ? String(j['executor']) : undefined;
  const autoReview = j['auto_review'] ? String(j['auto_review']) : undefined;
  const log = Array.isArray(j['status_log'])
    ? (j['status_log'] as Array<Record<string, unknown>>)
    : [];
  const reviews = Array.isArray(j['reviews'])
    ? (j['reviews'] as Array<Record<string, unknown>>)
    : [];
  const finalState = String(j['state']);

  // Narrative construction. Each paragraph is one phase of the arc:
  //   1. Framing — who, what, why, named roles.
  //   2. Lifecycle — each transition in prose, with notes as quotes.
  //   3. Reviews — verdicts with the reviewer's voice.
  //   4. Summary — actors touched, duration, terminal state.
  const paragraphs: string[] = [];

  // 1. Framing
  const frameParts: string[] = [];
  frameParts.push(
    `${capitalise(from)} filed ${id} — "${action}" — seeking ${lowercase(reason)}`,
  );
  if (executor) frameParts.push(`naming ${executor} as executor`);
  if (autoReview) frameParts.push(`with auto-review assigned to ${autoReview}`);
  paragraphs.push(frameParts.join(', ') + '.');

  // 2. Lifecycle prose
  const lifecycle: string[] = [];
  let prevAt: string | undefined;
  for (const entry of log) {
    const state = String(entry['state'] ?? '');
    const by = String(entry['by'] ?? '');
    const at = String(entry['at'] ?? '');
    const note = entry['note'] ? ` (note: "${entry['note']}")` : '';
    const invokedBy = entry['invoked_by']
      ? ` [invoked by ${entry['invoked_by']}]`
      : '';
    if (state === 'pending') {
      // Skip the initial pending entry — it's already implied by "filed".
      prevAt = at;
      continue;
    }
    const delta = prevAt ? ` (${humanDelta(prevAt, at)} later)` : '';
    lifecycle.push(
      `${capitalise(by)} moved it to ${state}${delta}${invokedBy}${note}`,
    );
    prevAt = at;
  }
  if (lifecycle.length > 0) {
    paragraphs.push(lifecycle.join('. ') + '.');
  }

  // 3. Reviews — weave verdict + comment into prose per review.
  if (reviews.length > 0) {
    const reviewLines: string[] = [];
    for (const rv of reviews) {
      const by = String(rv['by'] ?? '');
      const lense = String(rv['lense'] ?? '');
      const verdict = String(rv['verdict'] ?? '');
      const comment = String(rv['comment'] ?? '').trim();
      const invokedBy = rv['invoked_by'] ? ` (via ${rv['invoked_by']})` : '';
      // Short comments are quoted inline; longer ones get their own
      // line so the flow stays readable.
      const commentFrag =
        comment.length === 0
          ? ''
          : comment.length <= 80
            ? ` — "${comment}"`
            : `\n    "${comment}"`;
      reviewLines.push(
        `${capitalise(by)}${invokedBy} reviewed through the ${lense} lens ` +
          `with a verdict of ${verdict}${commentFrag}`,
      );
    }
    paragraphs.push(reviewLines.join('. ') + '.');
  } else if (autoReview && finalState === 'completed') {
    // Auto-review was assigned but not yet done — worth naming so
    // the reader knows the arc isn't fully closed.
    paragraphs.push(
      `Auto-review is pending: ${autoReview} has not yet recorded a verdict.`,
    );
  }

  // 4. Summary — facts the caller might want at a glance.
  const summary = computeSummary(log, reviews, finalState);
  const actorFrag = summary.actor_count === 1
    ? `the entire arc was carried out by ${summary.actors[0]} alone`
    : `the arc involved ${summary.actor_count} actor${summary.actor_count === 1 ? '' : 's'} ` +
      `(${summary.actors.join(', ')})`;
  const durationFrag = summary.duration_ms !== null
    ? `, total duration ${humanDuration(summary.duration_ms)}`
    : '';
  paragraphs.push(
    `Final state: ${finalState}. ${capitalise(actorFrag)}${durationFrag}.`,
  );

  return { id, arc: paragraphs.join('\n\n'), summary };
}

function computeSummary(
  log: Array<Record<string, unknown>>,
  reviews: Array<Record<string, unknown>>,
  finalState: string,
): TranscriptSummary {
  const actors = new Set<string>();
  for (const e of log) {
    if (typeof e['by'] === 'string') actors.add(e['by']);
  }
  for (const rv of reviews) {
    if (typeof rv['by'] === 'string') actors.add(rv['by']);
  }
  const verdicts: string[] = [];
  for (const rv of reviews) {
    if (typeof rv['verdict'] === 'string') verdicts.push(rv['verdict']);
  }
  let durationMs: number | null = null;
  const firstAt = log[0]?.['at'];
  const lastAt = log[log.length - 1]?.['at'];
  if (typeof firstAt === 'string' && typeof lastAt === 'string') {
    const d = new Date(lastAt).getTime() - new Date(firstAt).getTime();
    if (!Number.isNaN(d)) durationMs = d;
  }
  return {
    actors: [...actors],
    actor_count: actors.size,
    review_count: reviews.length,
    review_verdicts: verdicts,
    final_state: finalState,
    duration_ms: durationMs,
  };
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function lowercase(s: string): string {
  return s.length === 0 ? s : s[0]!.toLowerCase() + s.slice(1);
}

function humanDelta(from: string, to: string): string {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (Number.isNaN(ms)) return '';
  return humanDuration(ms);
}

function humanDuration(ms: number): string {
  if (ms < 0) return 'earlier';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}
