import { ParsedArgs, optionalOption } from '../../shared/parseArgs.js';
import { C, loadAllRequestsAsJson, parseOptionalIntOption } from './internal.js';
import { collectStatus, StatusSummary } from './status.js';
import { collectUtterances } from '../voices.js';
import { Request } from '../../../domain/request/Request.js';

/**
 * Next-step hint embedded in boot. Mirrors the SuggestedNext shape
 * used by write responses (see writeFormat.ts) so orchestrators can
 * dispatch against the same consumer. Null when boot has no
 * prescription — e.g. the caller is already a registered member
 * with no outstanding state.
 *
 * Exported so `gate suggest` (the lighter-weight sibling) can reuse
 * the same contract without round-tripping through boot's full
 * payload.
 */
export interface BootSuggestedNext {
  verb: string;
  args: Record<string, string>;
  reason: string;
}

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
  /**
   * Diagnostic hints to help agents detect misconfiguration early.
   *
   * `misconfigured_cwd`: true iff NO `guild.config.yaml` was found up
   * the tree AND the fallback content_root has zero data. This is
   * the actionable signal: the caller almost certainly ran gate from
   * the wrong directory. Intentional fresh starts (new content_root
   * bootstrapped with an explicit config file) are NOT flagged.
   *
   * `config_file`: absolute path to the `guild.config.yaml` in use,
   * or `null` when cwd is being used as a fallback root.
   *
   * `resolved_content_root`: absolute path gate is reading data from.
   *
   * `content_root_health`: lightweight summary of whether any YAML
   * records in the content_root failed to hydrate. Surfacing this at
   * boot time catches test leftovers or schema-drifted records that
   * would otherwise emit a warning on every subsequent verb. When
   * `malformed_count > 0` the caller can reach for
   * `gate doctor` (inspect) and `gate doctor --format json | gate repair --apply`
   * (quarantine) — the onboarding unlock is named in `fix_hint`.
   */
  hints: {
    misconfigured_cwd: boolean;
    config_file: string | null;
    resolved_content_root: string;
    content_root_health: {
      malformed_count: number;
      areas: Array<{ area: string; malformed: number; total: number }>;
      fix_hint: string | null;
    };
  };
  /**
   * First-step prescription for the caller. Populated when boot can
   * infer an obvious "do this next" — typically pre-onboarding (no
   * GUILD_ACTOR, or GUILD_ACTOR set to an unregistered name) where
   * new agents need a signpost toward `gate register`. Null once the
   * caller has an identity and no outstanding bootstrap work.
   *
   * Note: this is orientation-time guidance, distinct from the
   * write-response `suggested_next` that follows a transition. Kept
   * as a sibling field on the boot payload rather than merged with
   * `hints` because it's directive (a verb to call), not diagnostic
   * (a condition to notice).
   */
  suggested_next: BootSuggestedNext | null;
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
  // Load members unconditionally: we need the count for fresh-root
  // detection below, and the cost (YAML directory scan) is bounded.
  const members = await c.memberUC.list();
  let role: BootPayload['role'] = null;
  if (actor) {
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

  // Misconfigured-cwd detection: warn ONLY when no config file was
  // found AND the fallback content_root is empty. This distinguishes
  // "cwd is wrong" (no config + no data → cryptic "no such member"
  // errors incoming) from "intentional fresh start" (explicit config
  // present + no data yet → do not scare the user).
  const misconfiguredCwd =
    c.config.configFile === null &&
    members.length === 0 &&
    allRequests.length === 0;

  // Content-root health: lightweight summary of malformed records.
  // We piggyback on DiagnosticUseCases which already walks every
  // area; its onMalformed collector picks up YAML that failed to
  // hydrate (schema drift, test leftovers, half-written records).
  // Errors during the health probe are non-fatal — a failing
  // diagnostic shouldn't break boot, which agents depend on for
  // orientation.
  const contentRootHealth: BootPayload['hints']['content_root_health'] = {
    malformed_count: 0,
    areas: [],
    fix_hint: null,
  };
  try {
    const report = await c.diagnosticUC.run();
    const summary = report.summary as unknown as Record<
      string,
      { total: number; malformed: number }
    >;
    for (const [area, s] of Object.entries(summary)) {
      if (s && typeof s.total === 'number') {
        contentRootHealth.areas.push({
          area,
          total: s.total,
          malformed: s.malformed,
        });
        contentRootHealth.malformed_count += s.malformed;
      }
    }
    if (contentRootHealth.malformed_count > 0) {
      contentRootHealth.fix_hint =
        'Run `gate doctor` to see each finding, then ' +
        '`gate doctor --format json | gate repair --apply` to ' +
        'quarantine malformed records out of the hot path. ' +
        'Quarantine is reversible: files move under ' +
        '`<content_root>/quarantine/<timestamp>/<area>/`.';
    }
  } catch {
    // Diagnostic errored — skip health, keep boot usable.
  }

  const suggestedNext = deriveBootSuggestedNext(
    actor,
    role,
    members,
    allRequests,
  );

  const payload: BootPayload = {
    actor,
    role,
    status,
    tail,
    your_recent: yourRecent,
    inbox_unread: inboxUnread,
    last_activity: status.last_activity,
    hints: {
      misconfigured_cwd: misconfiguredCwd,
      config_file: c.config.configFile,
      resolved_content_root: c.config.contentRoot,
      content_root_health: contentRootHealth,
    },
    suggested_next: suggestedNext,
  };

  if (format === 'json') {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    process.stdout.write(renderBootText(payload));
  }
  return 0;
}

