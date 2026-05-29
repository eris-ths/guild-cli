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

/**
 * Map a *thrown* not-found error message to its discovery hint +
 * structured recovery, when the message is a recognized shape.
 *
 * Why this exists separately from {@link notFoundMessage}: the read
 * verbs (show / why / transcript / summarize / …) call
 * `notFoundMessage`/`notFoundEnvelope` directly and `return` without
 * throwing, so they already carry the hint. The WRITE lifecycle verbs
 * (approve / deny / execute / complete / fail) instead throw a
 * `Request not found: <id>` that surfaces through the shared
 * {@link emitErrorEnvelope} catch path — and pre-this-sweep it arrived
 * hint-less, the worse touch-feel of the two not-found paths. This
 * function lets the central envelope attach the SAME per-entity hint
 * the read path uses, keeping the two surfaces in phrasing-sync.
 *
 * Returns null for messages that don't name a known entity (e.g.
 * agora / devil / ctx not-founds, which share `emitErrorEnvelope`),
 * so the shared envelope leaves those untouched rather than stapling a
 * gate-specific `gate list` hint onto an unrelated passage's error.
 */
export function notFoundHintForMessage(message: string): {
  entity: NotFoundEntity;
  hint: string;
  recovery: { verb: string; args: Record<string, string>; reason: string };
} | null {
  // Only `request` reaches the shared catch as a throw today; issues
  // and members emit their hint + return from their own handlers. The
  // anchored pattern keeps a passing "review not found" / "play not
  // found" from a sibling passage out of this branch.
  if (/\brequest not found\b/i.test(message)) {
    return {
      entity: 'request',
      hint: HINTS.request.trim(),
      recovery: {
        verb: 'list',
        args: {},
        reason:
          "id not found — run 'gate list' (or 'gate tail') to see existing request ids",
      },
    };
  }
  return null;
}

