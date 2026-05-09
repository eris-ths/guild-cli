import { resolveGuildActor } from '../../shared/resolveGuildActor.js';
import { resolveGuildSessionId } from '../../shared/resolveGuildSessionId.js';
import { resolve } from 'node:path';
import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { C, loadAllRequestsAsJson, parseOptionalIntOption } from './internal.js';
import { SESSION_ID_RE } from '../../../domain/request/Request.js';

const BOOT_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'format',
  'tail',
  'utterances',
  'session-id',
]);
import { collectStatus, StatusSummary } from './status.js';
import { collectUtterances } from '../voices.js';
import { Request } from '../../../domain/request/Request.js';
import {
  PassageOrientationProvider,
  PassageOrientationSummary,
} from '../../shared/PassageOrientation.js';
import { agoraOrientation } from '../../../passages/agora/interface/orientation.js';
import { ctxOrientation } from '../../../passages/ctx/interface/orientation.js';
import { devilOrientation } from '../../../passages/devil/interface/orientation.js';

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
 * Surface for unread broadcasts whose sender opted into
 * `expects_response: true`. Distinct shape (no verb/args/reason
 * triple) because Phase 1 deliberately does NOT prescribe a verb to
 * call — the recipient decides whether to reply with `gate message`,
 * file a request, mark-read as ack, or ignore. Read-with-mark-read
 * is the proxy for "ack"; the entry disappears from this surface
 * the moment the inbox entry flips to read.
 *
 * Priority sits below every state-transition kind in
 * `actionableTransitions` (executing-mine ... reviewed-authored) so
 * a pending review or executing request always wins suggested_next.
 */
export interface BootBroadcastPendingResponse {
  kind: 'broadcast-pending-response';
  broadcast_from: string;
  broadcast_at: string;
  hint: string;
  /**
   * Mirrors the `actor_resolved` field on `BootSuggestedNext` (and on
   * the write-response `SuggestedNext` shape in writeFormat.ts) so the
   * two variants of `boot.suggested_next` share one consumer-facing
   * field. The pending-broadcast surface is always actor-resolved
   * (true): it only fires for the calling actor's own inbox, so the
   * "next move" is unambiguously theirs to make. Carried verbatim
   * rather than inferred at the consumer so an orchestrator that
   * reads `.actor_resolved` across both variants never has to
   * branch on `.kind` first.
   */
  actor_resolved: true;
}

export type BootSuggestedNextOrPendingResponse =
  | BootSuggestedNext
  | BootBroadcastPendingResponse;

/**
 * Surface for active (non-terminal) requests sharing a target.
 *
 * Two or more `pending` / `approved` / `executing` requests pointing
 * at the same `target` string indicate cross-session race risk:
 * substrate-experiment 5 saw an independent session pre-empt our
 * #221 implementation because nobody booted into "someone else is
 * already working on that target".
 *
 * Detection is exact-match on the freeform `target` field. Fuzzy
 * grouping (startsWith / contains) would false-positive on common
 * path prefixes (`src/`, `data/guild/templates`) and is deferred —
 * see issue #234 "overlap 検知ロジック".
 *
 * Profile gating: phase 1 surfaces overlaps as a notice on every
 * profile. The harder enforcement (`profile: swarm` refuses
 * unclaimed overlapping requests at create time) is the parent
 * epic's territory (#227) and not in this slot.
 *
 * Empty array when no active group has size ≥ 2; readers should
 * gate text rendering on `length > 0` to avoid emitting a noise
 * section in the common "no overlap" case.
 */
