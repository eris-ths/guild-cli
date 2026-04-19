import { DomainError } from './DomainError.js';

export const DEFAULT_LENSES = ['devil', 'layer', 'cognitive', 'user'] as const;
export type Lense = string;

/**
 * Parse and validate a lense value against an allowed set.
 * Pure function — no module-level mutable state.
 *
 * The four defaults (`devil | layer | cognitive | user`) are
 * meta-perspectives: "what breaks", "which structural layer",
 * "where you hesitate", "whose happiness (LDD)". Domain-specific
 * lenses (`security`, `perf`, `a11y`, ...) can be added per
 * project by listing them in `guild.config.yaml`:
 *
 *     lenses: [devil, layer, cognitive, user, security]
 *
 * The error message below surfaces this extension path so first-time
 * users don't have to discover it from source.
 *
 * `strict` (default true) controls what happens when `value` is
 * not in `allowed`. Strict throws; non-strict returns the raw
 * string as-is. Non-strict exists so that hydration of historical
 * records can preserve lense values that were valid at write time
 * but have since been removed from the config (lense-deprecation
 * gap surfaced in alexandria/issues/i-2026-04-19-0005). Write
 * paths should stay strict; read paths may be permissive because
 * the value was already validated when it was first committed.
 */
export function parseLense(
  value: string,
  allowed: readonly string[] = DEFAULT_LENSES,
  strict: boolean = true,
): Lense {
  const effectiveAllowed = allowed.length > 0 ? allowed : DEFAULT_LENSES;
  if (effectiveAllowed.includes(value)) {
    return value;
  }
  if (!strict) {
    return value;
  }
  throw new DomainError(
    [
      `Invalid lense: "${value}"`,
      `  accepted: ${effectiveAllowed.join(', ')}`,
      `  To accept more (e.g. "security", "perf"),`,
      `  add them to \`lenses:\` in guild.config.yaml.`,
    ].join('\n'),
    'lense',
  );
}

// Backward compat — old code may reference LENSES
export const LENSES = DEFAULT_LENSES;
