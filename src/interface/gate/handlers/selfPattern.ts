// gate self-pattern — actor's behavioral bias surface across a window.
//
// Aggregates an actor's substrate footprint over a window: decision
// counts (approve/deny/execute/complete/fail), review verdict ratio
// (ok/concern/reject), and the top review lense the actor reached for.
//
// Aimed at the director / orchestrator role's introspection question:
// "what does my pattern look like? am I biased toward `concern`? am
// I always pulling the same lense? what fraction of my decisions are
// approvals vs denials?"
//
// Composes from existing substrate (status_log entries + reviews) —
// no schema change. Read-only.
//
// For the *full* lense distribution see `gate lense-stats --for <actor>`
// (#305). This verb surfaces the *top* lense only, as a bias hint;
// it does not try to be a second copy of lense-stats.
//
// Defaults to `--for <GUILD_ACTOR>` so a bare `gate self-pattern` from
// the calling actor's shell answers "show me my own pattern."

import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { C } from './internal.js';
import { parseDuration } from './lenseStats.js';
import { resolveGuildActor } from '../../shared/resolveGuildActor.js';

const SELF_PATTERN_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'for',
  'since',
  'format',
]);

type DecisionKind = 'approve' | 'deny' | 'execute' | 'complete' | 'fail';

export interface SelfPatternPayload {
  readonly window: { readonly since: string; readonly duration: string };
  readonly filter: { readonly actor: string };
  readonly decisions: {
    readonly total: number;
    readonly by_transition: Readonly<Record<DecisionKind, number>>;
  };
  readonly reviews: {
    readonly total: number;
    readonly by_verdict: Readonly<Record<string, number>>;
    readonly top_lense: string | null;
  };
  readonly ratios: {
    /** approve / (approve + deny). null when (approve + deny) === 0. */
    readonly approve_rate: number | null;
    /** ok / total reviews. null when no reviews in window. */
    readonly ok_rate: number | null;
  };
  readonly hint: string;
}

const STATE_TO_KIND: Readonly<Record<string, DecisionKind>> = {
  approved: 'approve',
  denied: 'deny',
  executing: 'execute',
  completed: 'complete',
  failed: 'fail',
};

