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
 */
export interface ParsedArgs {
  readonly options: Readonly<Record<string, string | boolean>>;
  readonly positional: readonly string[];
}

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
        if (next !== undefined && !next.startsWith('--')) {
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
    const envVal = process.env[envFallback];
    if (envVal && envVal.length > 0) return envVal;
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
    const envVal = process.env[envFallback];
    if (envVal && envVal.length > 0) return envVal;
  }
  return undefined;
}
