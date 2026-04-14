import { DomainError } from '../shared/DomainError.js';

export const MEMBER_CATEGORIES = [
  'core',
  'professional',
  'assignee',
  'trial',
  'special',
  'host',
] as const;

export type MemberCategory = (typeof MEMBER_CATEGORIES)[number];

export function parseMemberCategory(value: string): MemberCategory {
  if ((MEMBER_CATEGORIES as readonly string[]).includes(value)) {
    return value as MemberCategory;
  }
  throw new DomainError(
    `Invalid member category: "${value}". Must be one of: ${MEMBER_CATEGORIES.join(', ')}`,
    'category',
  );
}