/**
 * Derive the orientation-time "do this next" hint. Fires only in the
 * pre-onboarding shapes where a newcomer would otherwise stare at an
 * empty payload with no signpost:
 *
 *   - actor=null + no members exist → suggest `register` (fresh root)
 *   - actor=null + members exist    → suggest exporting GUILD_ACTOR
 *                                     (returning user just forgot)
 *   - role='unknown'                → suggest `register` with the
 *                                     name they already set
 *
 * Returns null for registered members and hosts — they have no
 * unambiguous next action from boot alone.
 */
export function deriveBootSuggestedNext(
  actor: string | null,
  role: BootPayload['role'],
  members: ReadonlyArray<{ name: { value: string } }>,
  allRequests: ReadonlyArray<Request>,
): BootSuggestedNext | null {
  if (actor === null) {
    if (members.length === 0) {
      return {
        verb: 'register',
        args: { name: '<your-name>' },
        reason:
          'No GUILD_ACTOR and no members on this content_root — register yourself to join.',
      };
    }
    // Members exist; this is most likely a returning session that
    // just hasn't exported GUILD_ACTOR yet. Name a few concrete
    // options so the hint is actionable.
    const sample = members.slice(0, 3).map((m) => m.name.value);
    return {
      verb: 'export',
      args: { GUILD_ACTOR: '<your-name>' },
      reason:
        `No GUILD_ACTOR set. Existing members: ${sample.join(', ')}` +
        (members.length > 3 ? ` (+${members.length - 3} more)` : '') +
        `. Export GUILD_ACTOR=<your-name>, or run gate register --name <your-name> if new.`,
    };
  }
  if (role === 'unknown') {
    return {
      verb: 'register',
      args: { name: actor },
      reason:
        `GUILD_ACTOR=${actor} but "${actor}" is not a registered member or host. ` +
        `Run gate register --name ${actor} to create the member file.`,
    };
  }
  // Known actor: pick the most actionable open loop. Priority reflects
  // "which one would surprise the agent most if missed":
  //   1. Executing-by-me  → mid-flight work; resume/close it first
  //   2. Unreviewed mine  → others are blocked on our verdict
  //   3. Approved for me  → warm queue, ready to start
  // Stops at the first match so the agent gets ONE verb to call next.
  // The other loops remain visible via status counts.
  const actorLower = actor.toLowerCase();

  const executingMine = allRequests.find(
    (r) =>
      r.state === 'executing' &&
      (r.executor?.value === actorLower || r.from.value === actorLower),
  );
  if (executingMine) {
    return {
      verb: 'complete',
      args: { id: executingMine.id.value, by: actor },
      reason:
        `you are executing ${executingMine.id.value} — ` +
        `complete it (or 'gate fail <id> --reason <s>' if it can't land).`,
    };
  }

  const unreviewedMine = allRequests.find(
    (r) =>
      r.state === 'completed' &&
      r.autoReview?.value === actorLower &&
      r.reviews.length === 0,
  );
  if (unreviewedMine) {
    return {
      verb: 'review',
      args: {
        id: unreviewedMine.id.value,
        by: actor,
        lense: 'devil',
      },
      reason:
        `${unreviewedMine.id.value} completed with auto-review assigned to ` +
        `you; pick --verdict <ok|concern|reject> and --comment after reading ` +
        `the work.`,
    };
  }

  const approvedForMe = allRequests.find(
    (r) => r.state === 'approved' && r.executor?.value === actorLower,
  );
  if (approvedForMe) {
    return {
      verb: 'execute',
      args: { id: approvedForMe.id.value, by: actor },
      reason:
        `${approvedForMe.id.value} is approved and names you as executor — ` +
        `start the work (gate execute), then complete/fail when done.`,
    };
  }

  // Pending-as-executor: someone queued work for me but it still needs
  // approval. Any registered actor can approve (author-approval gets
  // the self-approval notice; third-party approval is the clean case).
  // Suggest it so the agent sees the bottleneck instead of sitting.
  const pendingAsExecutor = allRequests.find(
    (r) =>
      r.state === 'pending' &&
      r.executor?.value === actorLower &&
      r.from.value !== actorLower,
  );
  if (pendingAsExecutor) {
    return {
      verb: 'approve',
      args: { id: pendingAsExecutor.id.value, by: actor },
      reason:
        `${pendingAsExecutor.id.value} is pending and names you as executor ` +
        `(authored by ${pendingAsExecutor.from.value}); approve it to unblock, ` +
        `or deny with --reason if it shouldn't proceed.`,
    };
  }

  return null;
}

