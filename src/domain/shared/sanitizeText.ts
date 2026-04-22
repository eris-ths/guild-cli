import { DomainError } from './DomainError.js';

/**
 * Control characters stripped on every sanitize call: NUL through BS,
 * VT/FF, shift-out through US, and DEL. Newline (0x0A), carriage return
 * (0x0D), and tab (0x09) are deliberately *not* stripped — heredoc
 * bodies, review comments, and YAML round-trips carry meaningful
 * whitespace that must pass through.
 */
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export interface SanitizeTextOptions {
  /**
   * Hard ceiling on the cleaned length (after control-char strip and
   * optional trim). Exceeded → DomainError. Each caller picks its own
   * ceiling based on what the storage layer / reader tooling can
   * reasonably display.
   */
  maxLen: number;
  /**
   * Reject empty input after cleaning. Defaults to `true` because most
   * identity-bearing fields (action, reason, text, note) are
   * semantically required. Set to `false` for surfaces where the
   * empty state is meaningful (e.g. a review comment that the author
   * intends to be terse — though in practice that is blocked at the
   * interface layer).
   */
  requireNonEmpty?: boolean;
  /**
   * Trim leading/trailing whitespace after stripping control chars.
   * Defaults to `true`. Set to `false` for fields where inner
   * whitespace matters and leading indent is intentional (rare;
   * currently only Review.comment preserves full-width spacing so
   * code blocks inside comments render correctly).
   */
  trim?: boolean;
}

/**
 * Uniform string sanitizer used by every domain/application layer that
 * stores free-form text. Previously each of Request, Issue, Review,
 * and MessageUseCases kept its own copy of this logic (4-way duplication,
 * drift observed: Review lost the empty-reject and trim steps over
 * time). One place, one set of invariants.
 *
 * Invariants enforced:
 *   1. Input must be a string (throws DomainError on other types)
 *   2. Control characters are stripped (tab/newline/CR preserved)
 *   3. When `trim` (default true): leading/trailing whitespace removed
 *   4. When `requireNonEmpty` (default true): empty string throws
 *   5. Cleaned length ≤ `maxLen`, else throws
 */
export function sanitizeText(
  raw: unknown,
  field: string,
  opts: SanitizeTextOptions,
): string {
  if (typeof raw !== 'string') {
    throw new DomainError(`${field} must be a string`, field);
  }
  const requireNonEmpty = opts.requireNonEmpty ?? true;
  const trim = opts.trim ?? true;
  let cleaned = raw.replace(CONTROL_CHAR_RE, '');
  if (trim) cleaned = cleaned.trim();
  if (requireNonEmpty && cleaned.length === 0) {
    throw new DomainError(`${field} required`, field);
  }
  if (cleaned.length > opts.maxLen) {
    throw new DomainError(
      `${field} too long (max ${opts.maxLen} chars)`,
      field,
    );
  }
  return cleaned;
}
