import { ParsedArgs, optionalOption } from '../../shared/parseArgs.js';
import { Request } from '../../../domain/request/Request.js';
import { C } from './internal.js';

/**
 * gate status [--for <name>] [--format json|text]
 *
 * Agent orientation command: "where am I, what's waiting?"
 * Designed to be the first thing an agent calls at the start
 * of an autonomous loop.
 */

interface StatusSummary {
  actor: string | null;
  pending: { total: number; as_executor: number; as_author: number };
  approved: { total: number; awaiting_execution: number };
  executing: { total: number; by_actor: number };
  open_issues: number;
  unreviewed: number;
  inbox_unread: number;
  last_activity: string | null;
}

function collectStatus(
  all: Request[],
  actor: string | null,
): StatusSummary {
  const byState = (s: string) => all.filter((r) => {
    const j = r.toJSON() as Record<string, unknown>;
    return j['state'] === s;
  });

  const pending = byState('pending');
  const approved = byState('approved');
  const executing = byState('executing');
  const completed = byState('completed');

  const actorLower = actor?.toLowerCase() ?? null;

  const getFrom = (r: Request) =>
    String((r.toJSON() as Record<string, unknown>)['from'] ?? '');
  const getExecutor = (r: Request) =>
    String((r.toJSON() as Record<string, unknown>)['executor'] ?? '');
  const getAutoReview = (r: Request) =>
    (r.toJSON() as Record<string, unknown>)['auto_review'] as string | undefined;

  // Unreviewed: completed requests with auto_review set but no reviews yet
  const unreviewed = completed.filter((r) => {
    const j = r.toJSON() as Record<string, unknown>;
    const reviews = j['reviews'] as unknown[] | undefined;
    return getAutoReview(r) && (!reviews || reviews.length === 0);
  }).length;

  // Last activity: most recent timestamp across all requests
  let lastActivity: string | null = null;
  for (const r of all) {
    const j = r.toJSON() as Record<string, unknown>;
    const timestamps: string[] = [];
    if (typeof j['created_at'] === 'string') timestamps.push(j['created_at']);
    const statusLog = j['status_log'] as Array<{ at?: string }> | undefined;
    if (statusLog) {
      for (const entry of statusLog) {
        if (entry.at) timestamps.push(entry.at);
      }
    }
    const reviews = j['reviews'] as Array<{ at?: string }> | undefined;
    if (reviews) {
      for (const rev of reviews) {
        if (rev.at) timestamps.push(rev.at);
      }
    }
    for (const ts of timestamps) {
      if (!lastActivity || ts > lastActivity) lastActivity = ts;
    }
  }

  return {
    actor: actorLower,
    pending: {
      total: pending.length,
      as_executor: actorLower
        ? pending.filter((r) => getExecutor(r) === actorLower).length
        : 0,
      as_author: actorLower
        ? pending.filter((r) => getFrom(r) === actorLower).length
        : 0,
    },
    approved: {
      total: approved.length,
      awaiting_execution: actorLower
        ? approved.filter((r) => getExecutor(r) === actorLower).length
        : approved.length,
    },
    executing: {
      total: executing.length,
      by_actor: actorLower
        ? executing.filter(
            (r) =>
              getExecutor(r) === actorLower ||
              getFrom(r) === actorLower,
          ).length
        : 0,
    },
    open_issues: 0, // filled by caller if issues are available
    unreviewed,
    inbox_unread: 0, // filled by caller if inbox is available
    last_activity: lastActivity,
  };
}

function renderStatusText(s: StatusSummary): string {
  const lines: string[] = [];
  const who = s.actor ? `status for ${s.actor}` : 'status (global)';
  lines.push(who);
  lines.push('─'.repeat(Math.max(who.length, 30)));

  // Pending
  if (s.pending.total > 0) {
    let detail = `pending: ${s.pending.total}`;
    const parts: string[] = [];
    if (s.pending.as_executor > 0) parts.push(`${s.pending.as_executor} as executor`);
    if (s.pending.as_author > 0) parts.push(`${s.pending.as_author} authored`);
    if (parts.length > 0) detail += ` (${parts.join(', ')})`;
    lines.push(detail);
  } else {
    lines.push('pending: 0');
  }

  // Approved (awaiting execution)
  if (s.approved.total > 0) {
    const detail = s.actor
      ? `approved: ${s.approved.total} (${s.approved.awaiting_execution} awaiting your execution)`
      : `approved: ${s.approved.total}`;
    lines.push(detail);
  }

  // Executing
  if (s.executing.total > 0) {
    const detail = s.actor
      ? `executing: ${s.executing.total} (${s.executing.by_actor} yours)`
      : `executing: ${s.executing.total}`;
    lines.push(detail);
  }

  // Issues & inbox
  if (s.open_issues > 0) lines.push(`open issues: ${s.open_issues}`);
  if (s.unreviewed > 0) lines.push(`unreviewed: ${s.unreviewed}`);
  if (s.inbox_unread > 0) lines.push(`inbox unread: ${s.inbox_unread}`);

  // Last activity
  if (s.last_activity) {
    lines.push(`last activity: ${s.last_activity}`);
  } else {
    lines.push('last activity: (none)');
  }

  return lines.join('\n') + '\n';
}

export async function statusCmd(c: C, args: ParsedArgs): Promise<number> {
  const actor = optionalOption(args, 'for') ?? process.env['GUILD_ACTOR'] ?? null;
  const format = optionalOption(args, 'format') ?? 'json';

  const all = await c.requestUC.listAll();
  const summary = collectStatus(all, actor);

  // Enrich with issues count
  try {
    const issues = await c.issueUC.listAll();
    summary.open_issues = issues.filter(
      (i) => {
        const state = (i.toJSON() as Record<string, unknown>)['state'];
        return state === 'open' || state === 'in_progress';
      },
    ).length;
  } catch {
    // issues may not be configured — non-fatal
  }

  // Enrich with inbox count
  if (actor) {
    try {
      const msgs = await c.messageUC.inbox(actor);
      summary.inbox_unread = msgs.filter((m) => !m.read).length;
    } catch {
      // inbox may not exist for this actor — non-fatal
    }
  }

  if (format === 'json') {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } else {
    process.stdout.write(renderStatusText(summary));
  }
  return 0;
}
