// Boot's derivation layer: actionable transitions, suggested_next
// computation, verbs-available-now expansion, overlapping-target
// detection, and the cross-record helpers they share.
//
// Extracted from boot.ts during the 2026-05-13 split (#3xx). The
// original 1661-line module mixed types, derivation, rendering, and
// the bootCmd dispatcher; this file owns the derivation half. Types
// live in bootTypes.ts (leaf); the text renderer lives in
// bootRender.ts; bootCmd stays in boot.ts and orchestrates the three.

import { Request } from '../../../domain/request/Request.js';
import type {
  BootSuggestedNext,
  BootBroadcastPendingResponse,
  BootSuggestedNextOrPendingResponse,
  BootActiveOverlap,
  BootPayload,
  ActionableKind,
  ActionableTransition,
} from './bootTypes.js';

// Re-export `isBroadcastPendingResponse` and `derivePendingBroadcastResponse`
// so the renderer can branch on the suggested_next variant without
// re-deriving the predicate. The render layer needs the type-guard;
// bootCmd needs the derivation. Both live here so the shape is
// authored once.

/**
 * Decide the orientation hint for a freshly-booted actor. Returns
 * `null` when boot has no prescription. Used by bootCmd to populate
 * `BootPayload.suggested_next`, and re-exported via boot.ts for
 * `gate suggest`'s lighter sibling surface.
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
export function isBroadcastPendingResponse(
  n: BootSuggestedNextOrPendingResponse,
): n is BootBroadcastPendingResponse {
  return (n as BootBroadcastPendingResponse).kind === 'broadcast-pending-response';
}

export function derivePendingBroadcastResponse(
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

/**
 * Tag a verb/args/reason triple with whether the calling actor can
 * dispatch it as themselves. Mirrors `withActorResolved` in
 * writeFormat.ts — same field, same semantics, exported on
 * BootSuggestedNext so consumers see one consistent shape.
 */
export function stampActorResolved(
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
export function actionableTransitions(
  actor: string,
  allRequests: ReadonlyArray<Request>,
): ActionableTransition[] {
  const lower = actor.toLowerCase();
  const out: ActionableTransition[] = [];
  for (const r of allRequests) {
    // Executing-mine: actor is either assigned executor (anywhere in
    // the multi-executor list, issue #230) or — only as a legacy
    // fallback when executors list is empty — the author (the
    // filed-then-self-executed shape from pre-#230 records that
    // never populated executors).
    //
    // Membership-based on `r.hasExecutor` rather than scalar
    // `r.executor?.value === lower`: that earlier shape silently
    // dropped every executor past index 0 — a parallel-impl wave with
    // `--executors miki,leysia` would surface to miki and never to
    // leysia (substrate-experiment 6's attribution race regenerated
    // at the agent-loop layer). Devil review #230 blocker 1.
    //
    // The author-fallback is gated on `executors.length === 0`
    // (rather than the looser `|| from === lower`) because when a
    // wave names someone else as executor, the author CANNOT
    // dispatch `gate complete --by <author>` — the lifecycle
    // rejects `--by` mismatches. Surfacing the author into the
    // actionable ladder produced a `→ next: gate complete <id> --by
    // <author>` suggestion that always errored on dispatch (observed
    // 2026-05-13 on req 2026-05-08-0012, author=eris, executors=[miki]).
    if (
      r.state === 'executing' &&
      (r.hasExecutor(lower) ||
        (r.executors.length === 0 && r.from.value === lower))
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
    // Same-actor parallel-session detection (#249 slice 4). For each
    // author in the group, collect distinct session_ids in first-
    // mention order. A record without `opened_by_session` does NOT
    // count toward divergence — its provenance is unknown, and
    // counting absence as a separate "session" would falsely flag
    // every mixed pre-#249 / post-#249 group. The map only includes
    // authors with ≥2 distinct sessions; empty when no author races
    // themselves.
    const sessionsByAuthor = new Map<string, string[]>();
    for (const r of sorted) {
      const author = r.from.value;
      const sess = r.openedBySession;
      if (sess === undefined || sess.length === 0) continue;
      const list = sessionsByAuthor.get(author);
      if (list === undefined) {
        sessionsByAuthor.set(author, [sess]);
      } else if (!list.includes(sess)) {
        list.push(sess);
      }
    }
    const parallelSessionAuthors: Record<string, readonly string[]> = {};
    let hasParallel = false;
    for (const [author, sessions] of sessionsByAuthor) {
      if (sessions.length >= 2) {
        parallelSessionAuthors[author] = sessions;
        hasParallel = true;
      }
    }
    overlaps.push({
      target,
      requests: sorted.map((r) => ({
        id: r.id.value,
        state: r.state as 'pending' | 'approved' | 'executing',
        executors: r.executors.map((e) => e.value),
        ...(r.claimedBy !== undefined ? { claimed_by: r.claimedBy.value } : {}),
        ...(r.openedBySession !== undefined
          ? { opened_by_session: r.openedBySession }
          : {}),
      })),
      ...(hasParallel ? { parallel_session_authors: parallelSessionAuthors } : {}),
    });
  }
  overlaps.sort((a, b) =>
    a.target < b.target ? -1 : a.target > b.target ? 1 : 0,
  );
  return overlaps;
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
export function deriveVerbsAvailableNow(
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
