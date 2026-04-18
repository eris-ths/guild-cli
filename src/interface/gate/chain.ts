/**
 * Helpers for `gate chain <id>`.
 *
 * The "chain" is a one-hop neighborhood graph around a root record,
 * walked in both directions:
 *
 *   forward  — ids the root mentions in its own free-text fields
 *              (request: action / reason / closure notes / review
 *              comments; issue: text + per-note bodies).
 *   inbound  — records elsewhere that mention the root id. Computed
 *              in the handler (reqChain) by scanning every other
 *              record's text with the same helpers below.
 *
 * The id-scanner itself (`extractReferences`) lives in
 * `domain/shared/extractReferences.ts` — it is reused by the
 * `UnrespondedConcernsQuery` read model. This file holds the
 * request/issue text-gathering helpers that are coupled to the
 * interface-layer JSON shape (legacy closure keys).
 */

export {
  extractReferences,
  type ExtractedReferences,
} from '../../domain/shared/extractReferences.js';

/**
 * Collect every piece of searchable free text belonging to a request,
 * so extractReferences can see cross-references buried in reviews
 * and closure notes as well as the action/reason headers.
 */
export function gatherRequestText(r: {
  action: string;
  reason: string;
  completion_note?: string;
  deny_reason?: string;
  failure_reason?: string;
  reviews?: ReadonlyArray<{ comment: string }>;
}): string {
  const parts: string[] = [r.action, r.reason];
  if (r.completion_note) parts.push(r.completion_note);
  if (r.deny_reason) parts.push(r.deny_reason);
  if (r.failure_reason) parts.push(r.failure_reason);
  if (r.reviews) {
    for (const rv of r.reviews) parts.push(rv.comment);
  }
  return parts.join('\n');
}

/**
 * Same treatment for issues: their notes (the #38 append-only
 * annotations) can reference other records too. Without pulling
 * note text into the scan, a cross-reference added post-hoc as
 * "see i-..." would be invisible to `gate chain`, even though
 * show/list render it.
 */
export function gatherIssueText(i: {
  text: string;
  notes?: ReadonlyArray<{ text: string }>;
}): string {
  const parts: string[] = [i.text];
  if (i.notes) {
    for (const n of i.notes) parts.push(n.text);
  }
  return parts.join('\n');
}
