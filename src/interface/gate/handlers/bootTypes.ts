// boot payload shapes — types only, no runtime code.
//
// Extracted from boot.ts during the 2026-05-13 split (#3xx) so the
// derivation logic (bootActionable.ts) and the text renderer
// (bootRender.ts) can share the contract without pulling each other.
// Keeping types in a leaf module avoids the circular-import risk that
// would otherwise emerge from "boot.ts holds bootCmd that needs
// derivation that needs the payload shape that lives in boot.ts."

import type { Request } from '../../../domain/request/Request.js';
import type { StatusSummary } from './status.js';
import type { collectUtterances } from '../voices.js';
import type { PassageOrientationSummary } from '../../shared/PassageOrientation.js';

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
    /**
     * The session_id under which this request was authored (#249
     * slice 4). Carried verbatim from the record's
     * `opened_by_session` field. Surfaced inside the overlap
     * payload so the reader can spot the self-race shape: one
     * member with multiple overlapping records authored from
     * different sessions. Omitted when the record has no session
     * stamp — pre-#249 records and unstamped post-#249 writes both
     * present absence as the signal-free case.
     */
    opened_by_session?: string;
  }>;
  /**
   * Members in this overlap group who authored ≥2 requests from
   * ≥2 distinct sessions (#249 slice 4). Map keys are member names
   * (lowercase, canonical); values are the distinct session_ids
   * the member authored from inside this group, in first-mention
   * order. Empty / omitted when no member's authorship splits
   * across sessions.
   *
   * The "self-race" surface: an actor running two shells (or two
   * AI agents on the same machine) may legitimately not realize
   * they have overlapping work in flight under their own name.
   * This map names exactly that case so the boot text rendering
   * can prompt: "you have parallel sessions on the same target —
   * was the second one intended?".
   *
   * Detection requires that ≥2 of the actor's records in the
   * group carry an `opened_by_session` AND those values diverge.
   * A pre-#249 record with no session stamp does NOT count toward
   * the divergence (we cannot know what session it came from); a
   * post-#249 unstamped record (caller didn't `export
   * GUILD_SESSION_ID`) similarly does not. Detection is best-
   * effort: it surfaces the case the substrate can prove, not
   * every possible parallel-shell scenario.
   */
  parallel_session_authors?: Record<string, readonly string[]>;
}

/**
 * gate boot [--format json|text] [--tail <N>] [--utterances <N>]
 *
 * Single-command session orientation for agents. Composes the
 * information previously returned by `gate whoami` + `gate status` +
 * `gate tail` + `gate inbox --unread` into one JSON so an autonomous
 * agent can acquire full context with a single tool call on startup.
 *
 * The JSON shape is stable across 0.x patch releases — agents can
 * depend on it. New fields may be ADDED but existing ones won't be
 * renamed or removed without a minor-version bump.
 */
export interface BootPayload {
  actor: string | null;
  role: 'member' | 'host' | 'unknown' | null;
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
    expects_response?: boolean;
  }>;
  last_activity: string | null;
  warnings: string[];
  hints: {
    session_id_unset: boolean;
    misconfigured_cwd: boolean;
    cwd_outside_content_root: boolean;
    config_file: string | null;
    resolved_content_root: string;
    content_root_health: {
      malformed_count: number;
      areas: Array<{ area: string; malformed: number; total: number }>;
      fix_hint: string | null;
    };
  };
  cross_passage: Record<string, PassageOrientationSummary>;
  active_overlapping_targets: ReadonlyArray<BootActiveOverlap>;
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
  suggested_next: BootSuggestedNextOrPendingResponse | null;
  lore_stats: {
    available: boolean;
    principles: number;
    traps: number;
  };
}

/**
 * Internal kind enum for `actionableTransitions`. Exported so
 * bootActionable can reference it from outside as well.
 */
export type ActionableKind =
  | 'executing-mine'
  | 'unreviewed-mine'
  | 'approved-for-me'
  | 'pending-as-executor'
  | 'reviewed-authored';

export interface ActionableTransition {
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