export interface BootActiveOverlap {
  /** The shared target string, verbatim. */
  target: string;
  /**
   * The active requests sharing the target, in id ascending order
   * (deterministic across runs so an agent doing diff reasoning
   * over successive boots sees stable membership).
   */
  requests: ReadonlyArray<{
    id: string;
    state: 'pending' | 'approved' | 'executing';
    /** Recorded executors. May be empty (none assigned yet). */
    executors: readonly string[];
    /**
     * Member who staked an exclusive claim via `gate claim` (#226
     * phase 1). Omitted when nobody has claimed — absence on read
     * is the unclaimed signal, mirroring the omit-when-undefined
     * convention used elsewhere on this payload (e.g.
     * `inbox_unread[].expects_response`). Renders as `claim_held`
     * in text mode so a coordinating actor sees who currently owns
     * the wave at a glance.
     */
    claimed_by?: string;
  }>;
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
  /**
   * Boot-context session_id (#249 slice 2). Resolution priority:
   *   1. `--session-id <id>` flag on this invocation.
   *   2. `GUILD_SESSION_ID` env var.
   *   3. null — unstamped session.
   *
   * `source` names which input won; null when neither was provided.
   * Surfaces here so an orchestrator that calls `gate boot` to
   * acquire the orientation payload can also discover what session
   * id will be stamped on subsequent write verbs (request / claim /
   * witness). `--session-id` does NOT persist or export the value
   * itself — the caller is expected to `export GUILD_SESSION_ID=<id>`
   * to make it available to downstream invocations. Per the issue
   * #249 opt-in policy, an actor-resolved boot with no session
   * surfaces a hint inside `hints.session_id_unset` so the feature
   * is discoverable without forcing a value.
   */
  session_id: string | null;
  session_id_source: 'flag' | 'env' | null;
  status: StatusSummary;
  tail: ReturnType<typeof collectUtterances>;
  your_recent: ReturnType<typeof collectUtterances> | null;
  inbox_unread: Array<{
    at: string;
    from: string;
    text: string;
    type: string;
    /**
     * Mirrors `InboxMessage.expectsResponse`. Emitted only when the
     * sender opted in (true) — absent otherwise, matching the
     * omit-when-undefined convention used elsewhere on this payload.
     */
    expects_response?: boolean;
  }>;
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
    /**
     * `session_id_unset` (#249 slice 2): true iff GUILD_ACTOR resolved
     * (so we have a real session to talk about) AND no session_id was
     * supplied via flag or env. Surface fires the discovery hint so
     * an actor running `gate boot` for the first time post-#249 sees
     * the new opt-in without having to read the changelog. Suppressed
     * for unauthenticated boots (actor=null) — there is no session to
     * stamp anyway, and emitting the hint there would be noise on
     * every fresh-start orientation.
     */
    session_id_unset: boolean;
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
   * Cross-passage orientation. Each registered passage that has any
   * records under the content_root contributes a normalized summary
   * (open count, suspended count, last-touched id/state/at). Empty
   * passages omit their entry entirely. The map is empty when no
   * passage besides gate has any records.
   *
   * Closes the substrate-side Zeigarnik continuity gap surfaced by
   * the develop-branch dogfood (`cross-passage-orient` agora play):
   * fresh instances that boot on a content_root with active agora
   * plays or devil reviews previously saw nothing about them at the
   * orientation entry point. The Zeigarnik primitive (agora's
   * cliff/invitation) breaks if cliffs aren't surfaced where the
   * future instance lands.
   *
   * Per principle 04 (records outlive writers), substrate must be
   * findable on re-entry, not just present on disk.
   */
  cross_passage: Record<string, PassageOrientationSummary>;
  /**
   * Active (non-terminal) requests sharing a target, surfaced for
   * cross-session race detection (issue #234). Empty array when no
   * group has size ≥ 2. Each entry's `requests` list carries enough
   * for an agent to decide whether to coordinate via `gate claim` /
   * `gate witness` (#226) or proceed in parallel. See
   * BootActiveOverlap for the per-entry contract.
   */
  active_overlapping_targets: ReadonlyArray<BootActiveOverlap>;
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
  suggested_next: BootSuggestedNextOrPendingResponse | null;
}

