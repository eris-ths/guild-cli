// agora verbs — read/write/exempt classification for entry middleware.
//
// See gate's verbs.ts header for the rule-of-thumb classification.
// agora has no maintenance verb pair yet, so LOCK_EXEMPT_VERBS is
// empty (kept as an exported constant so the middleware signature
// is uniform across passages).

export const READ_VERBS: ReadonlySet<string> = new Set([
  'list',
  'show',
  'last',
  'cliff',
  'schema',
]);

export const WRITE_VERBS: ReadonlySet<string> = new Set([
  'new',
  'play',
  'move',
  'suspend',
  'resume',
  'conclude',
]);

export const LOCK_EXEMPT_VERBS: ReadonlySet<string> = new Set();
