/**
 * Pure helpers for `gate chain <id>`. Separated from the CLI entry
 * point so the reference-extraction logic is unit-testable without
 * filesystem I/O.
 *
 * The "chain" is a one-hop neighborhood graph around a root record:
 * given a request or issue id, find every other request or issue it
 * mentions in its free-text fields (action, reason, closure notes,
 * review comments, issue text). This lets a reader walk the narrative
 * of how a piece of work relates to others — promoted issues, cited
 * prior requests, cross-referenced audits — without grepping YAML.
 *
 * References are found by regex against the well-known id formats:
 *   requests: YYYY-MM-DD-NNN        (e.g. 2026-04-14-014)
 *   issues:   i-YYYY-MM-DD-NNN      (e.g. i-2026-04-14-003)
 *
 * Matching is lexical only — we do not chase ambiguous prose.
 * A prose string that happens to look like an id will be followed;
 * this is acceptable because YYYY-MM-DD-NNN is distinctive enough
 * that false positives are rare.
 */

/**
 * Match either form. We scan once with a combined regex and then
 * disambiguate based on whether the match starts with "i-" so we
 * don't double-count requests that happen to share a suffix with an
 * issue id.
 */
// \d{3,4} accepts both legacy (0.1.x) 3-digit and current 4-digit
// sequence suffixes. The trailing (?!\d) forbids longer digit runs
// so "2026-04-15-00123" (5+ digits) is not partially matched.
const ID_PATTERN = /(?<!\w)(i-)?(\d{4}-\d{2}-\d{2}-\d{3,4})(?!\d)/g;

export interface ExtractedReferences {
  readonly requestIds: ReadonlyArray<string>;
  readonly issueIds: ReadonlyArray<string>;
}

/**
 * Scan a free-text string for request and issue ids. Returns the
 * unique set of each, in first-seen order. Order is stable because
 * duplicate renders are noisy to readers scanning the output.
 */
export function extractReferences(text: string): ExtractedReferences {
  const requestIds = new Set<string>();
  const issueIds = new Set<string>();
  const requestOrder: string[] = [];
  const issueOrder: string[] = [];

  if (typeof text !== 'string' || text.length === 0) {
    return { requestIds: [], issueIds: [] };
  }

  // Reset lastIndex on global regex between calls — otherwise the
  // previous match position leaks across invocations when the same
  // regex literal is reused.
  ID_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ID_PATTERN.exec(text)) !== null) {
    const hasIssuePrefix = match[1] === 'i-';
    const core = match[2]!;
    if (hasIssuePrefix) {
      const id = `i-${core}`;
      if (!issueIds.has(id)) {
        issueIds.add(id);
        issueOrder.push(id);
      }
    } else {
      if (!requestIds.has(core)) {
        requestIds.add(core);
        requestOrder.push(core);
      }
    }
  }
  return { requestIds: requestOrder, issueIds: issueOrder };
}

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
