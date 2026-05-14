// gate boot — session-start orientation dispatcher.
//
// Composes identity + queues + recent activity + unread messages +
// cross-passage state into one JSON payload an autonomous agent can
// fetch with a single tool call on startup. The text-mode projection
// is the human-readable rendering of the same payload.
//
// Structure (split during the 2026-05-13 refactor):
//   - bootTypes.ts      → payload shapes (BootPayload, BootSuggestedNext, ...)
//   - bootActionable.ts → derivation logic (actionable transitions,
//                          suggested_next, verbs_available_now, overlap)
//   - bootRender.ts     → text-mode renderer + cross-passage fan-out
//   - boot.ts (this)    → bootCmd: orchestrates the three, owns the
//                          dispatch + payload assembly.
//
// `deriveBootSuggestedNext` is re-exported here for `gate suggest`'s
// lighter sibling surface. `computeLastAuthoredWriteAt` is re-exported
// for the boot.test.ts dynamic import.
//
// The JSON shape is stable across 0.x patch releases — agents can
// depend on it. New fields may be ADDED but existing ones won't be
// renamed or removed without a minor-version bump.

import { resolveGuildActor } from '../../shared/resolveGuildActor.js';
import { resolveGuildSessionId } from '../../shared/resolveGuildSessionId.js';
import { resolve } from 'node:path';
import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { maybeEmitExplain } from '../../shared/explain.js';
import { C, parseOptionalIntOption } from './internal.js';
import { SESSION_ID_RE } from '../../../domain/request/Request.js';
import { collectStatus } from './status.js';
import { collectUtterances } from '../voices.js';
import type { BootPayload, BootSuggestedNextOrPendingResponse } from './bootTypes.js';
import {
  deriveBootSuggestedNext,
  derivePendingBroadcastResponse,
  deriveVerbsAvailableNow,
  computeActiveOverlappingTargets,
  computeLastAuthoredWriteAt,
} from './bootActionable.js';
import { collectCrossPassage, renderBootText } from './bootRender.js';

// Re-exports for external consumers (suggest.ts + tests/boot.test.ts).
// The split moved these out of this file; the re-exports keep the
// historical import path working so we don't have to touch every
// downstream module (suggest.ts updated explicitly; boot.test.ts
// dynamic import updated explicitly; this re-export is the safety net
// for any third-party plugin reading them via the package surface).
export {
  deriveBootSuggestedNext,
  computeLastAuthoredWriteAt,
} from './bootActionable.js';
export type { BootSuggestedNext } from './bootTypes.js';

const BOOT_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'format',
  'tail',
  'utterances',
  'session-id',
  'since',
  'since-last-mine',
]);

// Strict ISO-8601 with milliseconds, UTC. Matches what Date.toISOString()
// emits and what the substrate stamps onto status_log / reviews /
// inbox / created_at. Stricter than Date.parse — we reject loose
// formats so the timestamp echoed back in payload.since is always
// directly comparable to the substrate's own timestamps.
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/**
 * gate boot [--format json|text] [--tail <N>] [--utterances <N>]
 *
 * GUILD_ACTOR is optional here (unlike `whoami`, which requires it):
 *   - with it set → personal dashboard (role, your recent utterances,
 *     your inbox, queues scoped to you).
 *   - without it → global snapshot (role=null, identity=null, no
 *     personal slices). Still valuable as a content-root health read.
 */
