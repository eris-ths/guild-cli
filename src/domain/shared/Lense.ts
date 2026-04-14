import { DomainError } from './DomainError.js';

export const LENSES = ['devil', 'layer', 'cognitive', 'user'] as const;
export type Lense = (typeof LENSES)[number];

export function parseLense(value: string): Lense {
  if ((LENSES as readonly string[]).includes(value)) {
    return value as Lense;
  }
  throw new DomainError(
    `Invalid lense: "${value}". Must be one of: ${LENSES.join(', ')}`,
    'lense',
  );
}
