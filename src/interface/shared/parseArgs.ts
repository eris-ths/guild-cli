/**
 * Minimal arg parser. Supports:
 *   --flag            → { flag: true }
 *   --key value       → { key: 'value' }
 *   --key=value       → { key: 'value' }   (value may begin with "--")
 *   --                → POSIX end-of-options separator; every
 *                       subsequent token is positional, even if it
 *                       begins with "--". Use to pass values like
 *                       `gate issues note <id> --by eris -- "--reason"`.
 *   positional tokens → args[]
 *
 * The `--` separator is the escape valve for the one-token-per-value
 * ambiguity: without it, `--key` followed by `--looks-like-a-flag`
 * stays boolean-true because the parser can't tell a value-that-
 * happens-to-start-with-dashes apart from a genuine next flag. This
 * is the standard POSIX resolution to that ambiguity.
 *
 * Known-boolean flags (KNOWN_BOOLEAN_FLAGS) are NEVER consumed-with-
 * value: they land as `true` even when followed by a non-dash token.
 * This closes the footgun where `gate review <id> --dry-run "LGTM"`
 * quietly read "LGTM" as the dry-run value and silently skipped the
 * intended boolean. Callers of these flags use `=== true` on the
 * value anyway, so the old misbehaviour was latent: true intent
 * dropped on the floor, positional swallowed.
 */

import { resolveGuildActor } from './resolveGuildActor.js';

export interface ParsedArgs {
  readonly options: Readonly<Record<string, string | boolean>>;
  readonly positional: readonly string[];
}

/**
 * Flags that are definitionally boolean — they never take a value.
 * Listed here so the parser doesn't speculatively consume the next
 * token as their "value" (see docblock above).
 *
 * Adding to this list is the right move when a new `--flag` is
 * documented as boolean-only; forgetting to add it just preserves
 * the old `--dry-run=true` escape-valve behaviour, not a crash.
 */
export const KNOWN_BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  'apply',             // gate repair --apply
  'dry-run',           // write verbs' preview mode
  'plain',             // gate show --fields X --plain (shell-friendly single-field)
  'summary',           // gate doctor --summary
  'unread',            // gate inbox --unread
  'with-calibration',  // gate voices --with-calibration (opt-in richer JSON)
]);

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const options: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let sawDoubleDash = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;
    // Once we've seen `--`, every remaining token is positional — even
    // if it begins with dashes. The separator itself is consumed.
    if (sawDoubleDash) {
      positional.push(token);
      continue;
    }
    if (token === '--') {
      sawDoubleDash = true;
      continue;
    }
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq >= 0) {
        const key = token.slice(2, eq);
        options[key] = token.slice(eq + 1);
      } else {
        const key = token.slice(2);
        const next = argv[i + 1];
        if (
          !KNOWN_BOOLEAN_FLAGS.has(key) &&
          next !== undefined &&
          !next.startsWith('--')
        ) {
          options[key] = next;
          i++;
        } else {
          options[key] = true;
        }
      }
    } else {
      positional.push(token);
    }
  }
  return { options, positional };
}

export function requireOption(
  args: ParsedArgs,
  key: string,
  usage: string,
  envFallback?: string,
): string {
  const v = args.options[key];
  if (typeof v === 'string' && v) return v;
  if (envFallback) {
    const fallback = resolveEnvOrActorFile(envFallback);
    if (fallback !== undefined) return fallback;
  }
  // When the flag is present but landed as boolean, the user almost
  // certainly passed a value beginning with `--` (quoting another
  // flag name in a literal). The default parser refuses to consume
  // such tokens, so point at the two escape valves explicitly.
  if (v === true) {
    throw new Error(
      `Missing --${key} value. ${usage}\n` +
        `  (If your value begins with "--", use --${key}=<value> ` +
        `or place "-- <value>" after the other flags.)`,
    );
  }
  throw new Error(`Missing --${key}. ${usage}`);
}

export function optionalOption(
  args: ParsedArgs,
  key: string,
  envFallback?: string,
): string | undefined {
  const v = args.options[key];
  if (typeof v === 'string') return v;
  if (envFallback) {
    const fallback = resolveEnvOrActorFile(envFallback);
    if (fallback !== undefined) return fallback;
  }
  return undefined;
}

/**
 * Read `envFallback` from process.env, falling through to the
 * `.guild-actor` file if and only if the fallback name is `GUILD_ACTOR`.
 * Other env-fallback names (none used today, but the parameter is open)
 * stay env-only — the file fallback is specifically for actor identity.
 * See `resolveGuildActor` for the file resolution rules.
 */
function resolveEnvOrActorFile(envFallback: string): string | undefined {
  const envVal = process.env[envFallback];
  if (envVal && envVal.length > 0) return envVal;
  if (envFallback === 'GUILD_ACTOR') {
    return resolveGuildActor();
  }
  return undefined;
}

/**
 * Reject any --flag not in the verb's known set.
 *
 * The parser itself is intentionally permissive (a user may alias in
 * future flags without the parser crashing). Permissiveness at the
 * parser layer is appropriate; silently ignoring an unknown flag at
 * the *verb* layer is not — the caller typed `--from noir` expecting
 * it to do something, and got a result that looked like success.
 *
 * Callers pass their full known set (string flags + boolean flags +
 * flags that `requireOption`/`optionalOption` will read). Unknown
 * flags throw a usage error naming what was used and what is valid.
 * This is the strict variant each verb opts into — opting-in is how
 * existing verbs migrate without risk.
 */
export function rejectUnknownFlags(
  args: ParsedArgs,
  known: ReadonlySet<string>,
  verb: string,
): void {
  const unknown: string[] = [];
  for (const key of Object.keys(args.options)) {
    if (!known.has(key)) unknown.push(key);
  }
  if (unknown.length === 0) return;
  const knownList = [...known].sort().map((k) => `--${k}`).join(', ');
  const badList = unknown.sort().map((k) => `--${k}`).join(', ');
  throw new Error(
    `gate ${verb}: unknown flag${unknown.length === 1 ? '' : 's'}: ${badList}\n` +
      `  valid flags for '${verb}': ${knownList}`,
  );
}