export async function bootCmd(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, BOOT_KNOWN_FLAGS, 'boot');
  maybeEmitExplain(args, 'boot');
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
  // --since <ISO-timestamp>: delta-filter for tail/your_recent/
  // inbox_unread. Reduces token cost across a long session — a returning
  // agent passes the previous boot's `last_activity` and gets only what
  // changed. last_activity itself is left intact so consumers can wire
  // the next boot's --since without round-tripping a separate read.
  //
  // --since-last-mine: sugar for "since my last authored write".
  // Resolves to computeLastAuthoredWriteAt(actor) AFTER actor +
  // allRequests are loaded (so the resolution lives further down).
  // The two flags are mutually exclusive — using both is a usage
  // error rather than a silent priority resolution.
  const sinceFlag = optionalOption(args, 'since');
  const sinceLastMine = args.options['since-last-mine'] === true;
  if (sinceFlag !== undefined && sinceLastMine) {
    throw new Error(
      `--since and --since-last-mine are mutually exclusive. ` +
        `next: pick one — --since-last-mine is sugar for "since my last ` +
        `authored write"; --since takes an explicit ISO timestamp.`,
    );
  }
  let since: string | null = null;
  if (sinceFlag !== undefined && sinceFlag.length > 0) {
    if (!ISO_TS_RE.test(sinceFlag)) {
      throw new Error(
        `--since "${sinceFlag}" must be ISO-8601 UTC (e.g. ` +
          `2026-05-14T01:02:03.456Z). next: pass the previous boot's ` +
          `last_activity verbatim, or any ISO timestamp the substrate ` +
          `would emit.`,
      );
    }
    since = sinceFlag;
  }

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

  // --since-last-mine resolution: now that actor + allRequests are
  // available, compute the actor's last authored write timestamp and
  // use it as the since cutoff. Requires actor — without one there's
  // no "mine" to anchor against.
  if (sinceLastMine) {
    if (!actor) {
      throw new Error(
        `--since-last-mine requires GUILD_ACTOR to be set ` +
          `(or pass --session-id with an actor-bearing context). ` +
          `next: export GUILD_ACTOR=<your-name>, or use --since <ISO-ts> ` +
          `if you want a global-view delta without anchoring to an actor.`,
      );
    }
    const lastMine = computeLastAuthoredWriteAt(actor, allRequests);
    if (lastMine !== null) {
      since = lastMine;
    }
    // lastMine === null means the actor has never authored any write.
    // We deliberately leave `since` as null — there's no meaningful
    // cutoff. Boot returns its full snapshot, which is the correct
    // first-time-here behavior.
  }

  // Enrich status with issues + inbox (mirrors statusCmd) so the
  // single payload is self-contained. Errors surface in `warnings[]`
  // (combo C3 / devil concern2 PR #105) — silent try/catch was the
  // pre-this-PR shape and let broken repos pass through invisibly.
  const warnings: string[] = [];
  try {
    const issues = await c.issueUC.listAll();
    status.open_issues = issues.filter(
      (i) => i.state === 'open' || i.state === 'in_progress',
    ).length;
  } catch (e) {
    warnings.push(
      `issues enrichment failed (open_issues count may be inaccurate): ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const inboxUnread: BootPayload['inbox_unread'] = [];
  // Skip inbox enrichment when the actor is a host — hosts do not
  // have inboxes by design (MessageUseCases.inbox throws with
  // "hosts do not have inboxes"). Before this guard, every boot
  // run by a host emitted a 7-line warning block recapping the
  // by-design no-inbox fact — principle 09 (orientation-disclosure:
  // surface surprising cases, stay quiet otherwise) inverted. The
  // host's role is already conveyed via the `role: 'host'` field;
  // suppressing the redundant warning is the orientation-clean
  // shape. role='unknown' still attempts inbox so the throw
  // produces a real warning for typo'd actor names.
  if (actor && role !== 'host') {
    try {
      const msgs = await c.messageUC.inbox(actor);
      const unread = msgs.filter((m) => !m.read);
      // status.inbox_unread reflects the TRUE unread count for
      // orientation accuracy — --since filters the surfaced entries
      // but the counter must not undercount or the agent will think
      // there's less waiting than there is. Filter the entries array
      // only; keep the scalar truthful.
      status.inbox_unread = unread.length;
      const visibleUnread = since !== null
        ? unread.filter((m) => m.at > since!)
        : unread;
      for (const m of visibleUnread) {
        inboxUnread.push({
          at: m.at,
          from: m.from,
          text: m.text,
          type: m.type,
          ...(m.expectsResponse === true ? { expects_response: true } : {}),
        });
      }
    } catch (e) {
      warnings.push(
        `inbox enrichment failed for actor=${actor} (inbox_unread may be inaccurate): ${e instanceof Error ? e.message : String(e)}`,
      );
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
    } catch (e) {
      warnings.push(
        `unresponded-concerns scan failed for actor=${actor} (unresponded count may be inaccurate): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // tail + personal utterances share one JSON projection of the
  // request corpus so collectUtterances isn't double-invoked on the
  // same data — it's O(N*status_log) and N grows with history.
  const allJson = allRequests.map((r) => r.toJSON() as unknown as Parameters<typeof collectUtterances>[0][number]);
  // When --since is set, collect first then filter by `at > since`.
  // We apply the limit AFTER the time filter so the limit governs the
  // returned delta window, not the pre-filter pool.
  let tail = collectUtterances(allJson, { limit: tailLimit, order: 'desc' });
  let yourRecent = actor
    ? collectUtterances(allJson, { name: actor, limit: personalLimit, order: 'desc' })
    : null;
  if (since !== null) {
    const cutoff = since;
    tail = collectUtterances(allJson, { order: 'desc' })
      .filter((u) => u.at > cutoff)
      .slice(0, tailLimit);
    if (yourRecent !== null) {
      yourRecent = collectUtterances(allJson, { name: actor!, order: 'desc' })
        .filter((u) => u.at > cutoff)
        .slice(0, personalLimit);
    }
  }

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
  } catch (e) {
    warnings.push(
      `content_root health probe failed (malformed_count may be inaccurate): ${e instanceof Error ? e.message : String(e)}`,
    );
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

  // past_cliffs (#37x): forward-pointing close notes the actor (or one
  // of their wave executors) left on completed requests. Read-only
  // surface — boot lists, the reader chooses what to follow up on.
  // Scope: authored OR executed by the actor. The cliff is on the
  // terminal status_log entry; the closing actor is the entry's `by`.
  // Cap at 5 newest by closed_at to keep boot lean per principle 13.
  let pastCliffs: BootPayload['past_cliffs'] = null;
  if (actor) {
    const lower = actor.toLowerCase();
    const entries: Array<{
      id: string;
      action: string;
      cliff: string;
      closed_by: string;
      closed_at: string;
    }> = [];
    for (const r of allRequests) {
      if (r.state !== 'completed') continue;
      const last = r.statusLog[r.statusLog.length - 1];
      if (!last || last.cliff === undefined) continue;
      const wasMine =
        r.from.value === lower ||
        r.hasExecutor(lower);
      if (!wasMine) continue;
      entries.push({
        id: r.id.value,
        action: r.action,
        cliff: last.cliff,
        closed_by: last.by,
        closed_at: last.at,
      });
    }
    entries.sort((a, b) => (a.closed_at < b.closed_at ? 1 : -1));
    // Honour --since for past_cliffs too: the delta-filter semantic
    // applies — a returning agent only cares about cliffs closed
    // after their last boot.
    const filtered = since !== null
      ? entries.filter((e) => e.closed_at > since!)
      : entries;
    pastCliffs = filtered.slice(0, 5);
  }

  // Lore stats: count principles + traps shipped with this package.
  // Cheap (one fs scan, already cached by FsLoreRepository) and lets
  // the boot text surface a one-line discoverability hint for the
  // `gate lore` verb. Unavailable lore (unusual install state) reads
  // as zeros + available=false so consumers can branch.
  const loreStats = c.loreUC.available
    ? {
        available: true,
        principles: c.loreUC.list({ type: 'principle' }).length,
        traps: c.loreUC.list({ type: 'trap' }).length,
      }
    : { available: false, principles: 0, traps: 0 };

  const sessionIdUnset = actor !== null && sessionId === null;

  const payload: BootPayload = {
    actor,
    role,
    session_id: sessionId,
    session_id_source: sessionIdSource,
    since,
    status,
    tail,
    your_recent: yourRecent,
    inbox_unread: inboxUnread,
    last_activity: status.last_activity,
    warnings,
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
    past_cliffs: pastCliffs,
    verbs_available_now: verbsAvailableNow,
    lore_stats: loreStats,
  };

  if (format === 'json') {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    process.stdout.write(renderBootText(payload, c.config.profile, c.voicePlugins, c.config));
  }
  return 0;
}
