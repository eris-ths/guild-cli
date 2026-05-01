import { resolve } from 'node:path';
import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { C, loadAllRequestsAsJson, parseOptionalIntOption } from './internal.js';

const BOOT_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'format',
  'tail',
  'utterances',
]);
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
  /**
   * True iff `args.by` is absent or matches the calling actor.
   * Mirrors `SuggestedNext.actor_resolved` from writeFormat.ts so
   * orchestrators see the same shape across boot / suggest / resume /
   * write-response surfaces. False when the suggestion names a
   * different actor (e.g. "approve by host" while the caller isn't
   * a host) — read `reason` and decide whether to escalate.
   */
  actor_resolved: boolean;
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
    /**
     * `cwd_outside_content_root`: true iff the caller's cwd is NOT
     * the same directory as `resolved_content_root`. Distinguishes
     * "you ran gate from a subdir of an active guild and your write
     * went into the parent's records" (true) from "you ran gate at
     * the guild root, everything is where you expect" (false). The
     * silent-parent-config-pickup gap a fresh-agent dogfood
     * surfaced after #107 was the case this flag detects.
     *
     * Always false when `misconfigured_cwd` is true (the misconfigured
     * block already discloses verbosely; we don't double-up).
     */
    cwd_outside_content_root: boolean;
    config_file: string | null;
    resolved_content_root: string;
    content_root_health: {
      malformed_count: number;
      areas: Array<{ area: string; malformed: number; total: number }>;
      fix_hint: string | null;
    };
  };
  /**
   * Discoverability hint: what verbs are applicable right now?
   *
   * `actionable` names the state-transition verbs whose preconditions
   * are met for the caller's current queues — verbs the caller can
   * dispatch as themselves (--by = current actor). Each entry carries
   * the target id + a human-readable reason. `suggested_next` picks
   * ONE of these to lead with; `actionable` names the rest so an
   * agent that wants to branch can see the siblings.
   *
   * `requires_other_actor` names verbs that exist on the actor's
   * record (request they authored or own) but cannot be dispatched
   * by them — they require a different actor's --by. Each entry
   * names `candidates` (a list of names — typically hosts) and the
   * `reason` the actor can't act alone. Surfaces blockers so the
   * caller can see WHY their request is stuck (waiting for host
   * approval, etc.) without having to read suggested_next's prose.
   * Empty when nothing is blocked on another actor.
   *
   * `always_readable` is the flat catalog of side-effect-free verbs
   * an identified (or even anonymous) actor can always call — the
   * "map of the readable world" for initial exploration.
   *
   * The three lists never overlap: each entry sits in exactly one.
   * Keeping them separate makes it obvious which calls the agent
   * can do (actionable), which need someone else (requires_other_actor),
   * and which never change state (always_readable).
   */
  verbs_available_now: {
    actionable: Array<{
      verb: string;
      id: string;
      reason: string;
    }>;
    requires_other_actor: Array<{
      verb: string;
      id: string;
      candidates: readonly string[];
      reason: string;
    }>;
    always_readable: readonly string[];
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
  rejectUnknownFlags(args, BOOT_KNOWN_FLAGS, 'boot');
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

  // Unresponded-concerns count: same detector as `gate unresponded`
  // so the two surfaces never disagree. Without it, the orientation
  // status block reads "everything 0" for an actor who has unaddressed
  // concerns on completed records — the gap that boot exists to close.
  if (actor) {
    try {
      const entries = await c.unrespondedConcernsQ.run({
        actor,
        now: new Date(),
      });
      status.unresponded = entries.length;
    } catch {
      // requests/issues dirs may be missing — non-fatal.
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

  // Subdir-pickup detection: cwd is NOT the same directory as the
  // resolved content_root. The case the post-#107 fresh-agent
  // dogfood surfaced — running gate from `/foo/sub/` when an
  // `/foo/guild.config.yaml` exists silently writes into `/foo/`.
  // Suppressed when misconfiguredCwd already fired so the bigger
  // warning isn't doubled. Kept false at exactly the alignment
  // case (`cwd === resolved_content_root`) to keep the 99% normal
  // run quiet — voice budget.
  const cwdOutsideContentRoot =
    !misconfiguredCwd &&
    resolve(process.cwd()) !== resolve(c.config.contentRoot);

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
  const verbsAvailableNow = deriveVerbsAvailableNow(
    actor,
    role,
    allRequests,
    c.config.hostNames,
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
      cwd_outside_content_root: cwdOutsideContentRoot,
      config_file: c.config.configFile,
      resolved_content_root: c.config.contentRoot,
      content_root_health: contentRootHealth,
    },
    suggested_next: suggestedNext,
    verbs_available_now: verbsAvailableNow,
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
      return stampActorResolved({
        verb: 'register',
        args: { name: '<your-name>' },
        reason:
          'No GUILD_ACTOR and no members on this content_root — register yourself to join.',
      }, actor);
    }
    // Members exist; this is most likely a returning session that
    // just hasn't exported GUILD_ACTOR yet. Name a few concrete
    // options so the hint is actionable.
    const sample = members.slice(0, 3).map((m) => m.name.value);
    return stampActorResolved({
      verb: 'export',
      args: { GUILD_ACTOR: '<your-name>' },
      reason:
        `No GUILD_ACTOR set. Existing members: ${sample.join(', ')}` +
        (members.length > 3 ? ` (+${members.length - 3} more)` : '') +
        `. Export GUILD_ACTOR=<your-name>, or run gate register --name <your-name> if new.`,
    }, actor);
  }
  if (role === 'unknown') {
    return stampActorResolved({
      verb: 'register',
      args: { name: actor },
      reason:
        `GUILD_ACTOR=${actor} but "${actor}" is not a registered member or host. ` +
        `Run gate register --name ${actor} to create the member file.`,
    }, actor);
  }
  // Known actor: pick the most actionable open loop. Priority reflects
  // "which one would surprise the agent most if missed":
  //   1. Executing-by-me  → mid-flight work; resume/close it first
  //   2. Unreviewed mine  → others are blocked on our verdict
  //   3. Approved for me  → warm queue, ready to start
  //   4. Pending-as-exec  → bottleneck: approve or deny
  // Stops at the first match so the agent gets ONE verb to call next.
  // The other loops remain visible via status counts.
  //
  // The predicate logic lives in `actionableTransitions` (single source
  // of truth shared with `deriveVerbsAvailableNow`). This function picks
  // the first (highest-priority) one and crafts the suggest-flavored
  // reason for it.
  const transitions = actionableTransitions(actor, allRequests);
  const top = transitions[0];
  if (!top) return null;
  const id = top.request.id.value;
  switch (top.kind) {
    case 'executing-mine':
      return stampActorResolved({
        verb: 'complete',
        args: { id, by: actor },
        reason:
          `you are executing ${id} — ` +
          `complete it (or 'gate fail <id> --reason <s>' if it can't land).`,
      }, actor);
    case 'unreviewed-mine':
      return stampActorResolved({
        verb: 'review',
        args: { id, by: actor, lense: 'devil' },
        reason:
          `${id} completed with auto-review assigned to you; ` +
          `pick --verdict <ok|concern|reject> and --comment after reading the work.`,
      }, actor);
    case 'approved-for-me':
      return stampActorResolved({
        verb: 'execute',
        args: { id, by: actor },
        reason:
          `${id} is approved and names you as executor — ` +
          `start the work (gate execute), then complete/fail when done.`,
      }, actor);
    case 'pending-as-executor':
      return stampActorResolved({
        verb: 'approve',
        args: { id, by: actor },
        reason:
          `${id} is pending and names you as executor ` +
          `(authored by ${top.request.from.value}); approve it to unblock, ` +
          `or deny with --reason if it shouldn't proceed.`,
      }, actor);
  }
}