export async function bootCmd(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, BOOT_KNOWN_FLAGS, 'boot');
  const format = optionalOption(args, 'format') ?? 'json';
  if (format !== 'json' && format !== 'text') {
    throw new Error(`--format must be 'json' or 'text', got: ${format}`);
  }
  // Default tail=5 (was 10) to keep `gate boot` lean — agents call
  // boot at every session start, so the orientation payload is on the
  // hot path. 5 covers "what just happened" without flooding the JSON
  // (each utterance entry is ~6-8 lines pretty-printed). Callers that
  // want deeper history pass `--tail <N>` explicitly. Per principle 13:
  // bootstrap-shape verbs tolerate noise less than they look (high
  // frequency × full context = death by a thousand cuts).
  const tailLimit = parseOptionalIntOption(args, 'tail') ?? 5;
  const personalLimit = parseOptionalIntOption(args, 'utterances') ?? 5;

  const envActor = resolveGuildActor();
  const actor = envActor && envActor.length > 0 ? envActor : null;

  // Boot-context session_id (#249 slice 2). Flag wins over env so an
  // orchestrator's explicit override is honoured even when the shell
  // exported a stale value. Validation matches resolveGuildSessionId
  // (the env-side helper) so the two resolution paths use one regex.
  const sessionIdFlag = optionalOption(args, 'session-id');
  let sessionId: string | null = null;
  let sessionIdSource: 'flag' | 'env' | null = null;
  if (sessionIdFlag !== undefined && sessionIdFlag.length > 0) {
    if (!SESSION_ID_RE.test(sessionIdFlag)) {
      throw new Error(
        `--session-id "${sessionIdFlag}" does not match the session_id format ` +
          `(lowercase alphanumeric + _-.: separators, ≤64 chars).`,
      );
    }
    sessionId = sessionIdFlag;
    sessionIdSource = 'flag';
  } else {
    const envSession = resolveGuildSessionId();
    if (envSession !== undefined) {
      sessionId = envSession;
      sessionIdSource = 'env';
    }
  }

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
        inboxUnread.push({
          at: m.at,
          from: m.from,
          text: m.text,
          type: m.type,
          ...(m.expectsResponse === true ? { expects_response: true } : {}),
        });
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

  const baseSuggestedNext = deriveBootSuggestedNext(
    actor,
    role,
    members,
    allRequests,
  );
  // broadcast-pending-response sits at the tail of the priority
  // ladder: only fires when no transition-kind suggestion was found
  // (executing/unreviewed/approved/pending/reviewed-authored all
  // empty). Pre-onboarding hints (register, export GUILD_ACTOR) also
  // suppress it — those are stronger signals than an unanswered
  // broadcast. Phase 1 does not resolve "who replied"; surface
  // disappears when the entry is mark-read (read = ack proxy).
  const suggestedNext: BootSuggestedNextOrPendingResponse | null =
    baseSuggestedNext !== null
      ? baseSuggestedNext
      : derivePendingBroadcastResponse(inboxUnread);
  const verbsAvailableNow = deriveVerbsAvailableNow(
    actor,
    role,
    allRequests,
    c.config.hostNames,
  );

  // Populate status.reviews_unseen for the resolved actor. Mirrors the
  // boundary used by `actionableTransitions` (Request aggregate scope)
  // so the scalar in `status` and the per-request entries under
  // `verbs_available_now.actionable[]` always agree on what counts as
  // "unseen". Skipped when no actor is resolved — there is no boundary
  // to evaluate against.
  if (actor) {
    const lastAuthoredAt = computeLastAuthoredWriteAt(actor, allRequests);
    const lower = actor.toLowerCase();
    let unseen = 0;
    for (const r of allRequests) {
      if (r.from.value !== lower) continue;
      for (const v of r.reviews) {
        if (lastAuthoredAt === null || v.at > lastAuthoredAt) unseen += 1;
      }
    }
    if (unseen > 0) status.reviews_unseen = unseen;
  }

  const crossPassage = await collectCrossPassage(c.config);
  const activeOverlappingTargets = computeActiveOverlappingTargets(allRequests);

  const sessionIdUnset = actor !== null && sessionId === null;

  const payload: BootPayload = {
    actor,
    role,
    session_id: sessionId,
    session_id_source: sessionIdSource,
    status,
    tail,
    your_recent: yourRecent,
    inbox_unread: inboxUnread,
    last_activity: status.last_activity,
    hints: {
      session_id_unset: sessionIdUnset,
      misconfigured_cwd: misconfiguredCwd,
      cwd_outside_content_root: cwdOutsideContentRoot,
      config_file: c.config.configFile,
      resolved_content_root: c.config.contentRoot,
      content_root_health: contentRootHealth,
    },
    cross_passage: crossPassage,
    active_overlapping_targets: activeOverlappingTargets,
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
    case 'reviewed-authored': {
      const n = top.reviewsUnseen ?? top.request.reviews.length;
      return stampActorResolved({
        verb: 'show',
        args: { id },
        reason:
          `${id} (you authored) has ${n} review(s) since your last activity ` +
          `on a request — read with gate show ${id}. ` +
          `(boundary advances when you write to any request: status_log, reviews, or thanks.)`,
      }, actor);
    }
  }
}

