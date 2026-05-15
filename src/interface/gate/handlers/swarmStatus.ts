// gate swarm-status — cross-wave director / participant view for swarm
// coordination (#346).
//
// Closes the principle-14 loop. `gate wave-status <id>` answers
// per-wave state; `gate board` answers per-state status; `gate boot`'s
// overlap surface (#234) detects cross-wave overlap on targets — but
// no single read returned "the current swarm picture" without the
// caller composing 1 + N + N×M sub-reads. This verb returns it as
// one envelope.
//
// Routing rationale (principle 15): director-axis reads belong in
// core so AI agents reading `gate schema` discover them; this is the
// sibling of `gate decisions` (decision-shaped), `gate next` (action-
// shaped), and `gate suggest` (orientation-shaped). Composes existing
// substrate primitives — no new domain field is stamped by this verb.

import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { resolveGuildActor } from '../../shared/resolveGuildActor.js';
import { C } from './internal.js';
import { Request } from '../../../domain/request/Request.js';
import {
  buildWaveStatus,
  WaveExecutorView,
  WaveStatusPayload,
} from './waveStatus.js';
import { computeActiveOverlappingTargets } from './bootActionable.js';
import { parseFormat } from '../../shared/parseFormat.js';

const SWARM_STATUS_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'orchestrating',
  'for',
  'format',
]);

const ACTIVE_STATES: ReadonlySet<string> = new Set([
  'pending',
  'approved',
  'executing',
]);

export type SwarmAlertKind =
  | 'stale_executor'
  | 'overlapping_target'
  | 'attribution_risk';

export interface SwarmAlert {
  readonly kind: SwarmAlertKind;
  readonly wave_id: string;
  readonly actor: string;
  readonly why: string;
}

export interface SwarmWaveView {
  readonly id: string;
  readonly state: string;
  readonly from: string;
  readonly age_ms: number | null;
  readonly age_band: 'fresh' | 'in-progress' | 'stale';
  readonly approved_at: string | null;
  readonly executors: readonly WaveExecutorView[];
  readonly wave_stale_effective: boolean;
}

export interface SwarmStatusPayload {
  readonly as_of: string;
  readonly scope: {
    readonly orchestrating: string | null;
    readonly for: string | null;
    readonly for_source: 'flag' | 'env' | null;
  };
  readonly summary: {
    readonly active_waves: number;
    readonly distinct_executors: number;
    readonly alerts: number;
  };
  readonly waves: readonly SwarmWaveView[];
  readonly alerts: readonly SwarmAlert[];
}

/**
 * Apply the dual scope filters. Director-centric: actor is the `from`
 * of the wave. Participant-centric: actor is a named executor, the
 * auto-review, or a `with`-partner.
 *
 * Both flags compose with AND when both are set — useful for "waves
 * where I orchestrate AND X participates." The common case is exactly
 * one of them.
 */
function matchesScope(
  r: Request,
  orchestrating: string | null,
  participantFor: string | null,
): boolean {
  if (orchestrating !== null && r.from.value !== orchestrating) return false;
  if (participantFor !== null) {
    const inExecs = r.hasExecutor(participantFor);
    const isAuthor = r.from.value === participantFor;
    const isReviewer = r.autoReview?.value === participantFor;
    const isPartner = r.with.some((p) => p.value === participantFor);
    if (!inExecs && !isAuthor && !isReviewer && !isPartner) return false;
  }
  return true;
}