function renderBootText(p: BootPayload): string {
  const lines: string[] = [];
  if (p.actor) {
    lines.push(`── you are ${p.actor} (${p.role}) ──`);
  } else {
    lines.push('── boot (no GUILD_ACTOR; global view) ──');
  }
  if (p.hints.misconfigured_cwd) {
    lines.push('');
    lines.push(
      `⚠️  no guild.config.yaml found, falling back to cwd`,
    );
    lines.push(`   resolved: ${p.hints.resolved_content_root}`);
    lines.push(
      `   (0 members, 0 requests — likely wrong cwd, not a fresh start)`,
    );
    lines.push(
      `   fix: cd into the directory that contains guild.config.yaml,`,
    );
    lines.push(
      `        or use a wrapper that cd's before invoking gate.mjs.`,
    );
  }
  const health = p.hints.content_root_health;
  if (health.malformed_count > 0) {
    lines.push('');
    lines.push(
      `⚠️  ${health.malformed_count} malformed record(s) in content_root`,
    );
    for (const a of health.areas) {
      if (a.malformed > 0) {
        lines.push(
          `   ${a.area}: ${a.malformed} malformed of ${a.total}`,
        );
      }
    }
    lines.push(`   fix: gate doctor   # inspect each finding`);
    lines.push(
      `        gate doctor --format json | gate repair --apply   # quarantine`,
    );
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
  if (p.suggested_next) {
    lines.push('');
    // Render the hint as a concrete shell command so the reader can
    // copy-paste. `export` is special-cased because it's a shell
    // builtin, not a gate subcommand.
    const n = p.suggested_next;
    if (n.verb === 'export') {
      const [k, v] = Object.entries(n.args)[0] ?? ['GUILD_ACTOR', '<your-name>'];
      lines.push(`→ next: export ${k}=${v}`);
    } else {
      const argsStr = Object.entries(n.args)
        .map(([k, v]) => `--${k} ${v}`)
        .join(' ');
      lines.push(`→ next: gate ${n.verb}${argsStr ? ' ' + argsStr : ''}`);
    }
    lines.push(`  (${n.reason})`);
  }
  return lines.join('\n') + '\n';
}
