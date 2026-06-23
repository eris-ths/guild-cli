/**
 * Parse `--tag tech:typescript,status:active` (comma-separated) into a
 * clean tag list. Same convention as gate's `--with` (request.ts:
 * `parseWithList`). Tag-shape validation happens upstream in
 * Ctx.create -> parseCtxTag, so this only splits / trims / drops empties.
 *
 * Shared by the write handlers (`record`, `supersede`) so the `--tag`
 * surface is parsed identically across them.
 */
export function parseTagList(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
