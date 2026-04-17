import { ParsedArgs, optionalOption } from '../../shared/parseArgs.js';
import { C, loadAllRequestsAsJson, parseOptionalIntOption } from './internal.js';
import { collectStatus, StatusSummary } from './status.js';
import { collectUtterances } from '../voices.js';

/**
 * gate boot [--format json|text] [--tail <N>] [--utterances <N>]
 *
 * Single-command session orientation for agents. Composes the
 * information previously returned by `gate whoami` + `gate status` +
 * `gate tail` + `gate inbox --unread` into one JSON so an autonomous
 * agent can acquire full context with a single tool call on startup.
 *
 * Design note — one verb, not a bundle of three:
 *   The existing three-verb recipe (docs/verbs.md § Session-start
 *   recipe) is agent-friendly but agent-first needs a single structured
 *   payload. That's what boot returns: identity, queues, recent
 *   activity, unread messages — so the agent never has to decide
 *   "what do I fetch next" during orientation.
 *
 * GUILD_ACTOR is optional here (unlike `whoami`, which requires it):
 *   - with it set → personal dashboard (role, your recent utterances,
 *     your inbox, queues scoped to you).
 *   - without it → global snapshot (role=null, identity=null, no
 *     personal slices). Still valuable as a content-root health read.
 *
 * The JSON shape is stable across 0.x patch releases — agents can
 * depend on it. New fields may be ADDED but existing ones won't be
 * renamed or removed without a minor-version bump.
 */

interface BootPayload {
  actor: string | null;
  role: 'member' | 'host' | 'unknown' | null;
  status: StatusSummary;
  tail: ReturnType<typeof collectUtterances>;
  your_recent: ReturnType<typeof collectUtterances> | null;
  inbox_unread: Array<{ at: string; from: string; text: string; type: string }>;
  last_activity: string | null;
}

export async function bootCmd(c: C, args: ParsedArgs): Promise<number> {
  const format = optionalOption(args, 'format') ?? 'json';
  if (format !== 'json' && format !== 'text') {
    throw new Error(`--format must be 'json' or 'text', got: ${format}`);
  }
  const tailLimit = parseOptionalIntOption(args, 'tail') ?? 10;
  const personalLimit = parseOptionalIntOption(args, 'utterances') ?? 5;

  const envActor = process.env['GUILD_ACTOR'];
  const actor = envActor && envActor.length > 0 ? envActor : null;

  // Resolve role without rejecting when GUILD_ACTOR is unset — boot
  // must always succeed, even without identity, so unknown-identity
  // sessions can still use it for orientation.
  let role: BootPayload['role'] = null;
  if (actor) {
    const members = await c.memberUC.list();
    const actorLower = actor.toLowerCase();
    const isMember = members.some((m) => m.name.value === actorLower);
    const isHost = c.config.hostNames.includes(actorLower);
    role = isMember ? 'member' : isHost ? 'host' : 'unknown';
  }

  // Reuse the same aggregate load for every derived view; listAll is
  // the expensive call (reads every state dir) so we pay it once.
  const allRequests = await c.requestUC.listAll();
  const status = collectStatus(allRequests, actor);

  // Enrich status with issues + inbox (mirrors statusCmd) so the
  // single payload is self-contained.
  try {
    const issues = await c.issueUC.listAll();
    status.open_issues = issues.filter(
      (i) => i.state === 'open' || i.state === 'in_progress',
    ).length;
  } catch {
    // issues dir may not exist — non-fatal
  }

  const inboxUnread: BootPayload['inbox_unread'] = [];
  if (actor) {
    try {
      const msgs = await c.messageUC.inbox(actor);
      const unread = msgs.filter((m) => !m.read);
      status.inbox_unread = unread.length;
      for (const m of unread) {
        inboxUnread.push({ at: m.at, from: m.from, text: m.text, type: m.type });
      }
    } catch {
      // inbox may not exist for this actor — non-fatal
    }
  }

  // tail + personal utterances share one JSON projection of the
  // request corpus so collectUtterances isn't double-invoked on the
  // same data — it's O(N*status_log) and N grows with history.
  const allJson = allRequests.map((r) => r.toJSON() as unknown as Parameters<typeof collectUtterances>[0][number]);
  const tail = collectUtterances(allJson, { limit: tailLimit, order: 'desc' });
  const yourRecent = actor
    ? collectUtterances(allJson, { name: actor, limit: personalLimit, order: 'desc' })
    : null;

  const payload: BootPayload = {
    actor,
    role,
    status,
    tail,
    your_recent: yourRecent,
    inbox_unread: inboxUnread,
    last_activity: status.last_activity,
  };

  if (format === 'json') {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    process.stdout.write(renderBootText(payload));
  }
  return 0;
}

function renderBootText(p: BootPayload): string {
  const lines: string[] = [];
  if (p.actor) {
    lines.push(`── you are ${p.actor} (${p.role}) ──`);
  } else {
    lines.push('── boot (no GUILD_ACTOR; global view) ──');
  }
  lines.push('');
  lines.push(
    `queues: pending=${p.status.pending.total} approved=${p.status.approved.total} executing=${p.status.executing.total} open_issues=${p.status.open_issues} unreviewed=${p.status.unreviewed}`,
  );
  if (p.inbox_unread.length > 0) {
    lines.push(`inbox unread: ${p.inbox_unread.length}`);
    for (const m of p.inbox_unread.slice(0, 3)) {
      lines.push(`  [${m.at}] ${m.type} from ${m.from}: ${m.text.slice(0, 60)}`);
    }
  }
  if (p.last_activity) lines.push(`last activity: ${p.last_activity}`);

  if (p.tail.length > 0) {
    lines.push('');
    lines.push(`recent (${p.tail.length}):`);
    for (const u of p.tail.slice(0, 5)) {
      if (u.kind === 'review') {
        lines.push(`  ${u.at}  req=${u.requestId}  [${u.lense}/${u.verdict}] by ${u.by}`);
      } else {
        lines.push(`  ${u.at}  req=${u.requestId}  authored by ${u.from}`);
      }
    }
  }
  if (p.your_recent && p.your_recent.length > 0) {
    lines.push('');
    lines.push(`your recent (${p.your_recent.length}):`);
    for (const u of p.your_recent.slice(0, 3)) {
      if (u.kind === 'review') {
        lines.push(`  ${u.at}  req=${u.requestId}  [${u.lense}/${u.verdict}]`);
      } else {
        lines.push(`  ${u.at}  req=${u.requestId}  authored`);
      }
    }
  }
  return lines.join('\n') + '\n';
}
