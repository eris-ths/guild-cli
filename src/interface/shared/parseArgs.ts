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
 * Cross-cutting boolean flags — flags shared by multiple verbs whose
 * boolean shape is well-known across the codebase. Listed here so the
 * parser doesn't speculatively consume the next token as their "value".
 *
 * **For new boolean flags, prefer the per-verb registration pattern**
 * (`parseArgs(argv, { booleanFlags })` — see below). This global set
 * exists for legacy cross-cutting flags shared across many verbs;
 * adding to it works but couples the parser to a per-verb concern,
 * and forgetting to add silently miscoerces (issue #158).
 *
 * The per-verb pattern moves the declaration next to the verb that
 * owns the flag — `<VERB>_KNOWN_FLAGS` for unknown-flag rejection
 * already lives in each handler; `<VERB>_BOOLEAN_FLAGS` is its
 * sibling for the same scope.
 */
export const KNOWN_BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  'apply',             // gate repair --apply
  'dry-run',           // write verbs' preview mode
  'plain',             // gate show --fields X --plain (shell-friendly single-field)
  'summary',           // gate doctor --summary
  'unread',            // gate inbox --unread
  'with-calibration',  // gate voices --with-calibration (opt-in richer JSON)
]);

export interface ParseArgsOptions {
  /**
   * Verb-specific boolean flags. Unioned with `KNOWN_BOOLEAN_FLAGS`
   * for the duration of this `parseArgs` call. Use this to register
   * flags that belong to one verb rather than touching the global
   * cross-cutting set.
   *
   * Pattern (issue #158): each binary's dispatch layer extracts the
   * verb name from `argv[0]`, looks up the verb's boolean set in a
   * local registry, and threads it into `parseArgs`. The handler
   * file declares both `<VERB>_KNOWN_FLAGS` (for `rejectUnknownFlags`)
   * and `<VERB>_BOOLEAN_FLAGS` (for this parameter); the binary
   * imports both.
   */
  readonly booleanFlags?: ReadonlySet<string>;
}

export function parseArgs(
  argv: readonly string[],
  opts: ParseArgsOptions = {},
): ParsedArgs {
  const options: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let sawDoubleDash = false;
  // Compose the active boolean set from the global cross-cutting set
  // plus the verb-local set if provided. Hot-path optimization:
  // skip the union when no verb-local set was passed (the common
  // case for short read verbs).
  const verbBooleans = opts.booleanFlags;
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
        const isBoolean =
          KNOWN_BOOLEAN_FLAGS.has(key) ||
          (verbBooleans !== undefined && verbBooleans.has(key));
        if (
          !isBoolean &&
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
  shape?: string,
  envFallback?: string,
): string {
  const v = args.options[key];
  if (typeof v === 'string' && v) return v;
  if (envFallback) {
    const fallback = resolveEnvOrActorFile(envFallback);
    if (fallback !== undefined) return fallback;
  }
  // Construct a one-line error that names the flag, its value shape,
  // and (when applicable) the env var that would have satisfied the
  // call. The shape is the per-callsite value placeholder (`<m>`,
  // `<low|med|high>`, `"..."`); when omitted the error stays bare,
  // which is what tests of the helper itself want. The env hint is
  // generated from `envFallback` so callsites don't have to repeat
  // "or set GUILD_ACTOR" — propagating that mention from one place
  // is the touch-feel reason this branch exists.
  const shapePart = shape ? ` ${shape}` : '';
  const envPart = envFallback ? ` (or set ${envFallback})` : '';
  // When the flag is present but landed as boolean, the user almost
  // certainly passed a value beginning with `--` (quoting another
  // flag name in a literal). The default parser refuses to consume
  // such tokens, so point at the two escape valves explicitly.
  if (v === true) {
    throw new Error(
      `Missing --${key} value${envPart}.\n` +
        `  (If your value begins with "--", use --${key}=<value> ` +
        `or place "-- <value>" after the other flags.)`,
    );
  }
  throw new Error(`Missing --${key}${shapePart}${envPart}.`);
}

export function optionalOption(
  args: ParsedArgs,
  key: string,
  envFallback?: string,
): string | undefined {
  const v = args.options[key];
  if (typeof v === 'string') return v;
  // Bare flag (`--executor` with no value) lands as boolean `true`.
  // Pre-fix this silently fell through to envFallback / undefined,
  // which read as "no value given". A user typing `--depth` and
  // forgetting the enum value would see their request go through
  // with depth unset — exact fail-open shape `tail`'s strict-reject
  // and `gate doctor`'s --format-validation already protect against.
  // Fail closed with the same shape `requireOption` uses for the
  // same condition.
  if (v === true) {
    const envPart = envFallback ? ` (or set ${envFallback})` : '';
    throw new Error(
      `Missing --${key} value${envPart}.\n` +
        `  (If your value begins with "--", use --${key}=<value> ` +
        `or place "-- <value>" after the other flags.)`,
    );
  }
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
 * Thrown by `rejectUnknownFlags` when the caller passes `--help` against
 * a verb. Carries the verb name and known flag set so the binary's
 * top-level catch can render verb-scoped help and return exit 0 (rather
 * than the exit-1 path any unknown-flag error takes).
 *
 * Why a typed signal instead of stdout/exit inside rejectUnknownFlags:
 * the helper is pure validation; coupling it to process.stdout / exit
 * would make it untestable and would mean every caller imports the
 * same side effect. A throw lets each binary decide what "help"
 * renders to (different CLIs may want different prefixes).
 */
export class HelpRequested extends Error {
  /**
   * Optional verb-specific extra lines appended after the flag list and
   * before the `see ... --help` footer. Used to surface dynamic info
   * the static help can't carry — e.g. the `gate review` lense set
   * resolved from `guild.config.yaml` (#228 sub-task 2). Stays empty
   * for verbs that have no extras to add, preserving the existing
   * help-output shape.
   */
  public readonly extras: readonly string[];
  constructor(
    public readonly verb: string,
    public readonly knownFlags: readonly string[],
    extras: readonly string[] = [],
  ) {
    super(`help requested for verb: ${verb}`);
    this.name = 'HelpRequested';
    this.extras = extras;
  }
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
 *
 * `--help` is treated as universal: every verb honours it regardless
 * of whether `help` appears in the verb's known set. The check throws
 * `HelpRequested` so the binary's main() catch can render verb help
 * with exit 0.
 */
export function rejectUnknownFlags(
  args: ParsedArgs,
  known: ReadonlySet<string>,
  verb: string,
  extras: readonly string[] = [],
  hint?: string,
): void {
  if (args.options['help'] === true) {
    throw new HelpRequested(verb, [...known].sort(), extras);
  }
  // `--explain` is universal: every verb accepts it without listing
  // it in its known set. The handler decides whether to emit an
  // orientation line (via `maybeEmitExplain`); when no message is
  // registered for the verb, the flag still passes silently rather
  // than tripping unknown-flag rejection. See shared/explain.ts.
  const unknown: string[] = [];
  for (const key of Object.keys(args.options)) {
    if (key === 'help') continue;
    if (key === 'explain') continue;
    if (!known.has(key)) unknown.push(key);
  }
  if (unknown.length === 0) return;
  const knownList = [...known].sort().map((k) => `--${k}`).join(', ');
  const badList = unknown.sort().map((k) => `--${k}`).join(', ');
  throw new Error(
    `${verb}: unknown flag${unknown.length === 1 ? '' : 's'}: ${badList}\n` +
      `  valid flags for '${verb}': ${knownList}` +
      (hint ? `\n  ${hint}` : ''),
  );
}