/**
 * Tag a verb/args/reason triple with whether the calling actor can
 * dispatch it as themselves. Mirrors `withActorResolved` in
 * writeFormat.ts — same field, same semantics, exported on
 * BootSuggestedNext so consumers see one consistent shape.
 */
function stampActorResolved(
  partial: Omit<BootSuggestedNext, 'actor_resolved'>,
  actor: string | null,
): BootSuggestedNext {
  const required = partial.args['by'];
  const resolved =
    required === undefined ||
    (typeof actor === 'string' &&
      actor.length > 0 &&
      required.toLowerCase() === actor.toLowerCase());
  return { ...partial, actor_resolved: resolved };
}

type ActionableKind =
  | 'executing-mine'
  | 'unreviewed-mine'
  | 'approved-for-me'
  | 'pending-as-executor';

interface ActionableTransition {
  kind: ActionableKind;
  request: Request;
  /** For `executing-mine`, which role the actor plays. */
  executorRole?: 'executor' | 'author';
}

// Priority order for suggested_next selection. Lower = picked first.
// `verbs_available_now` uses the full list in this order, too.
const ACTIONABLE_PRIORITY: Record<ActionableKind, number> = {
  'executing-mine': 0,
  'unreviewed-mine': 1,
  'approved-for-me': 2,
  'pending-as-executor': 3,
};

