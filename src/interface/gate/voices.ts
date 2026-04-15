/**
 * Pure helpers for `gate voices <name>`. Kept separate from the CLI
 * entry point so the gather/filter/sort logic is unit-testable without
 * a live filesystem.
 *
 * An "utterance" is anything a named actor put on the record:
 *   - `authored`: a request they filed (action + reason + the
 *     appropriate closure note — completion_note / deny_reason /
 *     failure_reason, whichever the lifecycle produced).
 *   - `review`: a review they recorded on someone's (or their own)
 *     request, carrying the lens / verdict / comment.
 *
 * The RequestJSON type below intentionally models only the fields
 * voices reads. Keeping it structural (rather than importing Request
 * from domain) lets tests feed plain objects instead of going through
 * the full domain constructor chain.
 */

export type RequestJSON = {
  readonly id: string;
  readonly from: string;
  readonly action: string;
  readonly reason: string;
  readonly created_at: string;
  readonly completion_note?: string;
  readonly deny_reason?: string;
  readonly failure_reason?: string;
  readonly reviews?: ReadonlyArray<ReviewJSON>;
};

export type ReviewJSON = {
  readonly by: string;
  readonly lense: string;
  readonly verdict: string;
  readonly comment: string;
  readonly at: string;
};

export type AuthoredUtterance = {
  readonly kind: 'authored';
  readonly at: string;
  readonly requestId: string;
  // Who authored the containing request. Useful when tail streams
  // utterances from every actor and the reader needs to see who said
  // what without looking up the id.
  readonly from: string;
  readonly action: string;
  readonly reason: string;
  // Any closure text the lifecycle ended on. Only one of these is
  // populated for a given request: completed → completionNote,
  // denied → denyReason, failed → failureReason.
  readonly completionNote?: string;
  readonly denyReason?: string;
  readonly failureReason?: string;
};

export type ReviewUtterance = {
  readonly kind: 'review';
  readonly at: string;
  readonly requestId: string;
  // Who wrote the review. Same rationale as AuthoredUtterance.from.
  readonly by: string;
  // The action of the containing request, so the reader has context
  // for what the review was *about* without chasing the id.
  readonly action: string;
  readonly lense: string;
  readonly verdict: string;
  readonly comment: string;
};

export type Utterance = AuthoredUtterance | ReviewUtterance;

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
 * them in a lens-scoped query would be a category error.
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
      out.push(u);
    }
    const reviews = r.reviews ?? [];
    for (const rv of reviews) {
      if (needle !== undefined && rv.by.toLowerCase() !== needle) continue;
      if (filter.lense !== undefined && rv.lense !== filter.lense) continue;
      if (filter.verdict !== undefined && rv.verdict !== filter.verdict) {
        continue;
      }
      out.push({
        kind: 'review',
        at: rv.at,
        requestId: r.id,
        action: r.action,
        by: rv.by,
        lense: rv.lense,
        verdict: rv.verdict,
        comment: rv.comment,
      });
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
    lines.push(`[${u.at}] req=${u.requestId} authored${actor}`);
    lines.push(`  action: ${u.action}`);
    lines.push(`  reason: ${u.reason}`);
    // At most one of these is set per request (completed / denied /
    // failed are mutually exclusive terminal states).
    if (u.completionNote) lines.push(`  note:   ${u.completionNote}`);
    if (u.denyReason) lines.push(`  denied: ${u.denyReason}`);
    if (u.failureReason) lines.push(`  failed: ${u.failureReason}`);
  } else {
    const actor = includeActor ? ` by ${u.by}` : '';
    lines.push(
      `[${u.at}] req=${u.requestId} [${u.lense}/${u.verdict}]${actor}`,
    );
    lines.push(`  re: ${u.action}`);
    for (const line of u.comment.split('\n')) {
      lines.push(`  ${line}`);
    }
  }
  return lines.join('\n');
}
