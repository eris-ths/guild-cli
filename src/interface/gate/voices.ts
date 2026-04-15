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
  // The action of the containing request, so the reader has context
  // for what the review was *about* without chasing the id.
  readonly action: string;
  readonly lense: string;
  readonly verdict: string;
  readonly comment: string;
};

export type Utterance = AuthoredUtterance | ReviewUtterance;

export interface VoicesFilter {
  readonly name: string;
  readonly lense?: string;
  readonly verdict?: string;
}

/**
 * Collect every utterance by `filter.name` across the given requests,
 * sorted chronologically ascending.
 *
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
  const needle = filter.name.toLowerCase();
  const reviewOnly =
    filter.lense !== undefined || filter.verdict !== undefined;
  const out: Utterance[] = [];

  for (const r of requests) {
    if (!reviewOnly && r.from.toLowerCase() === needle) {
      const u: AuthoredUtterance = {
        kind: 'authored',
        at: r.created_at,
        requestId: r.id,
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
      if (rv.by.toLowerCase() !== needle) continue;
      if (filter.lense !== undefined && rv.lense !== filter.lense) continue;
      if (filter.verdict !== undefined && rv.verdict !== filter.verdict) {
        continue;
      }
      out.push({
        kind: 'review',
        at: rv.at,
        requestId: r.id,
        action: r.action,
        lense: rv.lense,
        verdict: rv.verdict,
        comment: rv.comment,
      });
    }
  }

  out.sort((a, b) => a.at.localeCompare(b.at));
  return out;
}
