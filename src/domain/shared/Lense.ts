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
 */
export function parseLense(
  value: string,
  allowed: readonly string[] = DEFAULT_LENSES,
): Lense {
  const effectiveAllowed = allowed.length > 0 ? allowed : DEFAULT_LENSES;
  if (effectiveAllowed.includes(value)) {
    return value;
  }
  throw new DomainError(
    `Invalid lense: "${value}". Must be one of: ${effectiveAllowed.join(', ')}. ` +
      `To accept a new lense (e.g. "security", "perf"), add it to ` +
      `\`lenses:\` in guild.config.yaml.`,
    'lense',
  );
}

// Backward compat — old code may reference LENSES
export const LENSES = DEFAULT_LENSES;
