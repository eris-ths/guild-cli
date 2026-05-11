// gate wave-status — per-executor in-flight slice status for a
// multi-executor request (#295).
//
// Composes from existing substrate fields (no schema change for v1):
//   - executors[] — the wave's executor list
//   - witnessNotes / witnessSessions — most recent witness per actor
//     (note text + session_id; witness has no own timestamp)
//   - claimedBy / claimedAt — exclusive stake on the wave
//   - status_log — state transitions, used to infer per-executor
//     "last attributable activity" age (the witness-note age proxy
//     since witnesses themselves are untimestamped on this schema)
//
// Age-threshold disambiguation per the issue's acceptance criteria:
//   wave age since approve  → rendering
//   < 5 min                  no warning (fresh wave, witnesses may be incoming)
//   5-30 min                 "(in progress — no recent attributable write)"
//   ≥ 30 min, no witness     "⚠ stale — no in-flight progress note recorded"
//   ≥ 30 min, witness only   "⚠ stale — last witness has no timestamp; verify"
//
// v1 vs future:
//   v1 uses witness-inference + status_log timestamps. When #294
//   ships structured `executors[].status`, this verb pivots to read
//   that directly. The v1 shape is forward-compatible — each
//   executor entry already carries the fields a structured slice
//   would populate (`last_attributable_at`, `claim_held`, etc.).

import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { notFoundMessage } from '../../shared/notFoundHint.js';
import { C } from './internal.js';
import { Request } from '../../../domain/request/Request.js';

const WAVE_STATUS_KNOWN_FLAGS: ReadonlySet<string> = new Set(['format']);

/**
 * Age bands for the no-recent-attributable-write rendering. Hard-coded
 * as best-effort heuristics per the issue (configurable would be
 * over-engineering for v1).
 */
