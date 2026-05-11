// flowSuggest — pure advisory rule engine for `gate flow-suggest`.
//
// Purpose: given severity + area (+ optional scope), recommend ONE of
// three flows so the operator doesn't have to re-derive the trade-off
// each time. Substrate-free — no I/O, no state. The verb that wraps
// this is read-only and the engine is a single lookup function.
//
// Why a dedicated module (not inlined in the handler): the rule table
// is the thing future PRs will extend (issue #307 implementation note
// flagged guild.config.yaml override as a v2 follow-up). Keeping the
// rule logic in `application/` lets it be imported and exercised by
// tests without touching the CLI surface, and lets a future override
// layer (config-driven rule merge) wrap this same pure function.
//
// Design choice — explicit if/else over data-driven match table:
// the rule table from #307 is small (three default rows) and reads
// as a flat list of guards. A switch/table would compress the code
// but obscure the precedence: "high severity in a security-adjacent
// area beats everything else." Branching keeps that precedence as
// the literal order of `if` statements, which is what reviewers will
// audit.

/** All three recommended flows the engine can return. */
export type FlowRecommendation = 'fast-track' | 'direct-pr' | 'full-request';

/** Severity classification (mirrors `gate issues add --severity` enum). */
export type FlowSeverity = 'low' | 'med' | 'high';

/** Area tag — open string, not an enum: callers pass arbitrary domain
 * tags (copy/doc/style/bug/auth/data/security/...). The engine
 * categorises by membership in known buckets and falls back to
 * `full-request` for anything it doesn't recognise (conservative). */
export type FlowArea = string;

/** Scope hint — optional, advisory. Not load-bearing in v1 (the rule
 * table doesn't branch on it), but plumbed through so the JSON
 * output can echo it back and a v2 rule layer can use it without a
 * second signature change. */
export type FlowScope = 'single-file' | 'multi-file' | 'multi-pr' | string;

export interface FlowSuggestInput {
  severity: FlowSeverity;
  area: FlowArea;
  scope?: FlowScope;
}

export interface FlowSuggestResult {
  recommended: FlowRecommendation;
  reason: string;
  alternatives: FlowRecommendation[];
}

// Area buckets. Lower-cased on the way in; callers may pass mixed
// case freely (`Auth`, `COPY`) without surprising the engine.
const COSMETIC_AREAS: ReadonlySet<string> = new Set([
  'copy',
  'doc',
  'docs',
  'style',
]);

const BUG_AREAS: ReadonlySet<string> = new Set(['bug', 'fix']);

const HIGH_RISK_AREAS: ReadonlySet<string> = new Set([
  'security',
  'auth',
  'data',
]);

/**
 * Decide which flow to recommend for a (severity, area, scope) tuple.
 *
 * Precedence — the order of these branches is the rule:
 *   1. high severity in a high-risk area (security/auth/data) →
 *      full-request. The blast radius justifies the ceremony.
 *   2. low severity in a cosmetic area (copy/doc/style) →
 *      direct-pr. The most common dogfood friction (#307 motivation).
 *   3. low/med severity bug → fast-track. Bug fixes that aren't a
 *      compliance issue benefit from a single-pass record without a
 *      full agora play.
 *   4. anything else → full-request. The conservative default: when
 *      the engine doesn't recognise the shape, pay the ceremony cost
 *      rather than skip a step the situation might need.
 */
export function suggestFlow(input: FlowSuggestInput): FlowSuggestResult {
  const severity = input.severity;
  const area = input.area.toLowerCase();
  const scope = input.scope?.toLowerCase();

  // 1. high-risk area at any meaningful severity → full ceremony.
  if (HIGH_RISK_AREAS.has(area) && severity === 'high') {
    return {
      recommended: 'full-request',
      reason:
        `severity=${severity} + area=${area} → high-risk area at high ` +
        `severity, run the full request → review → ship flow.`,
      alternatives: ['fast-track'],
    };
  }

  // 2. low + cosmetic → direct PR, skip the gate ceremony entirely.
  if (severity === 'low' && COSMETIC_AREAS.has(area)) {
    const scopePart = scope ? ` + scope=${scope}` : '';
    return {
      recommended: 'direct-pr',
      reason:
        `severity=${severity} + area=${area}${scopePart} → cosmetic ` +
        `low-severity change, a direct PR is enough.`,
      alternatives: ['fast-track', 'full-request'],
    };
  }

  // 3. low/med bug → fast-track (single-pass record, no agora).
  if ((severity === 'low' || severity === 'med') && BUG_AREAS.has(area)) {
    return {
      recommended: 'fast-track',
      reason:
        `severity=${severity} + area=${area} → routine bug fix, ` +
        `fast-track records the change without a full request cycle.`,
      alternatives: ['full-request'],
    };
  }

  // 4. fall-through: be conservative. The recommendation here covers
  //    every shape the rule table doesn't claim — including high
  //    severity in non-high-risk areas, med severity in cosmetic /
  //    unknown areas, and any area the engine doesn't know about.
  return {
    recommended: 'full-request',
    reason:
      `severity=${severity} + area=${area} → no specific rule matched, ` +
      `defaulting to full request flow (issue → review → ship).`,
    alternatives: ['fast-track'],
  };
}