export async function selfPatternCmd(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, SELF_PATTERN_KNOWN_FLAGS, 'self-pattern');
  const forActor = optionalOption(args, 'for') ?? resolveGuildActor() ?? null;
  if (!forActor) {
    throw new Error(
      'gate self-pattern: --for <actor> is required when GUILD_ACTOR is not set.' +
        '\n  next: pass --for <name>, or `export GUILD_ACTOR=<you>` once per shell.',
    );
  }
  const sinceRaw = optionalOption(args, 'since') ?? '7d';
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'text' && format !== 'json') {
    throw new Error(`--format must be 'text' or 'json', got: ${format}`);
  }

  const now = new Date();
  const sinceMs = parseDuration(sinceRaw);
  const cutoff = new Date(now.getTime() - sinceMs);
  const cutoffIso = cutoff.toISOString();

  const requests = await c.requestUC.listAll();

  const decisionCounts: Record<DecisionKind, number> = {
    approve: 0,
    deny: 0,
    execute: 0,
    complete: 0,
    fail: 0,
  };
  const verdictCounts: Record<string, number> = {};
  const lenseCounts = new Map<string, number>();
  let reviewTotal = 0;

  // Dedupe by (request_id, kind) — see decisions.ts for rationale.
  // Slice-closure emits an extra `executing` stamp on `gate complete
  // --by X`, which inflates raw counts. Director-axis question is
  // "distinct decisions" not "status_log entries".
  for (const r of requests) {
    const j = r.toJSON() as Record<string, unknown>;
    const id = String(j['id']);
    const log = Array.isArray(j['status_log']) ? j['status_log'] : [];
    const seen = new Set<string>();
    for (const e of log) {
      if (typeof e !== 'object' || e === null) continue;
      const rec = e as Record<string, unknown>;
      const at = typeof rec['at'] === 'string' ? (rec['at'] as string) : null;
      const by = typeof rec['by'] === 'string' ? (rec['by'] as string) : null;
      const state = typeof rec['state'] === 'string' ? (rec['state'] as string) : null;
      if (at === null || by === null || state === null) continue;
      if (by !== forActor) continue;
      if (at < cutoffIso) continue;
      const kind = STATE_TO_KIND[state];
      if (!kind) continue;
      const key = `${id}|${kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      decisionCounts[kind] += 1;
    }

    const reviews = Array.isArray(j['reviews']) ? j['reviews'] : [];
    for (const rv of reviews) {
      if (typeof rv !== 'object' || rv === null) continue;
      const rec = rv as Record<string, unknown>;
      const at = typeof rec['at'] === 'string' ? (rec['at'] as string) : null;
      const by = typeof rec['by'] === 'string' ? (rec['by'] as string) : null;
      const verdict = typeof rec['verdict'] === 'string' ? (rec['verdict'] as string) : null;
      const lense = typeof rec['lense'] === 'string' ? (rec['lense'] as string) : null;
      if (at === null || by === null || verdict === null || lense === null) continue;
      if (by !== forActor) continue;
      if (at < cutoffIso) continue;
      reviewTotal += 1;
      verdictCounts[verdict] = (verdictCounts[verdict] ?? 0) + 1;
      lenseCounts.set(lense, (lenseCounts.get(lense) ?? 0) + 1);
    }
  }

  // Top lense: highest count, ties broken alphabetically. null when
  // no reviews in window. Surface the most-reached-for lense as a
  // bias hint, not as a substitute for the full breakdown.
  let topLense: string | null = null;
  let topCount = -1;
  const lenseEntries = [...lenseCounts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
  if (lenseEntries.length > 0) {
    [topLense, topCount] = lenseEntries[0]!;
  }

  const decisionTotal =
    decisionCounts.approve +
    decisionCounts.deny +
    decisionCounts.execute +
    decisionCounts.complete +
    decisionCounts.fail;

  const apDeny = decisionCounts.approve + decisionCounts.deny;
  const approveRate = apDeny === 0 ? null : decisionCounts.approve / apDeny;
  const okRate =
    reviewTotal === 0 ? null : (verdictCounts['ok'] ?? 0) / reviewTotal;

  const payload: SelfPatternPayload = {
    window: { since: cutoffIso, duration: sinceRaw },
    filter: { actor: forActor },
    decisions: { total: decisionTotal, by_transition: decisionCounts },
    reviews: {
      total: reviewTotal,
      by_verdict: verdictCounts,
      top_lense: topLense,
    },
    ratios: { approve_rate: approveRate, ok_rate: okRate },
    hint: `see \`gate lense-stats --for ${forActor} --since ${sinceRaw}\` for the full lense distribution`,
  };

  if (format === 'json') {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(renderText(payload, topCount) + '\n');
  return 0;
}

function renderText(p: SelfPatternPayload, topLenseCount: number): string {
  const lines: string[] = [];
  lines.push(
    `self-pattern  actor=${p.filter.actor}  window=${p.window.duration}`,
  );
  lines.push(`since: ${p.window.since}`);
  lines.push('');
  const t = p.decisions.by_transition;
  lines.push(
    `decisions (${p.decisions.total}):  approve=${t.approve}  ` +
      `deny=${t.deny}  execute=${t.execute}  ` +
      `complete=${t.complete}  fail=${t.fail}`,
  );
  if (p.ratios.approve_rate !== null) {
    const pct = Math.round(p.ratios.approve_rate * 100);
    lines.push(`  approve_rate: ${pct}%  (approve / (approve+deny))`);
  }
  lines.push('');
  if (p.reviews.total === 0) {
    lines.push('reviews (0): (none in window)');
  } else {
    const verdictPairs = Object.entries(p.reviews.by_verdict)
      .sort((a, b) => b[1] - a[1])
      .map(([v, n]) => `${v}=${n}`)
      .join('  ');
    lines.push(`reviews (${p.reviews.total}):  ${verdictPairs}`);
    if (p.ratios.ok_rate !== null) {
      const pct = Math.round(p.ratios.ok_rate * 100);
      lines.push(`  ok_rate: ${pct}%`);
    }
    if (p.reviews.top_lense !== null) {
      lines.push(`  top lense: ${p.reviews.top_lense}  (${topLenseCount}×)`);
    }
  }
  lines.push('');
  lines.push(`hint: ${p.hint}`);
  return lines.join('\n');
}