/**
 * Tag a verb/args/reason triple with whether the calling actor can
 * dispatch it as themselves. Mirrors `withActorResolved` in
 * writeFormat.ts — same field, same semantics, exported on
 * BootSuggestedNext so consumers see one consistent shape.
 */
/**
 * Registry of passage orientation providers. Each passage that
 * lives under `<content_root>/<name>/` contributes one provider;
 * boot polls all of them at orientation time.
 *
 * Static array (rather than dynamic registry) because the package
 * ships gate, agora, devil together — there's nothing to discover
 * at runtime. The seam exists so adding a new passage is a one-
 * line change here plus the passage's own provider, not a refactor
 * of boot.ts. Failure of any single provider is contained: errors
 * are logged to stderr and the rest of the registry continues.
 */
const PASSAGE_ORIENTATION_REGISTRY: ReadonlyArray<{
  name: string;
  provider: PassageOrientationProvider;
}> = [
  { name: 'agora', provider: agoraOrientation },
  { name: 'devil', provider: devilOrientation },
  { name: 'ctx', provider: ctxOrientation },
];

async function collectCrossPassage(
  config: C['config'],
): Promise<Record<string, PassageOrientationSummary>> {
  const out: Record<string, PassageOrientationSummary> = {};
  for (const { name, provider } of PASSAGE_ORIENTATION_REGISTRY) {
    try {
      const summary = await provider(config);
      if (summary !== null) out[name] = summary;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(
        `notice: passage '${name}' orientation provider failed: ${msg} ` +
          `(boot continues; cross_passage.${name} omitted)\n`,
      );
    }
  }
  return out;
}

/**
 * Lowest-priority hint: pick the oldest unread broadcast whose sender
 * stamped `expects_response: true`. Returns null when no such entry
 * exists, when expectsResponse was never opted in, or when every
 * matching entry has been mark-read.
 *
 * "Oldest first" is deliberate — broadcasts pile up FIFO and the
 * surface should drain in the same order so a backlog doesn't have
 * the newest one perpetually shadow the earliest unanswered ask.
 *
 * Hint text names the sender + the act available (gate message back,
 * or mark-read as ack). It deliberately does NOT prescribe a verb,
 * because the reply could be a new request, a thank, a counter-
 * broadcast, or just acknowledgement; suggesting only one would push
 * readers toward a single shape Phase 1 doesn't intend to mandate.
 */
function isBroadcastPendingResponse(
  n: BootSuggestedNextOrPendingResponse,
): n is BootBroadcastPendingResponse {
  return (n as BootBroadcastPendingResponse).kind === 'broadcast-pending-response';
}

function derivePendingBroadcastResponse(
  inboxUnread: BootPayload['inbox_unread'],
): BootBroadcastPendingResponse | null {
  // Filter to flagged broadcast entries only. Filtering by
  // `type === 'broadcast'` so a custom `--type handoff` direct
  // message (which can't carry the expects_response opt-in via the
  // broadcast handler today) doesn't accidentally surface here even
  // if a future writer set the bit out-of-band.
  const flagged = inboxUnread.filter(
    (m) => m.type === 'broadcast' && m.expects_response === true,
  );
  if (flagged.length === 0) return null;
  // Explicit FIFO sort: oldest `at` first. inboxUnread is already
  // chronologically ordered today (post() appends, listFor preserves
  // order), but sorting here pins the contract at the consumer:
  // a long backlog must drain in the order the senders asked, even
  // if the inbox loader's order ever changes. Lexicographic compare
  // on ISO-Z timestamps is exact (Thank.ts:43 / Review.ts / inbox
  // entries all emit UTC-Z).
  const sorted = [...flagged].sort((a, b) => a.at.localeCompare(b.at));
  const oldest = sorted[0]!;
  // `+N more pending` suffix is FLAGGED-only: it counts the
  // pending-response candidates, not the entire unread inbox. An
  // unflagged twin from the same sender (or any unrelated unread
  // entry) must NOT inflate this count — the surface is about
  // unanswered opt-in asks, and the suffix has to mean exactly that.
  const more =
    sorted.length > 1 ? ` (+${sorted.length - 1} more pending)` : '';
  return {
    kind: 'broadcast-pending-response',
    broadcast_from: oldest.from,
    broadcast_at: oldest.at,
    hint:
      `unread broadcast from ${oldest.from} marked expects_response=true${more}; ` +
      'reply with `gate message --to ' + oldest.from + ' --text ...` if you ' +
      'have a substantive response, or `gate inbox mark-read` to ' +
      'acknowledge in passing — the surface clears either way.',
    actor_resolved: true,
  };
}

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
  | 'pending-as-executor'
  | 'reviewed-authored';

