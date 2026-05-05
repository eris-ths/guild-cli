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
