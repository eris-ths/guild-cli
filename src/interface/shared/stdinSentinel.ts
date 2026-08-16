/**
 * STDIN sentinel — `--flag -` means "read this value from stdin".
 *
 * The convention already existed on `gate` (`--reason -`, `--text -`,
 * `--comment -`), where round-3 dogfood found handlers that accepted
 * the sentinel token but never wired it, silently storing the literal
 * `-`. Those were named "symmetry gaps" and closed one handler at a
 * time; see `tests/interface/stdinSentinel.test.ts`.
 *
 * This module exists so the next passage that grows a prose flag
 * inherits the behaviour instead of re-deriving it. The failure mode
 * it prevents is the expensive one: the sentinel is not rejected, so
 * the command exits 0 and the record lands with a one-character body.
 * Nothing surfaces until someone reads the record back — which, for
 * handoff records (`agora suspend`, `agora move`), is exactly when the
 * reader has no other copy to fall back on.
 *
 * Two guards beyond the plain gate-side `if (v === '-')` shape:
 *
 *   1. **At most one sentinel per invocation.** There is one stdin.
 *      `agora suspend --cliff - --invitation -` cannot be satisfied,
 *      and silently feeding the same bytes to both would be worse
 *      than refusing.
 *   2. **A blank body is refused.** An empty pipe (`… < /dev/null`, a
 *      heredoc that produced nothing, a producer that failed upstream)
 *      would otherwise write an empty record with status 0 — the same
 *      silent-empty outcome the sentinel wiring was meant to remove.
 */

/** Read stdin to completion as UTF-8. */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Raised when the sentinel is used in a way stdin cannot satisfy. */
export class StdinSentinelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StdinSentinelError';
  }
}

/**
 * Resolve `-` values from stdin for a set of named flags.
 *
 * Pass every prose-bearing flag the verb accepts, including the ones
 * the caller left undefined — the multi-sentinel guard can only see a
 * conflict if it sees the whole set. Returns a record with the same
 * keys; non-sentinel values pass through untouched.
 *
 *   const { cliff, invitation } = await resolveStdinSentinels({
 *     cliff, invitation,
 *   });
 *
 * The body is trimmed: heredocs and `echo` both append a trailing
 * newline that is never part of the intended text.
 */
export async function resolveStdinSentinels<
  T extends Record<string, string | undefined>,
>(values: T): Promise<T> {
  const sentinels = (Object.keys(values) as (keyof T & string)[]).filter(
    (k) => values[k] === '-',
  );

  if (sentinels.length > 1) {
    throw new StdinSentinelError(
      `${sentinels.map((k) => `--${k}`).join(' and ')} were both given as \`-\`, ` +
        'but there is only one stdin. Pass at most one flag as `-`; give the ' +
        'others their value inline.',
    );
  }

  if (sentinels.length === 0) return values;

  const out = { ...values };
  const key = sentinels[0] as keyof T & string;
  const body = (await readStdin()).trim();
  if (!body) {
    throw new StdinSentinelError(
      `--${key} was given as \`-\` but stdin was empty. Nothing was written — ` +
        'an empty record reads as a real one, which is the failure this ' +
        'sentinel exists to prevent.',
    );
  }
  out[key] = body as T[keyof T & string];
  return out;
}
