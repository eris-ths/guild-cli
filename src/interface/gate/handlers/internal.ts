import { buildContainer } from '../../shared/container.js';
import { optionalOption, ParsedArgs } from '../../shared/parseArgs.js';
import { RequestJSON } from '../voices.js';

/**
 * Shared private helpers for gate command handlers.
 * Not part of the public surface — anything here may change between
 * patch releases (see POLICY.md).
 */

export type C = ReturnType<typeof buildContainer>;

export function parseOptionalIntOption(
  args: ParsedArgs,
  key: string,
): number | undefined {
  const raw = optionalOption(args, key);
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0 || String(n) !== raw) {
    throw new Error(`--${key} must be a non-negative integer, got: ${raw}`);
  }
  return n;
}

// Safely truncate a string by Unicode code points, not UTF-16 code units,
// so we never cleave a surrogate pair in half. Appends "..." when cut.
export function truncateCodePoints(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  return chars.slice(0, max - 3).join('') + '...';
}

// Shared loader for cross-cutting reads (voices, tail, whoami, chain).
// Delegates to RequestUseCases.listAll which reads every state
// directory in parallel and dedupes on id in case a concurrent
// transition has moved a file between directories during the scan.
export async function loadAllRequestsAsJson(c: C): Promise<RequestJSON[]> {
  const all = await c.requestUC.listAll();
  return all.map((r) => r.toJSON() as unknown as RequestJSON);
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