/**
 * Single source of truth for "what verbs does the actor have open right
 * now?". Both `deriveBootSuggestedNext` (picks top) and
 * `deriveVerbsAvailableNow` (emits all) consume this.
 *
 * Before this was extracted, the four predicates below were each
 * hand-written twice — once in each consumer. Adding a new RequestState
 * (or tweaking an existing trigger condition, e.g. "executor OR author
 * for executing-mine") required updating both copies and any drift
 * would silently surface in one API but not the other. Keeping the
 * logic here means a single edit propagates to both surfaces.
 */
function actionableTransitions(
  actor: string,
  allRequests: ReadonlyArray<Request>,
): ActionableTransition[] {
  const lower = actor.toLowerCase();
  const out: ActionableTransition[] = [];
  for (const r of allRequests) {
    // Executing-mine: actor is either assigned executor or the author
    // (which happens for requests filed-then-self-executed).
    if (
      r.state === 'executing' &&
      (r.executor?.value === lower || r.from.value === lower)
    ) {
      out.push({
        kind: 'executing-mine',
        request: r,
        executorRole:
          r.executor?.value === lower ? 'executor' : 'author',
      });
      continue;
    }
    // Unreviewed-mine: auto-review assigned to me but no review landed.
    if (
      r.state === 'completed' &&
      r.autoReview?.value === lower &&
      r.reviews.length === 0
    ) {
      out.push({ kind: 'unreviewed-mine', request: r });
      continue;
    }
    // Approved-for-me: ready to start executing.
    if (r.state === 'approved' && r.executor?.value === lower) {
      out.push({ kind: 'approved-for-me', request: r });
      continue;
    }
    // Pending-as-executor: approval bottleneck (non-self; self-approve
    // is still legal but fires the "self-approval" notice).
    if (
      r.state === 'pending' &&
      r.executor?.value === lower &&
      r.from.value !== lower
    ) {
      out.push({ kind: 'pending-as-executor', request: r });
    }
  }
  out.sort(
    (a, b) => ACTIONABLE_PRIORITY[a.kind] - ACTIONABLE_PRIORITY[b.kind],
  );
  return out;
}

const ALWAYS_READABLE_VERBS: readonly string[] = [
  'boot', 'suggest', 'status', 'show', 'board', 'list', 'pending',
  'tail', 'voices', 'chain', 'whoami', 'schema', 'doctor', 'resume',
  'unresponded', 'transcript', 'summarize', 'why',
];

/**
 * Enumerate the state-transition verbs whose preconditions are met
 * right now, with the target id + reason for each. `suggested_next`
 * picks ONE of these; this list names the siblings so an agent can
 * branch (e.g. "I see approve and deny are both valid — deny this,
 * the reason doesn't hold up").
 *
 * Kept deliberately narrow: only the gated transitions. Free verbs
 * (request, fast-track, message, broadcast) are always valid for a
 * registered member and listed via the identity-scoped catalog, not
 * here — repeating them per-request would bloat the payload.
 */
