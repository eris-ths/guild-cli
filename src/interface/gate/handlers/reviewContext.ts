// gate review-context — single read verb that bundles everything a
// reviewer (devil agent, CI script, human auditor) needs to drive
// behaviour from substrate state instead of from out-of-band prompt
// content (#310 Layer A).
//
// Today a depth-aware reviewer would shell out to
//   gate show <id> --format json | jq '.depth, .executors, .target'
// then jq the prior reviews from the same payload. That works but
// puts the reviewer in the business of knowing the on-disk shape.
// Centralising the "what does a reviewer want?" projection here lets
// the reviewer's prompt stay short and the substrate stay free to
// evolve its internal shape.
//
// Read-only. Composes from existing fields — no schema additions.

import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { notFoundMessage } from '../../shared/notFoundHint.js';
import { C } from './internal.js';
import { Request } from '../../../domain/request/Request.js';
import { RequestDepth } from '../../../domain/request/RequestDepth.js';

const REVIEW_CONTEXT_KNOWN_FLAGS: ReadonlySet<string> = new Set(['format']);

/**
 * Lense recommendation by depth. Encoded here (not in domain) because
 * the choice is policy that may evolve with reviewer practice — keeping
 * it at the interface layer lets the substrate remain advisory-only.
 *
 *   - shallow:  point-check with the highest-severity general lense.
 *   - standard: 6-lense default mirroring the published /devil contract.
 *   - deep:     all 10 lenses + memory MCP + state-machine trace.
 *
 * The reviewer is free to widen or narrow this set on a given run
 * (principle 02 — advisory not directive). The set is published so
 * the reviewer can record what it actually exercised against this
 * suggestion. A wave whose recorded depth was 'shallow' but whose
 * reviewer ran the 'deep' set should produce an audit-visible note.
 */
const LENSES_BY_DEPTH: Readonly<Record<RequestDepth, readonly string[]>> = {
  shallow: ['Logic'],
  standard: ['Logic', 'Pattern', 'Flow', 'Error', 'Test', 'Input'],
  deep: [
    'Logic',
    'Performance',
    'Flow',
    'Pattern',
    'Error',
    'Test',
    'Injection',
    'Auth',
    'Secrets',
    'Input',
  ],
};

/**
 * Extras the reviewer is invited to exercise at a given depth, beyond
 * the lense set itself. Surfaced separately so a deep reviewer sees
 * "memory MCP lookup + state-machine trace + prior-review cross-check"
 * as explicit obligations, not just lense names.
 */
const EXTRAS_BY_DEPTH: Readonly<Record<RequestDepth, readonly string[]>> = {
  shallow: [],
  standard: [],
  deep: [
    'memory_mcp_trap_lookup',
    'state_machine_trace',
    'prior_review_cross_check',
  ],
};

export interface ReviewContextPayload {
  id: string;
  state: string;
  from: string;
  action: string;
  reason: string;
  target: string | null;
  executors: readonly string[];
  /** Recorded depth advisory (#221). `null` when the wave was created
   *  without `--depth` and never re-stamped — reviewer should treat
   *  as standard and surface a warning. */
  depth: RequestDepth | null;
  /** Recommended lense set derived from depth. Empty when `depth` is
   *  null (reviewer falls back to its own default but can record the
   *  drift). */
  recommended_lenses: readonly string[];
  /** Extras (memory lookup, trace, cross-check) the reviewer is
   *  invited to exercise at this depth. */
  recommended_extras: readonly string[];
  /** Prior reviews on this record. Lets a deep reviewer cross-check
   *  earlier verdicts without a second `gate show` call. */
  prior_reviews: readonly {
    by: string;
    lense: string;
    verdict: string;
    at: string;
    comment: string | null;
  }[];
  /** Advisory the operator/agent should see in the reviewer's preamble
   *  when no depth is recorded. Empty string when depth is set. */
  warning: string;
}

export async function reviewContextCmd(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, REVIEW_CONTEXT_KNOWN_FLAGS, 'review-context');
  const id = args.positional[0];
  if (!id) {
    throw new Error('Usage: gate review-context <id> [--format text|json]');
  }
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'text' && format !== 'json') {
    throw new Error(`--format must be 'text' or 'json', got: ${format}`);
  }
  const r = await c.requestUC.show(id);
  if (!r) {
    process.stderr.write(notFoundMessage('request', id));
    return 1;
  }
  const payload = buildReviewContext(r);
  if (format === 'json') {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    process.stdout.write(renderText(payload) + '\n');
  }
  return 0;
}

export function buildReviewContext(r: Request): ReviewContextPayload {
  const j = r.toJSON();
  const depth: RequestDepth | null =
    typeof j['depth'] === 'string'
      ? (j['depth'] as RequestDepth)
      : null;
  const effective: RequestDepth = depth ?? 'standard';
  const reviews = r.reviews.map((rv) => ({
    by: rv.by.value,
    lense: rv.lense,
    verdict: rv.verdict,
    at: rv.at,
    comment: rv.comment ?? null,
  }));
  const execNames = r.executors.map((m) => m.value);
  return {
    id: String(j['id']),
    state: String(j['state']),
    from: String(j['from']),
    action: String(j['action'] ?? ''),
    reason: String(j['reason'] ?? ''),
    target: typeof j['target'] === 'string' ? (j['target'] as string) : null,
    executors: execNames,
    depth,
    recommended_lenses: depth === null ? [] : LENSES_BY_DEPTH[effective],
    recommended_extras: depth === null ? [] : EXTRAS_BY_DEPTH[effective],
    prior_reviews: reviews,
    warning:
      depth === null
        ? 'no depth recorded on this wave — reviewer should default to standard ' +
          'lense set and surface the missing advisory in its preamble (#310 #221)'
        : '',
  };
}

function renderText(p: ReviewContextPayload): string {
  const lines: string[] = [];
  lines.push(`review-context ${p.id}  [${p.state}]  from=${p.from}`);
  lines.push(`  action: ${p.action}`);
  if (p.reason) lines.push(`  reason: ${p.reason}`);
  if (p.target) lines.push(`  target: ${p.target}`);
  if (p.executors.length > 0) {
    lines.push(`  executors: ${p.executors.join(', ')}`);
  }
  lines.push('');
  lines.push(`depth: ${p.depth ?? '(not recorded)'}`);
  if (p.warning) lines.push(`  ⚠ ${p.warning}`);
  if (p.recommended_lenses.length > 0) {
    lines.push(`  recommended lenses: ${p.recommended_lenses.join(', ')}`);
  }
  if (p.recommended_extras.length > 0) {
    lines.push(`  recommended extras: ${p.recommended_extras.join(', ')}`);
  }
  if (p.prior_reviews.length > 0) {
    lines.push('');
    lines.push(`prior reviews (${p.prior_reviews.length}):`);
    for (const rv of p.prior_reviews) {
      lines.push(
        `  ${rv.at}  by=${rv.by}  lense=${rv.lense}  verdict=${rv.verdict}`,
      );
      if (rv.comment) {
        lines.push(`    ${rv.comment.replace(/[\r\n]+/g, ' ')}`);
      }
    }
  } else {
    lines.push('');
    lines.push(`prior reviews: (none)`);
  }
  return lines.join('\n');
}
