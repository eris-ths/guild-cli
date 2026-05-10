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
    [
      `Invalid lense: "${value}"`,
      `  accepted: ${effectiveAllowed.join(', ')}`,
      `  To accept more (e.g. "security", "perf"),`,
      `  add them to \`lenses:\` in guild.config.yaml.`,
    ].join('\n'),
    'lense',
  );
}

/**
 * Permissive lense parser for the hydrate path (records-outlive-writers).
 *
 * The strict `parseLense` checks `value` against an allowed-set so a
 * fresh CLI write fails closed when the user typo'd the lense name.
 * That contract is correct at write time — the user is right there
 * and can fix it.
 *
 * At RE-read time, the lense was already validated when it was first
 * written. Re-validating against a possibly-different allowed-set
 * (config.lenses changed since the write, or #134 H2 strict mode is
 * now on/off) would erase historical records — the audit trail dies
 * because the policy moved. The principle is the opposite: records
 * outlive writers, so the read path tolerates lense values that the
 * current allowed-set rejects.
 *
 * Still validates `value` is a non-empty string so a corrupted record
 * (`lense: null`, `lense: 42`) surfaces as a hydrate failure rather
 * than smuggling a non-string into the domain.
 */
export function parseLenseLoose(value: unknown): Lense {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DomainError(
      `lense must be a non-empty string, got: ${typeof value === 'string' ? '""' : typeof value}`,
      'lense',
    );
  }
  return value;
}

// Backward compat — old code may reference LENSES
export const LENSES = DEFAULT_LENSES;
