import { DomainError } from './DomainError.js';

export const VERDICTS = ['ok', 'concern', 'reject'] as const;
export type Verdict = (typeof VERDICTS)[number];

/**
 * Common aliases mapped to canonical verdicts. Reviewers routinely
 * reach for `concerned` (the adjective) before `concern` (the noun),
 * or for GitHub-muscle-memory like `approved` / `lgtm` / `block`.
 * This shows up especially often in AI-agent reviews, where the
 * model's language instinct produces the grammatical form rather
 * than the canonical noun.
 *
 * The canonical set (`ok | concern | reject`) is unchanged; aliases
 * are normalized on input so the domain invariant is preserved.
 * Matching is case-insensitive after trim.
 */
const VERDICT_ALIASES: Record<string, Verdict> = {
  // ok family
  approve: 'ok',
  approved: 'ok',
  pass: 'ok',
  passed: 'ok',
  lgtm: 'ok',
  yes: 'ok',
  y: 'ok',
  // concern family (grammatical variants + soft warnings)
  concerned: 'concern',
  concerning: 'concern',
  worry: 'concern',
  worried: 'concern',
  warn: 'concern',
  warning: 'concern',
  // reject family (hard blockers)
  rejected: 'reject',
  block: 'reject',
  blocked: 'reject',
  no: 'reject',
  n: 'reject',
  veto: 'reject',
};

export function parseVerdict(value: string): Verdict {
  const normalized = value.trim().toLowerCase();
  if ((VERDICTS as readonly string[]).includes(normalized)) {
    return normalized as Verdict;
  }
  const aliased = VERDICT_ALIASES[normalized];
  if (aliased !== undefined) {
    return aliased;
  }
  throw new DomainError(
    `Invalid verdict: "${value}". Must be one of: ${VERDICTS.join(', ')} ` +
      `(aliases accepted: approve/approved/pass/lgtm→ok, ` +
      `concerned/warn/worried→concern, rejected/block/veto→reject, ` +
      `plus case variants).`,
    'verdict',
  );
}
