// gate lense-stats — lense rotation diagnostic (#305).
//
// Counts how many review entries were recorded against each lense in
// the given window, then highlights the most-frequent ("most") and
// least-frequent ("least", among lenses with ≥ 1 use) so the operator
// can spot bias: "I keep hitting auth-access; have I run devil or
// composition lately?"
//
// Two record sources contribute to the same totals:
//   1. gate `Request.reviews[]` — every `gate review --lense <l>` write
//      records a review with `at` + `lense`. Filtered by `at` window.
//   2. devil `DevilReview.entries[]` — every `devil entry --lense <l>`
//      records a domain Entry with `at` + `lense` + `kind`. All kinds
//      are counted (finding/assumption/resistance/skip/synthesis/gate)
//      because every entry committed *to a lense* counts as the
//      reviewer touching that axis. Filtered by entry `at`.
//
// `--for <actor>` filters by author (review.by / entry.by). Default:
// every actor in the content_root.
//
// `--since <duration>` accepts: `7d`, `24h`, `30m`, `45s`. Bare integer
// + suffix only — the v0 parser keeps the surface minimal. Default
// window: 7d.
//
// Read-only: no on-disk mutation, no state transitions. Safe to call
// any time; LOCK_EXEMPT-eligible but registered as READ for now (the
// shared lock middleware allows concurrent reads).

import { join } from 'node:path';
import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { C } from './internal.js';
import { YamlDevilReviewRepository } from '../../../passages/devil/infrastructure/YamlDevilReviewRepository.js';
import { parseFormat } from '../../shared/parseFormat.js';

const LENSE_STATS_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'for',
  'since',
  'format',
]);

/**
 * Per-lense count plus optional `last_at` (most-recent ISO timestamp
 * seen in the window). `last_at` is null when the lense has zero hits
 * — it's a 0-count entry only included when the lense is in the
 * catalog. Empty lenses still appear in the stats so a reader can see
 * "composition: 0" rather than guessing whether composition exists.
 */
export interface LenseStat {
  readonly lense: string;
  readonly count: number;
  readonly last_at: string | null;
  readonly sources: {
    readonly gate_reviews: number;
    readonly devil_entries: number;
  };
}

export interface LenseStatsPayload {
  readonly window: {
    readonly since: string; // ISO timestamp; "all-time" rendered as a literal sentinel below
    readonly duration: string; // the raw `--since` value, e.g. "7d"
  };
  readonly filter: {
    readonly actor: string | null;
  };
  readonly totals: {
    readonly entries_counted: number;
    readonly lenses_with_use: number;
  };
  readonly most: string | null; // most-frequent lense in window; null when totals.entries_counted === 0
  readonly least: string | null; // least-frequent *with ≥ 1 use*; null when totals === 0
  readonly stats: readonly LenseStat[]; // sorted by count desc, then lense name asc
}

export async function lenseStatsCmd(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, LENSE_STATS_KNOWN_FLAGS, 'lense-stats');
  const forActor = optionalOption(args, 'for') ?? null;
  const sinceRaw = optionalOption(args, 'since') ?? '7d';
  const format = parseFormat(args);

  const now = new Date();
  const sinceMs = parseDuration(sinceRaw);
  const cutoff = new Date(now.getTime() - sinceMs);
  const cutoffIso = cutoff.toISOString();

  // Source 1: gate reviews. Walk every request and filter its reviews.
  const requests = await c.requestUC.listAll();
  // tally[lense] = { gate, devil, lastAt }
  const tally = new Map<
    string,
    { gate: number; devil: number; lastAt: string | null }
  >();
  const bump = (
    lense: string,
    field: 'gate' | 'devil',
    at: string,
  ): void => {
    const cur = tally.get(lense) ?? { gate: 0, devil: 0, lastAt: null };
    cur[field] += 1;
    if (cur.lastAt === null || at > cur.lastAt) cur.lastAt = at;
    tally.set(lense, cur);
  };

  for (const r of requests) {
    const j = r.toJSON() as Record<string, unknown>;
    const reviews = Array.isArray(j['reviews']) ? j['reviews'] : [];
    for (const rv of reviews) {
      if (typeof rv !== 'object' || rv === null) continue;
      const rec = rv as Record<string, unknown>;
      const at = typeof rec['at'] === 'string' ? (rec['at'] as string) : null;
      const lense = typeof rec['lense'] === 'string' ? (rec['lense'] as string) : null;
      const by = typeof rec['by'] === 'string' ? (rec['by'] as string) : null;
      if (at === null || lense === null) continue;
      if (at < cutoffIso) continue;
      if (forActor !== null && by !== forActor) continue;
      bump(lense, 'gate', at);
    }
  }

  // Source 2: devil-passage reviews. Iterate every review file under
  // <content_root>/devil/reviews/ and tally its entries.
  // ad-hoc repo construction (the gate container doesn't carry one).
  // Missing directory is a no-op — a content_root that has never seen
  // a devil review just contributes zero to the totals.
  const devilRepo = new YamlDevilReviewRepository(c.config);
  // Safety: listAll already routes through onMalformed for hydrate
  // failures, so a tampered review file is dropped not propagated.
  // Wrapping in try/catch defends against the dir-not-found case;
  // listDirSafe already returns [] there, so this is belt + braces.
  let devilReviews: Awaited<ReturnType<typeof devilRepo.listAll>> = [];
  try {
    devilReviews = await devilRepo.listAll();
  } catch {
    devilReviews = [];
  }
  for (const dr of devilReviews) {
    for (const e of dr.entries) {
      if (e.at < cutoffIso) continue;
      if (forActor !== null && e.by !== forActor) continue;
      bump(e.lense, 'devil', e.at);
    }
  }

  // Build stats. Include catalog lenses with zero hits so the operator
  // sees "composition: 0" rather than guessing what's missing.
  const catalogLenses = new Set<string>(c.config.lenses);
  for (const lense of tally.keys()) catalogLenses.add(lense);
  const stats: LenseStat[] = [];
  for (const lense of catalogLenses) {
    const t = tally.get(lense);
    const gate = t?.gate ?? 0;
    const devil = t?.devil ?? 0;
    stats.push({
      lense,
      count: gate + devil,
      last_at: t?.lastAt ?? null,
      sources: { gate_reviews: gate, devil_entries: devil },
    });
  }
  stats.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.lense.localeCompare(b.lense);
  });

  const totalEntries = stats.reduce((s, x) => s + x.count, 0);
  const used = stats.filter((s) => s.count > 0);
  const most = used.length > 0 ? used[0]!.lense : null;
  // Least: lowest count among used lenses. Sorted desc, so the last
  // used-row is the minimum. Ties broken alphabetically by the sort
  // above, so "least" is deterministic.
  const least = used.length > 0 ? used[used.length - 1]!.lense : null;

  const payload: LenseStatsPayload = {
    window: { since: cutoffIso, duration: sinceRaw },
    filter: { actor: forActor },
    totals: {
      entries_counted: totalEntries,
      lenses_with_use: used.length,
    },
    most,
    least,
    stats,
  };

  if (format === 'json') {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(renderText(payload) + '\n');
  return 0;
}

