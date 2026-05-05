/**
 * Boundary-side absolute path sanitization for CLI error messages.
 *
 * Errors raised from `safeFs` and other infrastructure code carry the
 * fully-resolved absolute path (e.g.
 * `/Users/alice/work/proj/substrate/requests/pending/foo.yaml`). For a
 * single-user, trusted-environment CLI (see SECURITY.md threat model)
 * this is acceptable, but it incidentally leaks home-directory and
 * checkout-location info into logs, screenshots, and bug reports.
 *
 * Mitigation (issue #153, Direction 1 — "sanitize at the boundary"):
 * each CLI's top-level `catch` rewrites occurrences of the configured
 * `contentRoot` prefix to the literal token `<content_root>`. The
 * structural tail (`<content_root>/requests/pending/foo.yaml`) is
 * preserved so debugging is not impaired — only the host-specific
 * prefix collapses.
 *
 * Pure function, no I/O. Lives in `interface/shared/` because it is
 * called from every CLI's `main()` and has no domain-layer dependency.
 */
export function sanitizeError(msg: string, contentRoot: string): string {
  // Defensive no-op for degenerate inputs. An empty or root-only
  // contentRoot would replace far too aggressively if applied
  // literally — better to leave the message untouched than to
  // corrupt it. In practice GuildConfig.load() always returns a
  // multi-segment absolute path.
  if (!contentRoot || contentRoot === '/' || contentRoot.length < 2) {
    return msg;
  }

  // Strip a single trailing slash so `/foo/bar` and `/foo/bar/`
  // both match the same prefix in the message. We do not try to
  // normalize internal `..` / `.` segments — GuildConfig already
  // resolves to a canonical absolute path before we see it.
  const root = contentRoot.endsWith('/')
    ? contentRoot.slice(0, -1)
    : contentRoot;

  // String-level replaceAll. The path is treated as a literal — no
  // regex, no escaping concerns. Multiple occurrences in one
  // message (e.g. "cannot move A to B" with both inside the root)
  // are all collapsed.
  return msg.split(root).join('<content_root>');
}
