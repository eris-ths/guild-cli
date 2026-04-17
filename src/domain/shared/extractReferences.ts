// Pure id-scanner for request / issue references embedded in free text.
//
// Moved out of interface/gate/chain.ts once a second reader
// (application/concern/UnrespondedConcernsQuery — "has this request's
// concerns been followed up?") needed the same lexical scan. Belongs
// next to compareSequenceIds as another pure function over the
// well-known id formats.
//
// References are found by regex:
//   requests: YYYY-MM-DD-NNN[N]
//   issues:   i-YYYY-MM-DD-NNN[N]
// Matching is lexical only. A prose string that happens to look like
// an id is followed; false positives are rare because the shape is
// distinctive.

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
