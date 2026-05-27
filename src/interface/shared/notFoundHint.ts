// Shared not-found message format with a discovery hint.
//
// Pre-fix: `process.stderr.write('not found: ${id}\n')` — terse, no
// guidance on how to find a valid id. A fresh agent that mistyped a
// request id had no signal toward `gate list` / `gate tail`.
//
// The hint is per-entity because the verb that lists each kind is
// different (`gate list` for requests, `gate issues list` for issues,
// `guild list` for members). Centralising here keeps the prose
// consistent across call sites — the change is "every not-found
// emission line gains one hint line" rather than "each handler
// invents its own phrasing".

export type NotFoundEntity = 'request' | 'issue' | 'member';

const HINTS: Record<NotFoundEntity, string> = {
  request: "  try 'gate list' or 'gate tail' to see existing requests.",
  issue: "  try 'gate issues list' to see existing issues.",
  member: "  try 'guild list' to see registered members.",
};

export function notFoundMessage(entity: NotFoundEntity, id: string): string {
  const prefix = entity === 'issue' ? 'issue not found' : 'not found';
  return `${prefix}: ${id}\n${HINTS[entity]}\n`;
}

/**
 * Format-aware envelope emitter for not-found errors (#408).
 *
 * `notFoundMessage` always returned a free-text body — a tool-use
 * agent that piped `gate show <id> --format json` into a JSON
 * parser tripped on the prose. This helper renders the same
 * information through `--format json` as `{ok:false, error:{...}}`,
 * matching the envelope shape already in use by `whoami` and the
 * write-verb error path (issue #194 lineage).
 *
 * Returns the string the caller should write to its stream. The
 * caller still picks the stream (stderr today everywhere) so
 * intent stays visible; only the rendering is centralised.
 */
export function notFoundEnvelope(
  entity: NotFoundEntity,
  id: string,
  format: 'json' | 'text' | 'plain' | string,
): string {
  if (format === 'json') {
    const prefix = entity === 'issue' ? 'issue not found' : 'not found';
    const envelope = {
      ok: false,
      error: {
        kind: 'not_found',
        entity,
        id,
        message: `${prefix}: ${id}`,
        hint: HINTS[entity].trim(),
      },
    };
    return JSON.stringify(envelope) + '\n';
  }
  return notFoundMessage(entity, id);
}
