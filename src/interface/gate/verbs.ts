// gate verbs — read/write/exempt classification for entry middleware.
//
// This file is the authoritative classification of every verb the
// `gate` entry dispatches. The verbs-consistency test pins the union
// (READ ∪ WRITE ∪ LOCK_EXEMPT) to the actual switch cases in
// `index.ts`, so adding a new verb without updating this file fails
// CI loud rather than silently bypassing or over-locking.
//
// Classification rule of thumb:
//   READ   — verb's handler only reads YAML / does not mutate state.
//   WRITE  — verb's handler appends or transitions persisted records.
//   EXEMPT — verb intentionally orthogonal to the lock (doctor /
//            repair are the maintenance pair; locking them would
//            deadlock if the lock itself were the corruption).
//
// `gate inbox` is classified WRITE because the verb dispatcher branches
// into `inbox mark-read`, which transitions inbox file state. The
// classification is at verb-name granularity, not subverb, so the
// conservative call wins.

export const READ_VERBS: ReadonlySet<string> = new Set([
  'pending',
  'board',
  'list',
  'show',
  'voices',
  'tail',
  'whoami',
  'chain',
  'status',
  'boot',
  'next',
  'suggest',
  'flow-suggest',
  'transcript',
  'summarize',
  'why',
  'resume',
  'schema',
  'unresponded',
  'templates',
  'lore',
  'rom',
  'lense-stats',
  'wave-status',
  // 2026-08-10: absent since it shipped. Dispatched and schema'd, but
  // missing here, so withEntryLock's fail-safe treated a read-only
  // command as a WRITE and took a write lock for it. Invisible because
  // the guard compared this file against a hand-written mirror in the
  // test that had forgotten the same verb — two lists agreeing about
  // nothing. The test now derives from the dispatcher.
  'swarm-status',
  'review-context',
  'decisions',
  'self-pattern',
]);

export const WRITE_VERBS: ReadonlySet<string> = new Set([
  'request',
  'approve',
  'deny',
  'execute',
  'complete',
  'fail',
  'review',
  'claim',
  'witness',
  'unwitness',
  'thank',
  'fast-track',
  'register',
  'issues',
  'message',
  'broadcast',
  'inbox',
  'rest',
  'wake',
  'farewell',
]);

export const LOCK_EXEMPT_VERBS: ReadonlySet<string> = new Set([
  'doctor',
  'repair',
  // `voice` writes the .guild-voice mode marker (config-shaped, not
  // substrate-data-shaped). It does not touch any persisted request /
  // review / issue record, so taking the substrate lock would be
  // over-conservative. Same maintenance-tier reasoning as doctor /
  // repair — the verb is orthogonal to the lock's purpose.
  'voice',
]);