const FRESH_THRESHOLD_MS = 5 * 60 * 1000;
const STALE_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Per-executor slice view derived from substrate. `null` fields signal
 * absence (no witness note, no attributable activity yet, etc.) rather
 * than zero values that a consumer might confuse with "value present
 * but zero-shaped."
 *
 * `slice_status` is the per-executor terminal-status field introduced
 * by #294: 'pending' (open slice), 'completed' / 'failed' (slice closed
 * by this actor), or 'unknown' (legacy pre-#294 record where no slice
 * status was ever stamped — renderers should surface this as '?' so a
 * reader can distinguish "we don't know" from "we know it's still
 * pending"). `slice_note` is the optional close note from `gate
 * complete --note` / `gate fail --reason`.
 */
export interface WaveExecutorView {
  name: string;
  slice_status: 'pending' | 'completed' | 'failed' | 'unknown';
  slice_completed_at: string | null;
  slice_note: string | null;
  witness_note: string | null;
  witness_session: string | null;
  claim_held: boolean;
  /**
   * Most recent ISO timestamp attributable to this executor. Per #309,
   * the max of:
   *   - `witnessUpdatedAt[name]` (per-witness mutation timestamp)
   *   - latest `status_log` entry with `by: <name>`
   *   - `claimedAt` (only when claim is held by this executor)
   * Null when this executor has no attributable signal at all.
   */
  last_attributable_at: string | null;
  /**
   * Per-witness mutation timestamp (#309) — null when this executor
   * has not yet witnessed or the field is missing on a legacy record.
   * Exposed separately so a consumer can tell witness-driven freshness
   * apart from status_log-driven freshness when both are present.
   */
  witness_updated_at: string | null;
  /**
   * Per-executor freshness band (#309). Re-derived per executor from
   * `last_attributable_at` rather than the wave-age clock, so a fresh
   * witness on an aged wave does NOT trip stale.
   *
   * Values:
   *   - "fresh"        last_attributable_at < 5 min ago, OR
   *                    last_attributable_at is null AND wave age < 5 min
   *   - "in-progress"  5-30 min from last_attributable_at, or wave age
   *                    fallback in the same band
   *   - "stale"        > 30 min, or wave age > 30 with no signal
   *   - "active"       deprecated (#309 — kept for wire-format tolerance,
   *                    never emitted by post-#309 builds; readers that
   *                    decoded this from older records should treat it
   *                    as 'fresh')
   */
  activity_band: 'fresh' | 'in-progress' | 'stale' | 'active';
}

export interface WaveStatusPayload {
  id: string;
  state: string;
  from: string;
  executors: readonly WaveExecutorView[];
  age_ms: number | null;
  age_band: 'fresh' | 'in-progress' | 'stale';
  approved_at: string | null;
  /**
   * Per #309: wave-level stale is derived from "all executors stale",
   * NOT from wave_age > threshold. This separates "how long has this
   * been open?" (age_band) from "is anyone still working?" (this
   * field). Renderer footer uses this; downstream JSON consumers can
   * still read age_band for the open-duration question.
   *
   * True when every executor's activity_band is 'stale'. False when at
   * least one executor is 'fresh' or 'in-progress'. For a wave with no
   * executors, falls back to age_band === 'stale' (no per-executor
   * signal to aggregate over).
   */
  wave_stale_effective: boolean;
}

export async function waveStatusCmd(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, WAVE_STATUS_KNOWN_FLAGS, 'wave-status');
  const id = args.positional[0];
  if (!id) {
    throw new Error('Usage: gate wave-status <id> [--format text|json]');
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
  const payload = buildWaveStatus(r, new Date());
  if (format === 'json') {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    process.stdout.write(renderText(payload) + '\n');
  }
  return 0;
}

export function buildWaveStatus(r: Request, now: Date): WaveStatusPayload {
  const j = r.toJSON();
  const id = String(j['id']);
  const state = String(j['state']);
  const from = String(j['from']);
  // Slice B (#294): read executor slice status directly from the
  // domain. `executorRecords` carries the structured form (name +
  // status + completedAt + note); legacy pre-#294 records hydrate
  // with status='unknown' so the field is always defined.
  const records = r.executorRecords;
  const log = Array.isArray(j['status_log'])
    ? (j['status_log'] as Array<Record<string, unknown>>)
    : [];

  // Wave-age anchor: first `approved` entry in status_log (or null
  // when still pending — a pending wave has no age in this sense
  // because the approve step is what unblocks executor activity).
  const approvedEntry = log.find((e) => e['state'] === 'approved');
  const approvedAt =
    approvedEntry && typeof approvedEntry['at'] === 'string'
      ? (approvedEntry['at'] as string)
      : null;
  const ageMs =
    approvedAt !== null ? Math.max(0, now.getTime() - new Date(approvedAt).getTime()) : null;
  const ageBand: WaveStatusPayload['age_band'] = (() => {
    if (ageMs === null || ageMs < FRESH_THRESHOLD_MS) return 'fresh';
    if (ageMs < STALE_THRESHOLD_MS) return 'in-progress';
    return 'stale';
  })();

  const witnessNotes = r.witnessNotes; // ReadonlyMap<string, string>
  const witnessSessions = r.witnessSessions;
  const witnessUpdatedAt = r.witnessUpdatedAt; // ReadonlyMap<string, string> (#309)
  const claimedBy = r.claimedBy?.value;

  const executorViews: WaveExecutorView[] = records.map((rec) => {
    const name = rec.name.value;
    const note = witnessNotes.get(name) ?? null;
    const sess = witnessSessions.get(name) ?? null;
    const witAt = witnessUpdatedAt.get(name) ?? null;
    const claimHeld = claimedBy === name;

    // Per #309: last attributable write is the max of
    //   - witnessUpdatedAt[name]  (per-witness mutation timestamp)
    //   - latest status_log[by=name]
    //   - claimedAt (only if claim is held by this executor)
    // String compare on ISO-8601 is monotonic so plain `>` works.
    let lastAt: string | null = witAt;
    for (const e of log) {
      if (e['by'] === name && typeof e['at'] === 'string') {
        const at = e['at'] as string;
        if (lastAt === null || at > lastAt) lastAt = at;
      }
    }
    if (lastAt === null && claimHeld && r.claimedAt) {
      lastAt = r.claimedAt;
    }

    // Per-executor freshness band (#309): when lastAt is set, judge by
    // its age — NOT by the wave-age clock. A 2-min-old witness on a
    // 33-min-old wave is fresh, not stale. When lastAt is null, fall
    // back to wave age (the v1 behavior preserved for executors that
    // have produced no signal at all).
    const band: WaveExecutorView['activity_band'] = (() => {
      if (lastAt !== null) {
        const sinceMs = Math.max(0, now.getTime() - new Date(lastAt).getTime());
        if (sinceMs < FRESH_THRESHOLD_MS) return 'fresh';
        if (sinceMs < STALE_THRESHOLD_MS) return 'in-progress';
        return 'stale';
      }
      if (ageBand === 'fresh') return 'fresh';
      if (ageBand === 'in-progress') return 'in-progress';
      return 'stale';
    })();

    return {
      name,
      slice_status: rec.status,
      slice_completed_at: rec.completedAt ?? null,
      slice_note: rec.note ?? null,
      witness_note: note,
      witness_session: sess,
      claim_held: claimHeld,
      last_attributable_at: lastAt,
      witness_updated_at: witAt,
      activity_band: band,
    };
  });

  const waveStaleEffective =
    executorViews.length === 0
      ? ageBand === 'stale'
      : executorViews.every((e) => e.activity_band === 'stale');

  return {
    id,
    state,
    from,
    executors: executorViews,
    age_ms: ageMs,
    age_band: ageBand,
    approved_at: approvedAt,
    wave_stale_effective: waveStaleEffective,
  };
}

function renderText(p: WaveStatusPayload): string {
  const lines: string[] = [];
  const execNames = p.executors.map((e) => e.name).join(', ') || '(none)';
  lines.push(`wave ${p.id}  [${p.state}]  from=${p.from}  →  ${execNames}`);
  lines.push('');

  if (p.executors.length === 0) {
    lines.push('  (no executors assigned)');
    return lines.join('\n');
  }

  // Single-executor compact form: one summary line per executor, no
  // section heading. Keeps the verb useful for the common case rather
  // than emitting a 6-line block for a 1-actor wave.
  if (p.executors.length === 1) {
    const e = p.executors[0]!;
    lines.push(
      `executor: ${e.name}  ${renderSliceTag(e.slice_status)}` +
        (e.claim_held ? ' (claim_held)' : ''),
    );
    if (e.slice_note) {
      lines.push(`  note: ${flattenForRender(e.slice_note)}`);
    }
    if (e.witness_note) {
      lines.push(`  witness: ${flattenForRender(e.witness_note)}` + (e.witness_session ? `  [session=${e.witness_session}]` : ''));
    }
    if (e.slice_completed_at) {
      lines.push(`  closed at: ${e.slice_completed_at}`);
    } else if (e.last_attributable_at) {
      lines.push(`  last write: ${e.last_attributable_at}`);
    }
    lines.push('');
    lines.push(...renderAgeFooter(p));
    return lines.join('\n');
  }

  // Multi-executor: full per-executor block.
  lines.push('executors:');
  for (const e of p.executors) {
    const claim = e.claim_held ? '  [claim_held]' : '';
    const sess = e.witness_session ? `  session=${e.witness_session}` : '';
    lines.push(`  ${e.name}  ${renderSliceTag(e.slice_status)}${claim}${sess}`);
    if (e.slice_note) {
      lines.push(`    note: ${flattenForRender(e.slice_note)}`);
    }
    if (e.witness_note) {
      lines.push(`    witness: ${flattenForRender(e.witness_note)}`);
    }
    if (e.slice_completed_at) {
      lines.push(`    closed at: ${e.slice_completed_at}`);
    } else if (e.last_attributable_at) {
      // Show lastAt + freshness tag per #309 — a stale executor whose
      // last write is hours ago should not be silent just because it
      // has *some* lastAt set. v1 suppressed the stale marker whenever
      // any lastAt existed; v2 reads its age.
      lines.push(`    last write: ${e.last_attributable_at}`);
      if (e.activity_band === 'stale') {
        lines.push(`    ⚠ stale — last attributable write > 30 min ago`);
      }
    } else {
      // No lastAt → fall back to wave-age band. Same contract as v1.
      switch (e.activity_band) {
        case 'fresh':
          break;
        case 'in-progress':
          lines.push(`    (in progress — no recent attributable write)`);
          break;
        case 'stale':
          if (e.witness_note) {
            lines.push(`    ⚠ stale — witness recorded but no transition by this actor`);
          } else {
            lines.push(`    ⚠ stale — no in-flight progress note recorded`);
          }
          break;
        case 'active':
          // Legacy wire value; never emitted by post-#309 builds.
          break;
      }
    }
  }
  lines.push('');
  lines.push(...renderAgeFooter(p));
  return lines.join('\n');
}

function renderAgeFooter(p: WaveStatusPayload): string[] {
  if (p.age_ms === null) {
    return [`wave state: ${p.state}   (not yet approved — age undefined)`];
  }
  const ageHuman = formatDuration(p.age_ms);
  // Per #309: tag the footer with the *effective* stale signal — i.e.
  // "all executors stale", not "wave age > threshold". An old wave
  // with fresh executor activity is no longer mis-labeled.
  const bandTag = p.wave_stale_effective
    ? 'stale'
    : p.age_band === 'fresh'
      ? 'fresh'
      : 'in-progress';
  return [`wave state: ${p.state}   age: ${ageHuman} (${bandTag})`];
}

/**
 * Render the per-executor slice status as a compact bracketed tag.
 * 'unknown' renders as `[?]` so a reader can distinguish "we don't
 * know" (legacy pre-#294 record where no slice was ever stamped) from
 * `[pending]` (we know the slice is open and awaiting close). #294.
 */
/**
 * Strip newline / carriage-return from user-controlled note text before
 * rendering in text mode (#294 devil review §Security 1). The substrate
 * `sanitizeText` preserves `\n \t \r` for prose round-trip, but text-
 * mode renderers emit one note per line — a malicious or careless note
 * containing `\n  bob  [completed]` would inject a fake per-executor
 * line into operator output. Single-line render space-collapses the
 * note for display only; the stored YAML is unaffected.
 */
function flattenForRender(s: string): string {
  return s.replace(/[\r\n]+/g, ' ');
}

function renderSliceTag(s: WaveExecutorView['slice_status']): string {
  switch (s) {
    case 'pending':   return '[pending]';
    case 'completed': return '[completed]';
    case 'failed':    return '[failed]';
    case 'unknown':   return '[?]';
  }
}

function formatDuration(ms: number): string {
  if (ms < 60 * 1000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 60 * 60 * 1000) return `${Math.floor(ms / 60000)}m`;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const remMin = Math.floor((ms % (60 * 60 * 1000)) / 60000);
  return remMin > 0 ? `${hours}h${remMin}m` : `${hours}h`;
}
