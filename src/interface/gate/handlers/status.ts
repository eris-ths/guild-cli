import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { Request } from '../../../domain/request/Request.js';
import { C, warnIfMisconfiguredCwd } from './internal.js';

const STATUS_KNOWN_FLAGS: ReadonlySet<string> = new Set(['for', 'format']);

/**
 * gate status [--for <name>] [--format json|text]
 *
 * Agent orientation command: "where am I, what's waiting?"
 * Designed to be the first thing an agent calls at the start
 * of an autonomous loop.
 */

export interface StatusSummary {
  actor: string | null;
  pending: { total: number; as_executor: number; as_author: number };
  approved: { total: number; awaiting_execution: number };
  executing: { total: number; by_actor: number };
  open_issues: number;
  unreviewed: number;
  /**
   * Concern/reject verdicts on this actor's authored (or pair-made)
   * requests with no follow-up record yet. Same detector as
   * `gate unresponded`; populated by the caller when an actor is
   * resolved (the underlying query is per-actor by definition).
   * 0 when no actor is set, or when no concerns match.
   */
  unresponded: number;
  inbox_unread: number;
  last_activity: string | null;
}

export function collectStatus(
  all: Request[],
  actor: string | null,
): StatusSummary {
  const byState = (s: string) => all.filter((r) => r.state === s);

  const pending = byState('pending');
  const approved = byState('approved');
  const executing = byState('executing');
  const completed = byState('completed');

  const actorLower = actor?.toLowerCase() ?? null;

  // Unreviewed: completed requests with auto_review set but no reviews yet
  const unreviewed = completed.filter(
    (r) => r.autoReview && r.reviews.length === 0,
  ).length;

  // Last activity: most recent timestamp across all requests
  let lastActivity: string | null = null;
  for (const r of all) {
    for (const entry of r.statusLog) {
      if (entry.at > (lastActivity ?? '')) lastActivity = entry.at;
    }
    for (const rev of r.reviews) {
      if (rev.at > (lastActivity ?? '')) lastActivity = rev.at;
    }
  }

  return {
    actor: actorLower,
    pending: {
      total: pending.length,
      as_executor: actorLower
        ? pending.filter((r) => r.executor?.value === actorLower).length
        : 0,
      as_author: actorLower
        ? pending.filter((r) => r.from.value === actorLower).length
        : 0,
    },
    approved: {
      total: approved.length,
      awaiting_execution: actorLower
        ? approved.filter((r) => r.executor?.value === actorLower).length
        : approved.length,
    },
    executing: {
      total: executing.length,
      by_actor: actorLower
        ? executing.filter(
            (r) =>
              r.executor?.value === actorLower ||
              r.from.value === actorLower,
          ).length
        : 0,
    },
    open_issues: 0, // filled by caller if issues are available
    unreviewed,
    unresponded: 0, // filled by caller (per-actor query; needs UC access)
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
  if (s.unresponded > 0) {
    lines.push(`unresponded concerns: ${s.unresponded} (gate unresponded)`);
  }
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
  rejectUnknownFlags(args, STATUS_KNOWN_FLAGS, 'status');
  const actor = optionalOption(args, 'for') ?? process.env['GUILD_ACTOR'] ?? null;
  const format = optionalOption(args, 'format') ?? 'json';

  const all = await c.requestUC.listAll();
  const summary = collectStatus(all, actor);

  // Enrich with issues count
  try {
    const issues = await c.issueUC.listAll();
    summary.open_issues = issues.filter(
      (i) => {
        const state = i.state;
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

  // Enrich with unresponded-concerns count. Runs through the same
  // query as `gate unresponded` so the two surfaces never disagree
  // on the count. Per-actor by definition, so skip when no actor
  // resolved. Default 30-day window matches the verb's default;
  // no flag to widen here — boot/status are orientation surfaces,
  // and the verb itself exposes `--max-age-days` for sweeps.
  if (actor) {
    try {
      const entries = await c.unrespondedConcernsQ.run({
        actor,
        now: new Date(),
      });
      summary.unresponded = entries.length;
    } catch {
      // requests/issues dirs may be missing on a half-set-up root —
      // non-fatal.
    }
  }

  // Surface misconfigured-cwd before the (likely all-zero) payload
  // so the user sees the cause before the symptom. Same condition as
  // `gate boot`: no config + no data = probably wrong cwd.
  warnIfMisconfiguredCwd(c, all.length === 0 && summary.open_issues === 0);

  if (format === 'json') {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } else {
    process.stdout.write(renderStatusText(summary));
  }
  return 0;
}