/**
 * Parse a duration string like `7d`, `24h`, `30m`, `45s` to ms.
 * Bare integer + single-char suffix only. Negative / zero / unknown
 * suffix → throws. The v0 surface is deliberately tiny — agents that
 * want richer windows can compose by passing a specific ISO cutoff
 * once an `--at` flag lands.
 */
export function parseDuration(raw: string): number {
  const m = raw.match(/^(\d+)([smhd])$/);
  if (!m) {
    throw new Error(
      `--since must match <int><s|m|h|d>, got: ${raw}` +
        `\n  next: try --since 7d, --since 24h, --since 30m, or --since 45s`,
    );
  }
  const n = parseInt(m[1] as string, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--since duration must be a positive integer, got: ${raw}`);
  }
  switch (m[2]) {
    case 's':
      return n * 1000;
    case 'm':
      return n * 60 * 1000;
    case 'h':
      return n * 60 * 60 * 1000;
    case 'd':
      return n * 24 * 60 * 60 * 1000;
  }
  // unreachable — regex constrains suffix to [smhd]
  throw new Error(`unreachable suffix in --since: ${raw}`);
}

function renderText(p: LenseStatsPayload): string {
  const lines: string[] = [];
  const actorTag = p.filter.actor ? `  actor=${p.filter.actor}` : '';
  lines.push(
    `lense-stats  window=${p.window.duration}${actorTag}  ` +
      `entries=${p.totals.entries_counted}  ` +
      `lenses_with_use=${p.totals.lenses_with_use}`,
  );
  lines.push(`since: ${p.window.since}`);
  lines.push('');
  if (p.totals.entries_counted === 0) {
    lines.push(
      '(no review entries in window — try a longer --since or check --for)',
    );
    return lines.join('\n');
  }
  // Width for tidy alignment. Cap at 24 so a long custom lense name
  // doesn't push the count column off-screen.
  const widest = Math.min(
    24,
    Math.max(8, ...p.stats.map((s) => s.lense.length)),
  );
  for (const s of p.stats) {
    const name = s.lense.padEnd(widest, ' ');
    const tag =
      s.lense === p.most && s.lense === p.least
        ? '  (only)'
        : s.lense === p.most
          ? '  ← most'
          : s.lense === p.least
            ? '  ← least'
            : '';
    const breakdown =
      s.count > 0
        ? `  (gate=${s.sources.gate_reviews} devil=${s.sources.devil_entries})`
        : '';
    lines.push(`  ${name}  ${String(s.count).padStart(4)}${breakdown}${tag}`);
  }
  // Touch-feel "next:" hint — point the operator at the rotation
  // gap when one lense dominates.
  if (p.most && p.least && p.most !== p.least) {
    const top = p.stats.find((s) => s.lense === p.most);
    const bot = p.stats.find((s) => s.lense === p.least);
    if (top && bot && top.count >= bot.count * 3 && top.count >= 3) {
      lines.push('');
      lines.push(
        `  next: ${p.most} is dominating (${top.count} vs ${bot.count} on ${p.least}). ` +
          `consider a ${p.least}-lense review on the next slice.`,
      );
    }
  }
  return lines.join('\n');
}

// Re-export the path constant pattern uses (kept for tests that want
// to assert on the devil reviews dir without re-deriving it).
export const DEVIL_REVIEWS_REL = join('devil', 'reviews');
