// devil verbs — read/write/exempt classification for entry middleware.
//
// See gate's verbs.ts header for the rule-of-thumb classification.
// devil-review's `ingest` is WRITE: it appends entries from automated
// sources into the review record.

export const READ_VERBS: ReadonlySet<string> = new Set([
  'list',
  'show',
  'schema',
]);

export const WRITE_VERBS: ReadonlySet<string> = new Set([
  'open',
  'entry',
  'dismiss',
  'resolve',
  'suspend',
  'resume',
  'ingest',
  'conclude',
]);

export const LOCK_EXEMPT_VERBS: ReadonlySet<string> = new Set();