export async function swarmStatusCmd(
  c: C,
  args: ParsedArgs,
): Promise<number> {
  rejectUnknownFlags(args, SWARM_STATUS_KNOWN_FLAGS, 'swarm-status');
  const format = parseFormat(args);
  const orchestratingFlag = optionalOption(args, 'orchestrating') ?? null;
  const explicitFor = optionalOption(args, 'for') ?? null;
  // GUILD_ACTOR fallback: when neither flag is set and env is set, default
  // to orchestrating-the-env-actor. Matches the `gate board` precedent for
  // implicit narrowing; the source is reported in `scope.for_source` so a
  // JSON consumer can disambiguate.
  let orchestrating = orchestratingFlag;
  let forSource: 'flag' | 'env' | null = null;
  if (orchestrating === null && explicitFor === null) {
    const envActor = resolveGuildActor() ?? null;
    if (envActor !== null && envActor.length > 0) {
      orchestrating = envActor;
      forSource = 'env';
    }
  } else if (orchestratingFlag !== null) {
    forSource = 'flag';
  } else if (explicitFor !== null) {
    forSource = 'flag';
  }

  const allRequests = await c.requestUC.listAll();
  const activeAll = allRequests.filter((r) => ACTIVE_STATES.has(r.state));
  const scoped = activeAll.filter((r) =>
    matchesScope(r, orchestrating, explicitFor),
  );
  scoped.sort((a, b) =>
    a.id.value < b.id.value ? -1 : a.id.value > b.id.value ? 1 : 0,
  );

  const now = new Date();
  const waveViews: SwarmWaveView[] = scoped.map((r) => {
    const ws = buildWaveStatus(r, now);
    return shapeWave(ws);
  });

  const distinctExecutors = new Set<string>();
  for (const w of waveViews) {
    for (const e of w.executors) distinctExecutors.add(e.name);
  }

  const alerts: SwarmAlert[] = [];

  // stale_executor: any executor in the scoped set whose freshness
  // band reads 'stale'. Per-executor band is already derived in
  // wave-status (#309); we just surface those that fired.
  for (const w of waveViews) {
    for (const e of w.executors) {
      if (e.activity_band === 'stale') {
        const since = e.last_attributable_at
          ? `since ${e.last_attributable_at}`
          : 'no attributable write yet';
        alerts.push({
          kind: 'stale_executor',
          wave_id: w.id,
          actor: e.name,
          why: `executor activity_band=stale (${since})`,
        });
      }
    }
  }

  // overlapping_target: re-use the boot-side computation so the two
  // surfaces agree (#234). Filter to the scoped set so we don't alert
  // the director about overlaps outside their view.
  const scopedById = new Map(scoped.map((r) => [r.id.value, r]));
  const overlapGroups = computeActiveOverlappingTargets(activeAll);
  for (const group of overlapGroups) {
    const relevantIds = group.requests
      .map((req) => req.id)
      .filter((id) => scopedById.has(id));
    if (relevantIds.length === 0) continue;
    // Surface one alert per relevant request so a consumer scanning
    // the alerts array sees one entry per affected wave id.
    for (const id of relevantIds) {
      const r = scopedById.get(id)!;
      alerts.push({
        kind: 'overlapping_target',
        wave_id: id,
        actor: r.from.value,
        why: `target='${group.target}' shared with ${group.requests.length - 1} other active wave(s)`,
      });
    }
    // attribution_risk: when the same author has ≥2 distinct sessions
    // in the overlap group, surface as separate alert kind. The boot-
    // side compute returns the per-author session list under the
    // snake_case key, matching the JSON wire format.
    const parallelAuthors = group.parallel_session_authors ?? {};
    for (const [author, sessionsRaw] of Object.entries(parallelAuthors)) {
      const sessions = sessionsRaw as readonly string[];
      // Find one wave_id in the scoped set authored by this actor.
      const anchorId = relevantIds.find(
        (id) => scopedById.get(id)?.from.value === author,
      );
      if (!anchorId) continue;
      alerts.push({
        kind: 'attribution_risk',
        wave_id: anchorId,
        actor: author,
        why: `${sessions.length} distinct sessions writing as '${author}' (${sessions.join(', ')})`,
      });
    }
  }

  const payload: SwarmStatusPayload = {
    as_of: now.toISOString(),
    scope: {
      orchestrating,
      for: explicitFor,
      for_source: forSource,
    },
    summary: {
      active_waves: waveViews.length,
      distinct_executors: distinctExecutors.size,
      alerts: alerts.length,
    },
    waves: waveViews,
    alerts,
  };

  if (format === 'json') {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(renderText(payload) + '\n');
  return 0;
}

function shapeWave(ws: WaveStatusPayload): SwarmWaveView {
  return {
    id: ws.id,
    state: ws.state,
    from: ws.from,
    age_ms: ws.age_ms,
    age_band: ws.age_band,
    approved_at: ws.approved_at,
    executors: ws.executors,
    wave_stale_effective: ws.wave_stale_effective,
  };
}

function renderText(p: SwarmStatusPayload): string {
  const lines: string[] = [];
  const scopeBits: string[] = [];
  if (p.scope.orchestrating !== null)
    scopeBits.push(`orchestrating=${p.scope.orchestrating}`);
  if (p.scope.for !== null) scopeBits.push(`for=${p.scope.for}`);
  const scopeStr =
    scopeBits.length > 0 ? `  (${scopeBits.join(', ')})` : '  (all)';
  lines.push(`swarm picture as of ${p.as_of}${scopeStr}`);
  lines.push(
    `  ${p.summary.active_waves} active wave(s)  ` +
      `${p.summary.distinct_executors} distinct executor(s)  ` +
      `${p.summary.alerts} alert(s)`,
  );
  // Eris-axis nuance: "active waves" without any executor-stamped
  // activity is the legacy / pre-#230 shape — the surface should
  // not advertise "swarm picture" at face value for that case. Add
  // a one-line hint so a reader scanning the summary knows what
  // they're looking at before walking the per-wave list.
  if (p.summary.active_waves > 0 && p.summary.distinct_executors === 0) {
    lines.push(
      '  (no executor-stamped activity — likely pre-#230 records or freshly-filed pending)',
    );
  }
  lines.push('');

  if (p.waves.length === 0) {
    lines.push('(no active waves in scope)');
    return lines.join('\n');
  }

  lines.push('waves:');
  for (const w of p.waves) {
    const ageBadge = w.age_band !== 'fresh' ? `  [${w.age_band}]` : '';
    // No-executors waves render on ONE line — the previous shape
    // emitted a separate `    (no executors assigned)` indented line
    // per wave, which produced visually heavy blocks for substrates
    // dominated by pre-#230 records. Inline tag is tighter and
    // doesn't fight for attention with executor-bearing waves
    // (which need their own per-executor block).
    if (w.executors.length === 0) {
      lines.push(`  ${w.id}  [${w.state}]  from=${w.from}${ageBadge}  (no executors)`);
      continue;
    }
    lines.push(`  ${w.id}  [${w.state}]  from=${w.from}${ageBadge}`);
    for (const e of w.executors) {
      const tags: string[] = [e.slice_status];
      if (e.claim_held) tags.push('claim');
      if (e.activity_band === 'stale') tags.push('⚠ stale');
      else if (e.activity_band === 'in-progress')
        tags.push('in-progress');
      const tagStr = `[${tags.join(' ')}]`;
      const last = e.last_attributable_at
        ? `  last write: ${e.last_attributable_at}`
        : '';
      const sess = e.witness_session
        ? `  session=${e.witness_session}`
        : '';
      lines.push(`    ${e.name}  ${tagStr}${last}${sess}`);
    }
  }

  if (p.alerts.length > 0) {
    lines.push('');
    lines.push('alerts:');
    for (const a of p.alerts) {
      lines.push(`  [${a.kind}] ${a.wave_id} actor=${a.actor}: ${a.why}`);
    }
  }

  return lines.join('\n');
}
