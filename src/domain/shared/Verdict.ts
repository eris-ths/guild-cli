import { DomainError } from './DomainError.js';

export const VERDICTS = ['ok', 'concern', 'reject'] as const;
export type Verdict = (typeof VERDICTS)[number];

export function parseVerdict(value: string): Verdict {
  if ((VERDICTS as readonly string[]).includes(value)) {
    return value as Verdict;
  }
  throw new DomainError(
    `Invalid verdict: "${value}". Must be one of: ${VERDICTS.join(', ')}`,
    'verdict',
  );
}
