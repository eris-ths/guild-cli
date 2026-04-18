import { ParsedArgs, optionalOption } from '../../shared/parseArgs.js';
import { C } from './internal.js';
import { Request } from '../../../domain/request/Request.js';
import {
  computeReviewMarkerWidth,
  formatReviewMarkers,
} from './request.js';

/**
 * gate board [--for <m>] [--format json|text]
 *
 * "What's in flight right now?" — the non-terminal subset of the
 * request corpus, grouped by state. Answers the question that
 * `gate status` gives counts for and `gate list` gives contents for
 * one-state-at-a-time: a single view of the three active states
 * stacked in the natural lifecycle order (pending → approved →
 * executing).
 *
 * Scope deliberately excludes terminal states (completed / failed /
 * denied) and issues. "In flight" means "someone could still act on
 * this"; closed records belong to `gate tail` / `gate voices` /
 * `gate show`, and issues belong to `gate issues list`.
 *
 * Filters mirror `gate list`: `--for <m>` scopes to requests where
 * the given actor appears as `from` / `executor` / `auto-review`.
 * When GUILD_ACTOR is set and `--for` is omitted, the filter is
 * applied implicitly (same behaviour as `gate list`), with a stderr
 * notice so the implicit narrowing is visible.
 *
 * Empty sections still render their header with "(0)" / "(none)" so
 * the board shape stays stable across calls — a reader scanning for
 * "executing" should always find the line even when nothing is mid-
 * execution.
 */
const BOARD_STATES = ['pending', 'approved', 'executing'] as const;

export async function boardCmd(c: C, args: ParsedArgs): Promise<number> {
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    throw new Error(`--format must be 'json' or 'text', got: ${format}`);
  }

  const explicitFor = optionalOption(args, 'for');
  const envActor =
    explicitFor === undefined && process.env['GUILD_ACTOR']
      ? process.env['GUILD_ACTOR']
      : undefined;
  const forFilter = explicitFor ?? envActor;

  // Fetch per-state (not listAll) so each section's count matches
  // the directory on disk exactly. No dedupe needed: a request is
  // only in one state at a time.
  const sections: Array<{ state: string; items: Request[] }> = [];
  for (const state of BOARD_STATES) {
    let items = await c.requestUC.listByState(state);
    if (forFilter !== undefined) {
      items = items.filter(
        (r) =>
          r.from.value === forFilter ||
          r.executor?.value === forFilter ||
          r.autoReview?.value === forFilter,
      );
    }
    sections.push({ state, items });
  }

  if (envActor !== undefined) {
    process.stderr.write(
      `# filtered by GUILD_ACTOR=${envActor} (use --for <m> or unset GUILD_ACTOR to override)\n`,
    );
  }

  if (format === 'json') {
    // Plain object keyed by state name in lifecycle order. Stable
    // key set (pending/approved/executing) across calls; consumers
    // can rely on all three being present even when empty.
    const payload: Record<string, unknown> = {};
    for (const { state, items } of sections) {
      payload[state] = items.map((r) => r.toJSON());
    }
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return 0;
  }

  // Text format: shared review-marker width across all sections so
  // the action column aligns down the whole board (not just per
  // section). Same treatment `gate list` gives a single state list.
  const allItems = sections.flatMap((s) => s.items);
  const markerWidth = computeReviewMarkerWidth(allItems);

  for (let s = 0; s < sections.length; s++) {
    const { state, items } = sections[s]!;
    if (s > 0) process.stdout.write('\n');
    process.stdout.write(`${state} (${items.length}):\n`);
    if (items.length === 0) {
      process.stdout.write('  (none)\n');
      continue;
    }
    for (const r of items) {
      const j = r.toJSON();
      const markers = formatReviewMarkers(j['reviews'], markerWidth);
      // `exec=X` is informationally dense for approved/executing
      // sections (executor is the next-action holder). For pending
      // rows it's usually the same as `from`, so still useful to
      // show but not redundant enough to suppress.
      const executor = j['executor'] ? `  exec=${j['executor']}` : '';
      process.stdout.write(
        `  ${j['id']}  from=${j['from']}${executor}  ${markers}${String(j['action']).slice(0, 60)}\n`,
      );
    }
  }
  return 0;
}
