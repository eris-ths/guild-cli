/**
 * Helpers for `gate chain <id>`.
 *
 * The "chain" is a one-hop neighborhood graph around a root record:
 * given a request or issue id, find every other request or issue it
 * mentions in its free-text fields (action, reason, closure notes,
 * review comments, issue text).
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

export function gatherIssueText(i: { text: string }): string {
  return i.text;
}
