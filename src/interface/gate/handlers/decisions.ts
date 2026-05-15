// gate decisions — actor's authored state transitions in a window.
//
// Sibling of `gate voices` (review-shaped) and `gate lense-stats`
// (lense-shaped). This verb is decision-shaped: it surfaces the
// approve / deny / execute / complete / fail transitions an actor
// performed against the substrate, with one row per transition.
//
// Built for the director / orchestrator role: "what have I decided
// recently?" is answered in one verb rather than by grepping
// `gate voices --by <me>` output for state lines or walking
// `gate list --state <s>` per state.
//
// `--for <actor>` filters by author of the transition (status_log[i].by).
// Default: GUILD_ACTOR — `gate decisions` with no flags answers
// "what have I decided in the last 7 days?" out of the box.
//
// `--since <duration>` accepts `7d`, `24h`, `30m`, `45s`. Default 7d.
//
// Read-only: no mutation, no state transitions. LOCK_EXEMPT-eligible
// but registered as READ for now.

import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { C, parseOptionalIntOption } from './internal.js';
import { parseDuration } from './lenseStats.js';
import { resolveGuildActor } from '../../shared/resolveGuildActor.js';
import { parseFormat } from '../../shared/parseFormat.js';

// limit: sibling gate-voices accepts --limit; aligning here removes a
// cross-verb inconsistency. Applied post-sort so the most-recent N survive.
const DECISIONS_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'for',
  'since',
  'format',
  'limit',
]);

/**
 * The five transition kinds this verb surfaces. `pending` (creation)
 * is intentionally excluded — request authorship is `gate voices`'s
 * job. `approved` / `denied` / `executing` / `completed` / `failed`
 * are decisions an actor *made*, in the sense the director would
 * audit.
 */
export type DecisionKind =
  | 'approve'
  | 'deny'
  | 'execute'
  | 'complete'
  | 'fail';

export interface DecisionRow {
  readonly at: string;
  readonly request_id: string;
  readonly transition: DecisionKind;
  readonly note: string | null;
}

export interface DecisionsPayload {
  readonly window: { readonly since: string; readonly duration: string };
  readonly filter: { readonly actor: string };
  readonly totals: {
    readonly entries_counted: number;
    readonly by_transition: Readonly<Record<DecisionKind, number>>;
  };
  readonly decisions: readonly DecisionRow[];
}

const STATE_TO_KIND: Readonly<Record<string, DecisionKind>> = {
  approved: 'approve',
  denied: 'deny',
  executing: 'execute',
  completed: 'complete',
  failed: 'fail',
};

export async function decisionsCmd(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, DECISIONS_KNOWN_FLAGS, 'decisions');
  const forActor = optionalOption(args, 'for') ?? resolveGuildActor() ?? null;
  if (!forActor) {
    throw new Error(
      '--for <actor> is required when GUILD_ACTOR is not set.' +
        '\n  next: pass --for <name>, or `export GUILD_ACTOR=<you>` once per shell.',
    );
  }
  const sinceRaw = optionalOption(args, 'since') ?? '7d';
  const format = parseFormat(args);

  const now = new Date();
  const sinceMs = parseDuration(sinceRaw);
  const cutoff = new Date(now.getTime() - sinceMs);
  const cutoffIso = cutoff.toISOString();

  const requests = await c.requestUC.listAll();
  // Dedupe by (request_id, transition) for the calling actor — the
  // #294 slice-closure path emits a second `executing` status_log
  // entry on `gate complete --by X` (slice-close stamp), so a raw
  // count over status_log inflates "executes" by 1 for every slice
  // that closes. From a director's audit perspective the question
  // is "how many distinct decisions did I make?", not "how many
  // status_log entries did I write?". Keep the latest entry per
  // tuple (later note wins; later `at` wins ties).
  const dedup = new Map<string, DecisionRow>();
  for (const r of requests) {
    const j = r.toJSON() as Record<string, unknown>;
    const id = String(j['id']);
    const log = Array.isArray(j['status_log']) ? j['status_log'] : [];
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
      const note = typeof rec['note'] === 'string' ? (rec['note'] as string) : null;
      const key = `${id}|${kind}`;
      const cur = dedup.get(key);
      if (cur === undefined || at >= cur.at) {
        dedup.set(key, { at, request_id: id, transition: kind, note });
      }
    }
  }
  const rows: DecisionRow[] = [...dedup.values()];

  // Sort by `at` desc so the most-recent decision is first — same axis
  // a director would scan when answering "what did I just do?".
  rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const limit = parseOptionalIntOption(args, 'limit');
  // entries_counted reflects pre-truncation total so the caller can tell
  // whether more existed past --limit (don't lie about source size).
  const totalRowsBeforeLimit = rows.length;
  const truncatedRows =
    limit !== undefined && limit >= 0 ? rows.slice(0, limit) : rows;

  const byTransition: Record<DecisionKind, number> = {
    approve: 0,
    deny: 0,
    execute: 0,
    complete: 0,
    fail: 0,
  };
  for (const r of rows) byTransition[r.transition] += 1;

  const payload: DecisionsPayload = {
    window: { since: cutoffIso, duration: sinceRaw },
    filter: { actor: forActor },
    totals: {
      entries_counted: totalRowsBeforeLimit,
      by_transition: byTransition,
    },
    decisions: truncatedRows,
  };

  if (format === 'json') {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(renderText(payload) + '\n');
  return 0;
}

function renderText(p: DecisionsPayload): string {
  const lines: string[] = [];
  lines.push(
    `decisions  actor=${p.filter.actor}  window=${p.window.duration}  ` +
      `entries=${p.totals.entries_counted}`,
  );
  lines.push(`since: ${p.window.since}`);
  lines.push('');
  const t = p.totals.by_transition;
  lines.push(
    `  approve: ${t.approve}   deny: ${t.deny}   execute: ${t.execute}   ` +
      `complete: ${t.complete}   fail: ${t.fail}`,
  );
  if (p.decisions.length === 0) {
    lines.push('');
    lines.push(
      '(no decisions in window — try a longer --since, or check --for is correct)',
    );
    return lines.join('\n');
  }
  lines.push('');
  for (const r of p.decisions) {
    const noteSuffix = r.note ? `  — ${r.note.replace(/[\r\n]+/g, ' ')}` : '';
    lines.push(`  ${r.at}  ${r.request_id}  ${r.transition}${noteSuffix}`);
  }
  return lines.join('\n');
}
