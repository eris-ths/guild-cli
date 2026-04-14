/**
 * Minimal arg parser. Supports:
 *   --flag            → { flag: true }
 *   --key value       → { key: 'value' }
 *   --key=value       → { key: 'value' }
 *   positional tokens → args[]
 */
export interface ParsedArgs {
  readonly options: Readonly<Record<string, string | boolean>>;
  readonly positional: readonly string[];
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const options: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;
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
