// withEntryLock — thin per-entry middleware that decides whether
// to engage `withGuildLock` for a given verb.
//
// Decision order (fail-safe by design):
//   1. EXEMPT  → run `fn` directly, no lock.        (e.g. doctor / repair)
//   2. READ    → run `fn` directly, no lock.
//   3. WRITE   → acquire lock, run `fn`, release.
//   4. unknown → acquire lock (treat as write).     ← fail-safe
//
// "unknown" should never happen in practice — the verbs-consistency
// test pins each entry's switch cases to the union READ ∪ WRITE ∪
// EXEMPT — but if a new verb is added without updating verbs.ts, we
// prefer over-locking (slight contention) to under-locking (silent
// concurrent corruption).

import { withGuildLock } from './guildLock.js';

export interface VerbSets {
  READ_VERBS: ReadonlySet<string>;
  WRITE_VERBS: ReadonlySet<string>;
  LOCK_EXEMPT_VERBS: ReadonlySet<string>;
}

interface ConfigLike {
  contentRoot: string;
}

export async function withEntryLock<T>(
  config: ConfigLike,
  passage: string,
  cmd: string,
  verbs: VerbSets,
  actor: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (verbs.LOCK_EXEMPT_VERBS.has(cmd)) return fn();
  if (verbs.READ_VERBS.has(cmd)) return fn();
  // WRITE_VERBS or unknown → lock (fail-safe).
  return withGuildLock(config, { passage, verb: cmd, actor }, fn);
}