interface ActionableTransition {
  kind: ActionableKind;
  request: Request;
  /** For `executing-mine`, which role the actor plays. */
  executorRole?: 'executor' | 'author';
  /**
   * For `reviewed-authored`: how many reviews on the authored request
   * landed after the actor's last write to any request aggregate.
   * Surfaced in the reason text so the agent sees how many they're
   * about to read.
   */
  reviewsUnseen?: number;
}

// Priority order for suggested_next selection. Lower = picked first.
// `verbs_available_now` uses the full list in this order, too.
//
// `reviewed-authored` sits at PRIORITY=4 (after the four
// pending/approved/executing/completed transitions) because it's a
// READ surface — the actor authored a request, peers reviewed it,
// and the agent should read those reviews when no higher-priority
// state-transition work is open. Boundary advances when the actor
// writes to ANY request aggregate (status_log, reviews, or thanks),
// so once the reviews are read and acknowledged via review/thank/
// complete the surface clears naturally.
const ACTIONABLE_PRIORITY: Record<ActionableKind, number> = {
  'executing-mine': 0,
  'unreviewed-mine': 1,
  'approved-for-me': 2,
  'pending-as-executor': 3,
  'reviewed-authored': 4,
};

/**
 * Cap on how many `reviewed-authored` entries get appended to
 * `verbs_available_now.actionable[]`. Without a cap, an actor with N
 * authored requests × M reviews per request could balloon the boot
 * payload — this verb sits on the agent hot path (every session
 * start) so payload bloat is a real cost. 5 covers the "what's piled
 * up since I last wrote" surface; deeper backlogs are still visible
 * via `status.reviews_unseen` (the running counter).
 */
