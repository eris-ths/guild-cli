// delta verbs — read/write/exempt classification for entry middleware.
//
// See gate's verbs.ts header for the rule-of-thumb classification.
// Surface: `add` / `deliver` are writes (one appends a record, the other
// rewrites one exactly once); `list` / `show` are reads.

export const READ_VERBS: ReadonlySet<string> = new Set(['list', 'show']);

export const WRITE_VERBS: ReadonlySet<string> = new Set(['add', 'deliver']);

export const LOCK_EXEMPT_VERBS: ReadonlySet<string> = new Set();
