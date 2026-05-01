/**
 * Pure helpers for `gate voices <name>`. Kept separate from the CLI
 * entry point so the gather/filter/sort logic is unit-testable without
 * a live filesystem.
 *
 * Also home to `computeVoiceCalibration` (see bottom of file), which
 * derives a per-(actor, lense) calibration score from historical
 * review verdicts vs terminal-state outcomes. Exported from here so
 * the CLI handler and the schema can reuse the same definition.
 *
 * An "utterance" is anything a named actor put on the record:
 *   - `authored`: a request they filed (action + reason + the
 *     appropriate closure note — completion_note / deny_reason /
 *     failure_reason, whichever the lifecycle produced).
 *   - `review`: a review they recorded on someone's (or their own)
 *     request, carrying the lense / verdict / comment.
 *
 * The RequestJSON type below intentionally models only the fields
 * voices reads. Keeping it structural (rather than importing Request
 * from domain) lets tests feed plain objects instead of going through
 * the full domain constructor chain.
 */

/**
 * Structural projection of what voices reads off a Request. The
 * optional `status_log` lets collectUtterances surface the creator's
 * `invoked_by` on AuthoredUtterance — the actual field lives on
 * status_log[0] (the "created" entry), and we don't want to hoist
 * it to a flat top-level key because the derivation is already
 * first-class in the on-disk YAML.
 */
export type StatusLogEntryJSON = {
  readonly state: string;
  readonly by: string;
  readonly at: string;
  readonly note?: string;
  readonly invoked_by?: string;
};

export type RequestJSON = {
  readonly id: string;
  readonly from: string;
  readonly action: string;
  readonly reason: string;
  readonly state?: string;
  readonly created_at: string;
  readonly completion_note?: string;
  readonly deny_reason?: string;
  readonly failure_reason?: string;
  readonly with?: ReadonlyArray<string>;
  readonly reviews?: ReadonlyArray<ReviewJSON>;
  readonly thanks?: ReadonlyArray<ThankJSON>;
  readonly status_log?: ReadonlyArray<StatusLogEntryJSON>;
  // Tool-generated structured link to the source issue when this
  // request came from `gate issues promote`. Used by chain as a
  // text-independent forward/inbound ref path.
  readonly promoted_from?: string;
};

export type ReviewJSON = {
  readonly by: string;
  readonly lense: string;
  readonly verdict: string;
  readonly comment: string;
  readonly at: string;
  // Actual invoker when different from `by`. Persisted by Review.toJSON
  // in snake_case; voices surfaces it so a reviewer who ghost-wrote
  // through an AI agent is visible in tail / whoami / voices instead
  // of only in `gate show <id>`.
  readonly invoked_by?: string;
};

/**
 * Structural projection of Thank's toJSON() — just what voices reads.
 * Optional on RequestJSON because records written before the thank
 * verb existed simply lack the field.
 */
export type ThankJSON = {
  readonly by: string;
  readonly to: string;
  readonly at: string;
  readonly reason?: string;
  readonly invoked_by?: string;
};

export type AuthoredUtterance = {
  readonly kind: 'authored';
  readonly at: string;
  readonly requestId: string;
  // Who authored the containing request. Useful when tail streams
  // utterances from every actor and the reader needs to see who said
  // what without looking up the id.
  readonly from: string;
  // Actual CLI invoker when the creation was proxied (GUILD_ACTOR
  // differed from --from). Same semantic as ReviewUtterance.invokedBy;
  // the source is the `invoked_by` field on the status_log[0] entry.
  // Undefined for the self-invocation common case.
  readonly invokedBy?: string;
  readonly action: string;
  readonly reason: string;
  // Any closure text the lifecycle ended on. Only one of these is
  // populated for a given request: completed → completionNote,
  // denied → denyReason, failed → failureReason.
  readonly completionNote?: string;
  readonly denyReason?: string;
  readonly failureReason?: string;
  // Pair-mode Layer 1: dialogue partners during formation (empty if
  // solo). Surfaced on the utterance so readers of voices / tail /
  // resume see "with whom" without fetching the raw request.
  readonly with?: ReadonlyArray<string>;
};