const REVIEWED_AUTHORED_ACTIONABLE_CAP = 5;

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
    // Executing-mine: actor is either assigned executor (anywhere in
    // the multi-executor list, issue #230) or the author (which
    // happens for requests filed-then-self-executed).
    //
    // Membership-based on `r.hasExecutor` rather than scalar
    // `r.executor?.value === lower`: that earlier shape silently
    // dropped every executor past index 0 — a parallel-impl wave with
    // `--executors miki,leysia` would surface to miki and never to
    // leysia (substrate-experiment 6's attribution race regenerated
    // at the agent-loop layer). Devil review #230 blocker 1.
    if (
      r.state === 'executing' &&
      (r.hasExecutor(lower) || r.from.value === lower)
    ) {
      out.push({
        kind: 'executing-mine',
        request: r,
        executorRole:
          r.hasExecutor(lower) ? 'executor' : 'author',
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
    // Approved-for-me: ready to start executing. Same array-aware
    // membership as executing-mine — every named executor sees the
    // approval, not just the first.
    if (r.state === 'approved' && r.hasExecutor(lower)) {
      out.push({ kind: 'approved-for-me', request: r });
      continue;
    }
    // Pending-as-executor: approval bottleneck (non-self; self-approve
    // is still legal but fires the "self-approval" notice). Multi-
    // executor extension: any named executor receives the bottleneck
    // signal — none of them is silently skipped.
    if (
      r.state === 'pending' &&
      r.hasExecutor(lower) &&
      r.from.value !== lower
    ) {
      out.push({ kind: 'pending-as-executor', request: r });
    }
  }

  // reviewed-authored: only surface when the four state-transition
  // kinds above are empty. Devil v3 ratify: the higher-priority kinds
  // are about state changes the actor must drive; reviewed-authored
  // is about catching up on peer feedback. Rolling them together
  // would push critical transitions off the suggested_next slot for
  // every actor with stale review traffic.
  if (out.length === 0) {
    const lastAuthoredAt = computeLastAuthoredWriteAt(actor, allRequests);
    for (const r of allRequests) {
      if (r.from.value !== lower) continue;
      if (r.reviews.length === 0) continue;
      // Latest review timestamp on this authored request.
      let latest: string | null = null;
      let unseen = 0;
      for (const v of r.reviews) {
        if (lastAuthoredAt === null || v.at > lastAuthoredAt) unseen += 1;
        if (latest === null || v.at > latest) latest = v.at;
      }
      if (latest === null) continue;
      if (lastAuthoredAt !== null && latest <= lastAuthoredAt) continue;
      out.push({ kind: 'reviewed-authored', request: r, reviewsUnseen: unseen });
    }
  }

  out.sort(
    (a, b) => ACTIONABLE_PRIORITY[a.kind] - ACTIONABLE_PRIORITY[b.kind],
  );
  return out;
}

/**
 * Latest timestamp at which the actor wrote to ANY request aggregate.
 * Boundary scope is the Request aggregate — message/inbox/issues
 * writes are intentionally NOT counted (those have their own
 * notification surfaces; mixing them here would dilute the signal of
 * "have I responded to a peer review yet").
 *
 * Aggregates three write paths Request.ts persists:
 *   1. status_log[] entries (transitions: pending/approved/executing/...).
 *   2. reviews[] entries (lense-driven judgements).
 *   3. thanks[] entries (cross-actor appreciation).
 *
 * Returns null when the actor has never written to any request — in
 * which case every review on every authored request is "after" their
 * (nonexistent) last write, and the predicate falls through to
 * "any review on my authored request".
 *
 * ISO8601 lexicographic comparison is exact when every timestamp is
 * UTC-Z formatted (the only shape Request.ts emits, see Thank.ts:43,
 * Review.ts and StatusLog entry.at).
 */
/**
 * Group active (non-terminal) requests by their `target` and surface
 * groups with size ≥ 2 as overlap warnings. See BootActiveOverlap
 * for the surface contract and issue #234 for the parent context
 * (substrate-experiment 5: independent sessions silently raced on
 * the same wave because the substrate had no "someone else is on
 * it" surface at boot).
 *
 * Active = `pending` | `approved` | `executing`. Terminal states
 * (`completed` | `failed` | `denied`) are skipped — a completed
 * wave on the same target is not a race; it is history.
 *
 * Targets that are unset, empty, or whitespace-only are skipped:
 * "two requests with no target" is not a coordination signal.
 *
 * Per-group output is sorted by id ascending so consecutive boots
 * agree on member order (an agent diff-reasoning over the field
 * across runs sees stable composition); the overall list is sorted
 * by target so the same property holds across multiple groups.
 */
export function computeActiveOverlappingTargets(
  allRequests: ReadonlyArray<Request>,
): BootActiveOverlap[] {
  const ACTIVE: ReadonlySet<string> = new Set([
    'pending',
    'approved',
    'executing',
  ]);
  const groups = new Map<string, Request[]>();
  for (const r of allRequests) {
    if (!ACTIVE.has(r.state)) continue;
    const target = r.target;
    if (target === undefined || target.trim() === '') continue;
    const arr = groups.get(target);
    if (arr) arr.push(r);
    else groups.set(target, [r]);
  }
  const overlaps: BootActiveOverlap[] = [];
  for (const [target, reqs] of groups) {
    if (reqs.length < 2) continue;
    const sorted = [...reqs].sort((a, b) =>
      a.id.value < b.id.value ? -1 : a.id.value > b.id.value ? 1 : 0,
    );
    overlaps.push({
      target,
      requests: sorted.map((r) => ({
        id: r.id.value,
        state: r.state as 'pending' | 'approved' | 'executing',
        executors: r.executors.map((e) => e.value),
        ...(r.claimedBy !== undefined ? { claimed_by: r.claimedBy.value } : {}),
      })),
    });
  }
  overlaps.sort((a, b) =>
    a.target < b.target ? -1 : a.target > b.target ? 1 : 0,
  );
  return overlaps;
}

export function computeLastAuthoredWriteAt(
  actor: string,
  allRequests: ReadonlyArray<Request>,
): string | null {
  const lower = actor.toLowerCase();
  let max: string | null = null;
  for (const r of allRequests) {
    for (const e of r.statusLog) {
      if (e.by === lower && (max === null || e.at > max)) max = e.at;
    }
    for (const v of r.reviews) {
      if (v.by.value === lower && (max === null || v.at > max)) max = v.at;
    }
    for (const t of r.thanks ?? []) {
      if (t.by.value === lower && (max === null || t.at > max)) max = t.at;
    }
  }
  return max;
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
  // reviewed-authored entries get appended to actionable[] with a
  // hard cap (REVIEWED_AUTHORED_ACTIONABLE_CAP) — the running total
  // is exposed via status.reviews_unseen so the agent sees the full
  // backlog without the payload itself ballooning.
  let reviewedAuthoredAppended = 0;
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
      case 'reviewed-authored': {
        if (reviewedAuthoredAppended >= REVIEWED_AUTHORED_ACTIONABLE_CAP) break;
        const n = t.reviewsUnseen ?? t.request.reviews.length;
        actionable.push({
          verb: 'show',
          id,
          reason: `${id} (you authored) has ${n} review(s) since your last activity`,
        });
        reviewedAuthoredAppended += 1;
        break;
      }
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
      // Multi-executor membership (issue #230): scalar
      // `r.executor?.value` would silently miss every later-listed
      // executor. Use the array-aware predicate so all named
      // executors see the blocker.
      const isExecutor = r.hasExecutor(actorLower);
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
    const sessionTag =
      p.session_id !== null ? ` · session=${p.session_id}` : '';
    lines.push(`── you are ${p.actor} (${p.role})${sessionTag} ──`);
  } else {
    lines.push('── boot (no GUILD_ACTOR; global view) ──');
  }
  if (p.hints.session_id_unset) {
    lines.push('');
    lines.push(
      'notice: no session_id resolved (GUILD_SESSION_ID unset, no --session-id flag).',
    );
    lines.push(
      '  request / claim / witness will not stamp a session on subsequent calls.',
    );
    lines.push(
      '  fix: pick a name (e.g. eris-local-2026-05-08-evening) and either',
    );
    lines.push(
      '    export GUILD_SESSION_ID=<id>            # whole shell',
    );
    lines.push(
      '    gate boot --session-id <id>             # this orientation only',
    );
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

  // Cross-passage summary: render only the passages with records.
  // Empty cross_passage stays silent (voice budget — fresh roots
  // shouldn't see "agora: 0/0/null" noise).
  const crossEntries = Object.values(p.cross_passage);
  if (crossEntries.length > 0) {
    lines.push('');
    for (const s of crossEntries) {
      const suspendedNote =
        s.suspended > 0 ? ` (${s.suspended} paused)` : '';
      const lastNote =
        s.last_id !== null
          ? `; last ${s.last_id} [${s.last_state}]`
          : '';
      lines.push(`${s.passage}: ${s.open} open${suspendedNote}${lastNote}`);
    }
  }

  // Cross-session race surface (issue #234). Only rendered when at
  // least one target has ≥ 2 active requests; the empty case stays
  // silent so the common "no overlap" boot doesn't carry an empty
  // header line. JSON consumers read `active_overlapping_targets`
  // directly — text mode here is the human-readable projection.
  if (p.active_overlapping_targets.length > 0) {
    lines.push('');
    lines.push('active waves with overlapping target:');
    for (const o of p.active_overlapping_targets) {
      for (const r of o.requests) {
        const exec =
          r.executors.length > 0 ? r.executors.join(',') : '(no executor)';
        const claim = r.claimed_by !== undefined ? ', claim_held' : '';
        lines.push(
          `  - ${r.id} (${exec}, ${r.state}${claim}) — target: ${o.target}`,
        );
      }
    }
    lines.push(
      '  ⚠ overlap detected. coordinate via `gate witness <id>` or `gate claim <id>`.',
    );
  }

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
    const n: BootSuggestedNextOrPendingResponse = p.suggested_next;
    if (isBroadcastPendingResponse(n)) {
      // No single verb to print — the recipient picks the shape of
      // their reply (message back, mark-read as ack, or branch into
      // a request). Lead with the broadcaster + timestamp so the
      // reader can locate the entry in their inbox.
      lines.push(
        `→ pending broadcast response: from ${n.broadcast_from} at ${n.broadcast_at}`,
      );
      lines.push(`  (${n.hint})`);
      return lines.join('\n') + '\n';
    }
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
