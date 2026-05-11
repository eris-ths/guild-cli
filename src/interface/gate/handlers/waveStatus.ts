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
   * Most recent ISO timestamp in `status_log` attributable to this
   * executor (state transitions they performed). Null when they have
   * never touched the wave from their own `--by`. Witness notes are
   * untimestamped on the current schema so cannot contribute to this
   * field — only state transitions do.
   */
  last_attributable_at: string | null;
  /**
   * One-line rendering hint for text format. Computed from the wave
   * age + per-executor activity so the text renderer doesn't have to
   * re-derive the policy.
   *
   * Values:
   *   - "fresh"        wave < 5 min old; suppress warning
   *   - "in-progress"  5-30 min old; neutral
   *   - "stale"        ≥ 30 min old; surface the ⚠ stale line
   *   - "active"       executor has at least one attributable write
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
  const claimedBy = r.claimedBy?.value;

  const executorViews: WaveExecutorView[] = records.map((rec) => {
    const name = rec.name.value;
    const note = witnessNotes.get(name) ?? null;
    const sess = witnessSessions.get(name) ?? null;
    const claimHeld = claimedBy === name;

    // Last attributable write: max ISO timestamp in status_log where
    // `by === name`. Fallback to claimedAt only when claim is held by
    // this executor AND no status_log entry exists (claim is the
    // earliest verifiable activity in that case).
    let lastAt: string | null = null;
    for (const e of log) {
      if (e['by'] === name && typeof e['at'] === 'string') {
        const at = e['at'] as string;
        if (lastAt === null || at > lastAt) lastAt = at;
      }
    }
    if (lastAt === null && claimHeld && r.claimedAt) {
      lastAt = r.claimedAt;
    }

    const band: WaveExecutorView['activity_band'] = (() => {
      if (lastAt !== null) return 'active';
      // No attributable write yet — fall back to wave age.
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
      activity_band: band,
    };
  });

  return {
    id,
    state,
    from,
    executors: executorViews,
    age_ms: ageMs,
    age_band: ageBand,
    approved_at: approvedAt,
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
      lines.push(`  note: ${e.slice_note}`);
    }
    if (e.witness_note) {
      lines.push(`  witness: ${e.witness_note}` + (e.witness_session ? `  [session=${e.witness_session}]` : ''));
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
      lines.push(`    note: ${e.slice_note}`);
    }
    if (e.witness_note) {
      lines.push(`    witness: ${e.witness_note}`);
    }
    if (e.slice_completed_at) {
      lines.push(`    closed at: ${e.slice_completed_at}`);
    } else if (e.last_attributable_at) {
      lines.push(`    last write: ${e.last_attributable_at}`);
    } else {
      // Per-executor band-driven rendering. The age-threshold contract
      // from the issue lives here — different text for fresh / in-
      // progress / stale so a just-approved wave isn't unfairly flagged.
      switch (e.activity_band) {
        case 'fresh':
          // Suppress noise on a fresh wave; the executor may simply
          // not have witnessed yet.
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
          // Should not reach here (active implies last_attributable_at
          // is set), but cover it explicitly.
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
  const bandTag =
    p.age_band === 'fresh'
      ? 'fresh'
      : p.age_band === 'in-progress'
        ? 'in-progress'
        : 'stale';
  return [`wave state: ${p.state}   age: ${ageHuman} (${bandTag})`];
}

/**
 * Render the per-executor slice status as a compact bracketed tag.
 * 'unknown' renders as `[?]` so a reader can distinguish "we don't
 * know" (legacy pre-#294 record where no slice was ever stamped) from
 * `[pending]` (we know the slice is open and awaiting close). #294.
 */
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