export type ReviewUtterance = {
  readonly kind: 'review';
  readonly at: string;
  readonly requestId: string;
  // Who wrote the review. Same rationale as AuthoredUtterance.from.
  readonly by: string;
  // Actual CLI invoker when different from `by` (typically an AI
  // agent acting on the member's behalf). Undefined when they agree.
  readonly invokedBy?: string;
  // The action of the containing request, so the reader has context
  // for what the review was *about* without chasing the id.
  readonly action: string;
  readonly lense: string;
  readonly verdict: string;
  readonly comment: string;
};

/**
 * A `thank` utterance — someone thanking another actor for their
 * work on a specific request. Sibling of ReviewUtterance; simpler
 * (no lense, no verdict, no required comment) because the record
 * semantics are different. Reviews express judgement; thanks
 * express gratitude.
 *
 * Both `by` and `to` flow through so tail / voices readers see the
 * directional relationship without fetching the raw request.
 */
export type ThankUtterance = {
  readonly kind: 'thank';
  readonly at: string;
  readonly requestId: string;
  readonly by: string;
  readonly to: string;
  readonly invokedBy?: string;
  // Action of the containing request for context, same rationale as
  // ReviewUtterance.action.
  readonly action: string;
  // Optional prose; thanks without a reason are legitimate.
  readonly reason?: string;
};

export type Utterance = AuthoredUtterance | ReviewUtterance | ThankUtterance;

export interface VoicesFilter {
  // When omitted, match every actor. Used by `gate tail` to stream
  // the unified dialogue across the content_root.
  readonly name?: string;
  readonly lense?: string;
  readonly verdict?: string;
  // Limit the returned utterance count after sorting. Combined with
  // `order: 'desc'` this gives "the most recent N utterances".
  readonly limit?: number;
  // Sort direction for timestamps. Default 'asc' (oldest first) to
  // preserve the existing voices semantics; 'desc' is what tail wants.
  readonly order?: 'asc' | 'desc';
}

/**
 * Collect every utterance matching `filter` across the given requests,
 * sorted chronologically.
 *
 * When `filter.name` is set, only that actor's utterances are
 * returned; when omitted, every actor's utterances flow through.
 * When `lense` or `verdict` is set, only review utterances are
 * returned — authored requests don't carry those fields, so including
 * them in a lense-scoped query would be a category error.
 *
 * Name matching is case-insensitive. Timestamps are compared as
 * strings; ISO-8601 sorts correctly lexicographically.
 */
