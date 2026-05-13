// `--explain` — universal orientation flag on read verbs.
//
// A caller (typically an AI agent on a cold session) appends
// `--explain` to a read verb to receive a one-line orientation
// message on stderr describing what the verb returns and which
// related verbs to reach for. The verb's normal output is
// unchanged on stdout, so `--explain` is composable with `--format
// json` and shell pipelines — orientation is a sibling channel.
//
// Principle 09 (orientation-disclosure) shaped this: instead of
// waiting for friction to teach (an unknown verb, a malformed
// flag), the caller can ask for orientation up front. The cost is
// one stderr line; the payoff is fewer second-trip help lookups.
//
// Mechanism:
//   1. `--explain` is registered in `rejectUnknownFlags` as a
//      universal pass-through (alongside `--help`), so individual
//      handlers do not need to add it to their `KNOWN_FLAGS` set.
//   2. Each opted-in handler calls `maybeEmitExplain(args, verb)`
//      after `rejectUnknownFlags` and before producing output.
//   3. Verbs without a registered message silently skip; the flag
//      is still accepted (no unknown-flag error).
//
// To opt a verb in:
//   - Add an entry to `EXPLAIN_MESSAGES` keyed by the same verb
//     string passed to `rejectUnknownFlags`.
//   - Call `maybeEmitExplain(args, '<verb>')` from the handler.

import type { ParsedArgs } from './parseArgs.js';

/**
 * Registry of one-line orientation messages, keyed by the verb
 * string. The key matches the second argument to
 * `rejectUnknownFlags` so the two stay in lock-step.
 *
 * Style: one sentence, present tense, names the primary output
 * and at most one related verb. Avoids re-documenting flags
 * (`--help` does that).
 */
export const EXPLAIN_MESSAGES: Readonly<Record<string, string>> = {
  boot: 'session-start orientation; surfaces actor identity, recent wave activity, and the next verb to reach for.',
  next: 'one-call read-and-dispatch of the top actionable verb. Without --confirm prints the plan; with --confirm dispatches via subprocess. Auto-dispatch limited to verbs needing only --by.',
  list: 'lists requests filtered by --state/--from/--executors/--target; pair with `gate show <id>` for full body.',
  pending: 'lists requests in state=pending — the approval queue; subset of `gate list --state pending`.',
  show: 'reads one request (or other id) by id; use --fields for projection or --plain for shell-friendly output.',
  chain: 'traces id references forward and inbound across requests/issues/plays — cross-passage by design.',
  'lore list': 'lists every package-shipped principle + trap, sorted by name; filter via --type/--applies-to/--relevant-until.',
  'lore show': 'reads one principle or trap markdown body by name; `--format json` returns the structured entry.',
  voices: 'reads one actor\'s utterances + reviews across the content_root; filter via --lense/--verdict.',
  tail: 'recent utterances across every actor on this content_root; the listening side of `voices`.',
};

/**
 * Write the orientation line for `verb` to stderr if and only if
 * `--explain` was passed and a message is registered. Returns
 * whether a message was emitted so callers (or tests) can branch
 * if they need to.
 *
 * Stderr (not stdout) so the line never mingles with structured
 * output. Pipelines that capture stdout into a JSON parser stay
 * working when `--explain` is added.
 */
export function maybeEmitExplain(args: ParsedArgs, verb: string): boolean {
  if (args.options['explain'] !== true) return false;
  const msg = EXPLAIN_MESSAGES[verb];
  if (!msg) return false;
  process.stderr.write(`(explain: ${msg})\n`);
  return true;
}
