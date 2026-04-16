import { DomainError } from './DomainError.js';

export const DEFAULT_LENSES = ['devil', 'layer', 'cognitive', 'user'] as const;
export type Lense = string;

/**
 * Parse and validate a lense value against an allowed set.
 * Pure function — no module-level mutable state.
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
    `Invalid lense: "${value}". Must be one of: ${effectiveAllowed.join(', ')}`,
    'lense',
  );
}

// Backward compat — old code may reference LENSES
export const LENSES = DEFAULT_LENSES;