export function collectUtterances(
  requests: ReadonlyArray<RequestJSON>,
  filter: VoicesFilter,
): Utterance[] {
  const needle = filter.name?.toLowerCase();
  const reviewOnly =
    filter.lense !== undefined || filter.verdict !== undefined;
  const out: Utterance[] = [];

  for (const r of requests) {
    if (
      !reviewOnly &&
      (needle === undefined || r.from.toLowerCase() === needle)
    ) {
      const u: AuthoredUtterance = {
        kind: 'authored',
        at: r.created_at,
        requestId: r.id,
        from: r.from,
        action: r.action,
        reason: r.reason,
      };
      // Creator's invoked_by lives on status_log[0] (the "created"
      // entry). Lift it onto the utterance so tail / voices / resume
      // surface proxy-authoring the same way they already surface
      // proxy-reviews. Guarded so pre-invoked_by records stay clean.
      const createdEntry = r.status_log?.[0];
      if (createdEntry && createdEntry.invoked_by !== undefined) {
        (u as { invokedBy?: string }).invokedBy = createdEntry.invoked_by;
      }
      // Pick whichever closure field the lifecycle produced. A request
      // can only be in one terminal state at a time, so at most one of
      // these is set.
      if (r.completion_note) {
        (u as { completionNote?: string }).completionNote = r.completion_note;
      }
      if (r.deny_reason) {
        (u as { denyReason?: string }).denyReason = r.deny_reason;
      }
      if (r.failure_reason) {
        (u as { failureReason?: string }).failureReason = r.failure_reason;
      }
      if (r.with && r.with.length > 0) {
        (u as { with?: ReadonlyArray<string> }).with = r.with;
      }
      out.push(u);
    }
    const reviews = r.reviews ?? [];
    for (const rv of reviews) {
      if (needle !== undefined && rv.by.toLowerCase() !== needle) continue;
      if (filter.lense !== undefined && rv.lense !== filter.lense) continue;
      if (filter.verdict !== undefined && rv.verdict !== filter.verdict) {
        continue;
      }
      const reviewUtterance: ReviewUtterance = {
        kind: 'review',
        at: rv.at,
        requestId: r.id,
        action: r.action,
        by: rv.by,
        lense: rv.lense,
        verdict: rv.verdict,
        comment: rv.comment,
      };
      if (rv.invoked_by !== undefined) {
        (reviewUtterance as { invokedBy?: string }).invokedBy = rv.invoked_by;
      }
      out.push(reviewUtterance);
    }
    // Thank utterances: emitted for both the `by` actor (who gave)
    // and the `to` actor (who received) — either name-filter match
    // surfaces the record. Reviews are one-sided (only `by` speaks),
    // so this is the one place the filter diverges. Lens/verdict
    // filters short-circuit the thanks loop entirely — thanks have
    // no lense/verdict, so a lense-scoped query should not carry them.
    const filteringReviewsOnly =
      filter.lense !== undefined || filter.verdict !== undefined;
    if (!filteringReviewsOnly) {
      const thanks = r.thanks ?? [];
      for (const th of thanks) {
        const byMatches = needle === undefined || th.by.toLowerCase() === needle;
        const toMatches = needle === undefined || th.to.toLowerCase() === needle;
        if (!byMatches && !toMatches) continue;
        const thankUtterance: ThankUtterance = {
          kind: 'thank',
          at: th.at,
          requestId: r.id,
          action: r.action,
          by: th.by,
          to: th.to,
        };
        if (th.reason !== undefined) {
          (thankUtterance as { reason?: string }).reason = th.reason;
        }
        if (th.invoked_by !== undefined) {
          (thankUtterance as { invokedBy?: string }).invokedBy = th.invoked_by;
        }
        out.push(thankUtterance);
      }
    }
  }

  const direction = filter.order ?? 'asc';
  out.sort((a, b) =>
    direction === 'asc'
      ? a.at.localeCompare(b.at)
      : b.at.localeCompare(a.at),
  );
  if (filter.limit !== undefined && filter.limit >= 0) {
    return out.slice(0, filter.limit);
  }
  return out;
}

/**
 * Push a single `label: value` field where `value` may contain
 * newlines, aligning continuation lines with the start of the
 * value column so the output reads as one structured field rather
 * than a field with a stray paragraph hanging off the left margin.
 *
 * `labelWithPadding` is the full prefix including leading indent
 * and trailing space padding (e.g. `"  action:   "`). Continuation
 * lines receive the same width in spaces. Single-line values are
 * a no-op so existing single-line rendering stays byte-identical.
 *
 * Shared between `gate show --format text` and `gate voices` /
 * `gate tail` renderers so multi-line reasons read the same way
 * everywhere.
 */
export function pushMultilineField(
  lines: string[],
  labelWithPadding: string,
  body: string,
): void {
  const parts = body.split('\n');
  const head = parts[0] ?? '';
  lines.push(labelWithPadding + head);
  if (parts.length === 1) return;
  const continuationIndent = ' '.repeat(labelWithPadding.length);
  for (let i = 1; i < parts.length; i++) {
    lines.push(continuationIndent + parts[i]);
  }
}

/**
 * Render a chronological delta between two ISO-8601 timestamps in a
 * compact human-readable form. Returns an empty string if the inputs
 * are unparseable or if `curr` precedes `prev` (which shouldn't happen
 * in well-ordered logs, but we're defensive at the boundary).
 *
 * Examples: "+6s", "+3m", "+1h19m", "+2d4h".
 *
 * Exported for unit tests and for reuse in gate show / tail renderers.
 */
