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

/**
 * Common aliases mapped to canonical categories. Same pattern as
 * severity/verdict: interface-layer convenience for users reaching
 * for natural-language forms. The canonical 6 are unchanged.
 */
const CATEGORY_ALIASES: Record<string, MemberCategory> = {
  pro: 'professional',
  prof: 'professional',
  member: 'professional', // most common default for a new agent
  assigned: 'assignee',
  try: 'trial',
  tryout: 'trial',
};

export function parseMemberCategory(value: string): MemberCategory {
  const normalized = value.trim().toLowerCase();
  if ((MEMBER_CATEGORIES as readonly string[]).includes(normalized)) {
    return normalized as MemberCategory;
  }
  const aliased = CATEGORY_ALIASES[normalized];
  if (aliased !== undefined) {
    return aliased;
  }
  throw new DomainError(
    [
      `Invalid member category: "${value}"`,
      `  canonical values: ${MEMBER_CATEGORIES.join(', ')}`,
      `  aliases:`,
      `    professional ← pro, prof, member`,
      `    assignee     ← assigned`,
      `    trial        ← try, tryout`,
      `  (case-insensitive, whitespace trimmed)`,
      `  Pick "professional" if you're not sure — it's the default for most agents.`,
    ].join('\n'),
    'category',
  );
}