function deriveVerbsAvailableNow(
  actor: string | null,
  role: BootPayload['role'],
  allRequests: ReadonlyArray<Request>,
  hostNames: readonly string[],
): BootPayload['verbs_available_now'] {
  const actionable: BootPayload['verbs_available_now']['actionable'] = [];
  const requiresOtherActor: BootPayload['verbs_available_now']['requires_other_actor'] = [];
  if (actor === null || role === 'unknown') {
    return {
      actionable,
      requires_other_actor: requiresOtherActor,
      always_readable: ALWAYS_READABLE_VERBS,
    };
  }

  // Single source of truth shared with `deriveBootSuggestedNext`.
  // Previously the predicates below were hand-duplicated per kind in
  // both functions; now each kind lives in `actionableTransitions` and
  // we expand it into its valid verbs here.
  const transitions = actionableTransitions(actor, allRequests);
  for (const t of transitions) {
    const id = t.request.id.value;
    switch (t.kind) {
      case 'executing-mine': {
        const role = t.executorRole ?? 'executor';
        actionable.push({
          verb: 'complete',
          id,
          reason: `${id} is executing (you're the ${role})`,
        });
        actionable.push({
          verb: 'fail',
          id,
          reason: `${id} is executing; use fail if it can't land`,
        });
        break;
      }
      case 'unreviewed-mine':
        actionable.push({
          verb: 'review',
          id,
          reason: `${id} completed with auto-review assigned to you`,
        });
        break;
      case 'approved-for-me':
        actionable.push({
          verb: 'execute',
          id,
          reason: `${id} is approved and names you as executor`,
        });
        break;
      case 'pending-as-executor':
        actionable.push({
          verb: 'approve',
          id,
          reason: `${id} is pending and names you as executor (authored by ${t.request.from.value})`,
        });
        actionable.push({
          verb: 'deny',
          id,
          reason: `${id} is pending; deny with --reason if it shouldn't proceed`,
        });
        break;
    }
  }

  // requires_other_actor: blockers on the actor's own record.
  // Surfaces "your pending request needs approval by host X" so
  // the actor sees WHY their queue isn't moving without having
  // to read suggested_next's prose. Skipped when the actor is
  // already the candidate (e.g. host approving their own request,
  // or executor != author approving as the named executor) — those
  // cases show up under actionable via pending-as-executor, and
  // double-listing the same id+verb here would contradict it.
  // Empty when nothing waits.
  //
  // Shape decision: `candidates` is a list, not a single name, so
  // a content_root with N hosts (or zero) does not have to embed
  // a "first host" assumption in the payload. `reason` carries the
  // category of role required ("host approval"), not the host
  // name — readers in domains where "host" is the wrong word can
  // re-interpret without the field shape pushing back.
  const actorLower = actor.toLowerCase();
  const isHost = hostNames.some((h) => h.toLowerCase() === actorLower);
  if (!isHost) {
    for (const r of allRequests) {
      if (r.state !== 'pending') continue;
      // Only surface blockers on records the actor is involved in.
      // Otherwise every pending request in the content_root would
      // show up for every member, which is noise.
      const isAuthor = r.from.value === actorLower;
      const isExecutor = r.executor?.value === actorLower;
      const isPair = r.with.some((p) => p.value === actorLower);
      if (!isAuthor && !isExecutor && !isPair) continue;
      // Executor (when not also author) can self-approve via the
      // pending-as-executor predicate — that already lives under
      // actionable. Listing the same id+verb here as a blocker
      // would contradict actionable for the same record.
      if (isExecutor && !isAuthor) continue;
      requiresOtherActor.push({
        verb: 'approve',
        id: r.id.value,
        candidates: hostNames,
        reason:
          `${r.id.value} is pending; approval requires a host actor` +
          (hostNames.length === 0
            ? ' (none configured — see guild.config.yaml host_names)'
            : `. You are the ${
                isAuthor ? 'author' : isPair ? 'pair' : 'executor'
              } but cannot approve as yourself.`),
      });
    }
  }

  return {
    actionable,
    requires_other_actor: requiresOtherActor,
    always_readable: ALWAYS_READABLE_VERBS,
  };
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
  } else if (
    p.hints.cwd_outside_content_root ||
    p.hints.config_file === null
  ) {
    // Surface the resolved content_root + config when the cwd is
    // surprising (subdir of an active guild) or implicit (no config
    // found, cwd silently used as fallback root). Suppressed at the
    // alignment case to keep the normal run quiet — voice budget.
    // Phrasing matches the `(config: ...)` segment of `gate
    // register`'s notice (PR #108) for cross-verb recognition.
    const configSegment =
      p.hints.config_file === null
        ? 'config: none — cwd used as fallback root'
        : `config: ${p.hints.config_file}`;
    lines.push('');
    lines.push(
      `content root: ${p.hints.resolved_content_root} (${configSegment})`,
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
        lines.push(`  ${u.at}  req=${u.request_id}  [${u.lense}/${u.verdict}] by ${u.by}`);
      } else if (u.kind === 'thank') {
        lines.push(`  ${u.at}  req=${u.request_id}  thank ${u.by} → ${u.to}`);
      } else {
        lines.push(`  ${u.at}  req=${u.request_id}  authored by ${u.from}`);
      }
    }
  }
  if (p.your_recent && p.your_recent.length > 0) {
    lines.push('');
    lines.push(`your recent (${p.your_recent.length}):`);
    for (const u of p.your_recent.slice(0, 3)) {
      if (u.kind === 'review') {
        lines.push(`  ${u.at}  req=${u.request_id}  [${u.lense}/${u.verdict}]`);
      } else {
        lines.push(`  ${u.at}  req=${u.request_id}  authored`);
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