export function formatDelta(prevIso: string, currIso: string): string {
  const prev = Date.parse(prevIso);
  const curr = Date.parse(currIso);
  if (Number.isNaN(prev) || Number.isNaN(curr)) return '';
  const deltaMs = curr - prev;
  if (deltaMs < 0) return '';
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return `+${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `+${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remMin = minutes % 60;
    return remMin === 0 ? `+${hours}h` : `+${hours}h${remMin}m`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours === 0 ? `+${days}d` : `+${days}d${remHours}h`;
}

/**
 * Render a single utterance as multi-line text, matching the
 * vocabulary of `gate show --format text`. Shared between voices,
 * tail, and whoami so the reader's eye learns one shape.
 *
 * The `includeActor` flag controls whether the first line labels
 * the actor explicitly — voices already groups by actor so it's
 * redundant there, but tail and whoami span actors.
 */
export function renderUtterance(
  u: Utterance,
  includeActor: boolean,
): string {
  const lines: string[] = [];
  if (u.kind === 'authored') {
    const actor = includeActor ? ` ${u.from}` : '';
    const withSuffix =
      u.with && u.with.length > 0 ? ` (with ${u.with.join(', ')})` : '';
    // Always show `[invoked_by=<actor>]` when present, even when
    // includeActor=false (voices groups by actor so `from` is
    // redundant, but the proxy invoker isn't). Matches the review
    // branch's treatment.
    const proxy = u.invokedBy ? ` [invoked_by=${u.invokedBy}]` : '';
    lines.push(`[${u.at}] req=${u.requestId} authored${actor}${proxy}${withSuffix}`);
    pushMultilineField(lines, '  action: ', u.action);
    pushMultilineField(lines, '  reason: ', u.reason);
    // At most one of these is set per request (completed / denied /
    // failed are mutually exclusive terminal states).
    if (u.completionNote) pushMultilineField(lines, '  note:   ', u.completionNote);
    if (u.denyReason) pushMultilineField(lines, '  denied: ', u.denyReason);
    if (u.failureReason) pushMultilineField(lines, '  failed: ', u.failureReason);
  } else if (u.kind === 'review') {
    // Always expose `invoked_by` when present, even when includeActor
    // is false (voices groups by actor, so the `by` is redundant —
    // but the proxy-invoker isn't). Keeps the stream honest about
    // who actually ran the command vs who the act is attributed to.
    const actor = includeActor ? ` by ${u.by}` : '';
    const proxy = u.invokedBy ? ` [invoked_by=${u.invokedBy}]` : '';
    lines.push(
      `[${u.at}] req=${u.requestId} [${u.lense}/${u.verdict}]${actor}${proxy}`,
    );
    lines.push(`  re: ${u.action}`);
    for (const line of u.comment.split('\n')) {
      lines.push(`  ${line}`);
    }
  } else {
    // u.kind === 'thank'. `by` thanked `to` on this request. Always
    // render as full "by → to" direction regardless of `includeActor`:
    // unlike reviews (where `by` is the only relevant actor), thanks
    // have a giver AND a receiver, and both are load-bearing. Hiding
    // `by` when voices groups by one of them would leave the reader
    // asking "thanked by whom?" on every line.
    const proxy = u.invokedBy ? ` [invoked_by=${u.invokedBy}]` : '';
    lines.push(
      `[${u.at}] req=${u.requestId} thank ${u.by} → ${u.to}${proxy}`,
    );
    lines.push(`  re: ${u.action}`);
    if (u.reason !== undefined) {
      for (const line of u.reason.split('\n')) {
        lines.push(`  ${line}`);
      }
    }
  }
  return lines.join('\n');
}

// ── Voice calibration ─────────────────────────────────────────────
//
// A per-(actor, lense) score derived from historical review verdicts
// vs terminal-state outcomes. Exists to let the Two-Persona Devil
// Review frame *learn* — today every cross-actor critique weighs the
// same, and over time the system has no memory of which voices
// called it right.
//
// The mechanism is deliberately quiet:
//   - Scores are visible on `gate voices <OTHER>` but hidden on
//     `gate voices $GUILD_ACTOR` (so voters don't self-optimise).
//   - No leaderboard, no aggregate ranking — each voice stands
//     alone.
//   - Small samples render as "uncalibrated" to avoid mistaking
//     noise for signal.
//   - Reasons are named in plain prose, not numeric badges.
//
// Alignment rules (v1; may refine once we have real signal):
//   verdict=ok       + state=completed → aligned (you said fine, it was)
//   verdict=ok       + state=failed    → missed   (you said fine, it wasn't)
//   verdict=concern  + state=failed    → aligned (you flagged it, it broke)
//   verdict=concern  + state=completed → soft    (issues may have been
//                                                 absorbed; neither a
//                                                 win nor a miss)
//   verdict=reject   + state=failed    → aligned (you said no, it broke)
//   verdict=reject   + state=completed → overruled (you said no, it
//                                                   shipped anyway;
//                                                   ambiguous signal —
//                                                   could be wrong call,
//                                                   could be reviewed
//                                                   risk that held)
//
// Denied requests don't contribute (they never executed; no outcome
// to compare against). `concern + completed` is counted as soft —
// neither a hit nor a miss — because the outcome is consistent with
// both "the concern was noted and addressed" and "the concern was
// overblown". Counting it either way would bias the score.

export interface CalibrationPerLens {
  /** Samples that contributed (aligned + missed; soft/overruled excluded). */
  readonly sample_count: number;
  /** Verdicts that matched outcome (aligned). */
  readonly aligned: number;
  /** Verdicts that missed (ok on a failed, or reject on a completed — see above). */
  readonly missed: number;
  /** Numeric 0..1 score, aligned / sample_count. Null when uncalibrated. */
  readonly alignment: number | null;
  /** Categorical signal for prose use. "uncalibrated" when samples < threshold. */
  readonly status: 'uncalibrated' | 'learning' | 'trusted';
  /** One-line prose for human/agent consumers. */
  readonly prose: string;
}

export interface VoiceCalibration {
  readonly actor: string;
  /** Per-lense calibration, keyed by lense name (e.g. "devil", "layer"). */
  readonly by_lens: Record<string, CalibrationPerLens>;
}

const CALIBRATION_MIN_SAMPLES = 5;
const CALIBRATION_TRUSTED_THRESHOLD = 0.7;

export function computeVoiceCalibration(
  all: ReadonlyArray<RequestJSON>,
  actor: string,
): VoiceCalibration {
  const actorLower = actor.toLowerCase();
  const byLense: Record<string, { aligned: number; missed: number }> = {};

  for (const r of all) {
    const state = r.state;
    // Only terminal non-denied outcomes yield signal. `denied`
    // requests never ran, so there's nothing to calibrate against.
    if (state !== 'completed' && state !== 'failed') continue;
    const reviews = r.reviews ?? [];
    for (const rv of reviews) {
      if (rv.by !== actorLower) continue;
      const lense = rv.lense;
      if (!byLense[lense]) byLense[lense] = { aligned: 0, missed: 0 };
      const bucket = byLense[lense]!;
      const v = rv.verdict;
      if (v === 'ok') {
        if (state === 'completed') bucket.aligned += 1;
        else bucket.missed += 1;
      } else if (v === 'reject') {
        if (state === 'failed') bucket.aligned += 1;
        else bucket.missed += 1;
      }
      // verdict === 'concern' intentionally excluded — see header.
    }
  }

  const out: Record<string, CalibrationPerLens> = {};
  for (const [lense, counts] of Object.entries(byLense)) {
    const samples = counts.aligned + counts.missed;
    if (samples < CALIBRATION_MIN_SAMPLES) {
      out[lense] = {
        sample_count: samples,
        aligned: counts.aligned,
        missed: counts.missed,
        alignment: null,
        status: 'uncalibrated',
        prose:
          `${lense} lense: ${samples} sample${samples === 1 ? '' : 's'} so far — not yet calibrated ` +
          `(need ${CALIBRATION_MIN_SAMPLES - samples} more with a terminal outcome).`,
      };
      continue;
    }
    const alignment = counts.aligned / samples;
    const status: CalibrationPerLens['status'] =
      alignment >= CALIBRATION_TRUSTED_THRESHOLD ? 'trusted' : 'learning';
    const proseFragment =
      status === 'trusted'
        ? `trusted — ${counts.aligned} of ${samples} verdicts aligned with outcomes`
        : `still learning — ${counts.aligned} of ${samples} verdicts aligned`;
    out[lense] = {
      sample_count: samples,
      aligned: counts.aligned,
      missed: counts.missed,
      alignment,
      status,
      prose: `${lense} lense: ${proseFragment}.`,
    };
  }

  return { actor: actorLower, by_lens: out };
}
