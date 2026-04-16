import { DomainError } from './DomainError.js';

export const DEFAULT_LENSES = ['devil', 'layer', 'cognitive', 'user'] as const;
export type Lense = string;

/**
 * Runtime-configurable lense set.
 * Defaults to the four built-in lenses. GuildConfig can override this
 * at startup by calling setAllowedLenses() with values from config.
 */
let _allowedLenses: readonly string[] = DEFAULT_LENSES;

export function setAllowedLenses(lenses: readonly string[]): void {
  _allowedLenses = lenses.length > 0 ? lenses : DEFAULT_LENSES;
}

export function getAllowedLenses(): readonly string[] {
  return _allowedLenses;
}

export function parseLense(value: string): Lense {
  if (_allowedLenses.includes(value)) {
    return value;
  }
  throw new DomainError(
    `Invalid lense: "${value}". Must be one of: ${_allowedLenses.join(', ')}`,
    'lense',
  );
}

// Backward compat — old code may reference LENSES
export const LENSES = DEFAULT_LENSES;
