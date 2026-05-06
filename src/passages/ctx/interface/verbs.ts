// ctx verbs — read/write/exempt classification for entry middleware.
//
// See gate's verbs.ts header for the rule-of-thumb classification.
// Phase 1 surface is just `record` (write). Phase 2 will add fork /
// supersede / show / list / chain / status; this file grows as those
// land.

export const READ_VERBS: ReadonlySet<string> = new Set();

export const WRITE_VERBS: ReadonlySet<string> = new Set(['record']);

export const LOCK_EXEMPT_VERBS: ReadonlySet<string> = new Set();
