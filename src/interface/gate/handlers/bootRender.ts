// Boot's rendering layer: text-mode renderer + cross-passage fan-out.
//
// Extracted from boot.ts during the 2026-05-13 split (#3xx). The JSON
// payload shape lives in bootTypes.ts; this file consumes the payload
// and emits the human-readable projection. The cross-passage
// orientation registry (PASSAGE_ORIENTATION_REGISTRY) sits here
// because it produces a slice of the payload that the renderer
// consumes downstream — keeping the producer + consumer together so
// adding a new passage is a one-file change.

import { isBroadcastPendingResponse } from './bootActionable.js';
import type { GuildProfile } from '../../../infrastructure/config/GuildConfig.js';
import type {
  PassageOrientationProvider,
  PassageOrientationSummary,
} from '../../shared/PassageOrientation.js';
import { agoraOrientation } from '../../../passages/agora/interface/orientation.js';
import { ctxOrientation } from '../../../passages/ctx/interface/orientation.js';
import { devilOrientation } from '../../../passages/devil/interface/orientation.js';
import type { C } from './internal.js';
import type {
  BootPayload,
  BootSuggestedNextOrPendingResponse,
} from './bootTypes.js';

/**
 * Registry of passage orientation providers. Each passage that
 * lives under `<content_root>/<name>/` contributes one provider;
 * boot polls all of them at orientation time.
 *
 * Static array (rather than dynamic registry) because the package
 * ships gate, agora, devil together — there's nothing to discover
 * at runtime. The seam exists so adding a new passage is a one-
 * line change here plus the passage's own provider, not a refactor
 * of boot.ts. Failure of any single provider is contained: errors
 * are logged to stderr and the rest of the registry continues.
 */
const PASSAGE_ORIENTATION_REGISTRY: ReadonlyArray<{
  name: string;
  provider: PassageOrientationProvider;
}> = [
  { name: 'agora', provider: agoraOrientation },
  { name: 'devil', provider: devilOrientation },
  { name: 'ctx', provider: ctxOrientation },
];

export async function collectCrossPassage(
  config: C['config'],
): Promise<Record<string, PassageOrientationSummary>> {
  const out: Record<string, PassageOrientationSummary> = {};
  for (const { name, provider } of PASSAGE_ORIENTATION_REGISTRY) {
    try {
      const summary = await provider(config);
      if (summary !== null) out[name] = summary;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(
        `notice: passage '${name}' orientation provider failed: ${msg} ` +
          `(boot continues; cross_passage.${name} omitted)\n`,
      );
    }
  }
  return out;
}

export function renderBootText(p: BootPayload, profile: GuildProfile): string {
  const lines: string[] = [];
  if (p.actor) {
    const sessionTag =
      p.session_id !== null ? ` · session=${p.session_id}` : '';
    lines.push(`── you are ${p.actor} (${p.role})${sessionTag} ──`);
  } else {
    lines.push('── boot (no GUILD_ACTOR; global view) ──');
  }
  if (p.hints.session_id_unset && profile === 'swarm') {
    lines.push('');
    lines.push(
      'notice: no session_id resolved (GUILD_SESSION_ID unset, no --session-id flag).',
    );
    lines.push(
      '  request / claim / witness will not stamp a session on subsequent calls.',
    );
    lines.push(
      '  fix: pick a name (e.g. eris-local-2026-05-08-evening) and either',
    );
    lines.push(
      '    export GUILD_SESSION_ID=<id>            # whole shell',
    );
    lines.push(
      '    gate boot --session-id <id>             # this orientation only',
    );
  }
  if (p.hints.misconfigured_cwd) {
    lines.push('');
    lines.push(
      `⚠️  no guild.config.yaml found, falling back to cwd`,
    );
    lines.push(`   resolved: ${p.hints.resolved_content_root}`);
    lines.push(
      `   (0 members, 0 requests — likely wrong cwd, not a fresh start)`,
    );
    lines.push(
      `   fix: cd into the directory that contains guild.config.yaml,`,
    );
    lines.push(
      `        or use a wrapper that cd's before invoking gate.mjs.`,
    );
  } else if (
    p.hints.cwd_outside_content_root ||
    p.hints.config_file === null
  ) {
    // Surface the resolved content_root + config when the cwd is
    // surprising (subdir of an active guild) or implicit (no config
    // found, cwd silently used as fallback root). Suppressed at the
    // alignment case to keep the normal run quiet — voice budget.
    // Phrasing matches the `(config: ...)` segment of `gate
    // register`'s notice (PR #108) for cross-verb recognition.
    const configSegment =
      p.hints.config_file === null
        ? 'config: none — cwd used as fallback root'
        : `config: ${p.hints.config_file}`;
    lines.push('');
    lines.push(
      `content root: ${p.hints.resolved_content_root} (${configSegment})`,
    );
  }
  const health = p.hints.content_root_health;
  if (health.malformed_count > 0) {
    lines.push('');
    lines.push(
      `⚠️  ${health.malformed_count} malformed record(s) in content_root`,
    );
    for (const a of health.areas) {
      if (a.malformed > 0) {
        lines.push(
          `   ${a.area}: ${a.malformed} malformed of ${a.total}`,
        );
      }
    }
    lines.push(`   fix: gate doctor   # inspect each finding`);
    lines.push(
      `        gate doctor --format json | gate repair --apply   # quarantine`,
    );
  }
  lines.push('');
  lines.push(
    `queues: pending=${p.status.pending.total} approved=${p.status.approved.total} executing=${p.status.executing.total} open_issues=${p.status.open_issues} unreviewed=${p.status.unreviewed}`,
  );
  // Lore discoverability hint: one line below queues so a cold
  // session sees `gate lore` exists without having to consult
  // `--help`. Suppressed when lore is unavailable — the (rare)
  // mis-install path would otherwise render as a confusing `0/0`.
  if (p.lore_stats.available) {
    lines.push(
      `lore: ${p.lore_stats.principles} principles, ${p.lore_stats.traps} traps  (gate lore list)`,
    );
  }
  if (p.inbox_unread.length > 0) {
    lines.push(`inbox unread: ${p.inbox_unread.length}`);
    for (const m of p.inbox_unread.slice(0, 3)) {
      lines.push(`  [${m.at}] ${m.type} from ${m.from}: ${m.text.slice(0, 60)}`);
    }
  }
  if (p.last_activity) lines.push(`last activity: ${p.last_activity}`);
  if (p.warnings.length > 0) {
    lines.push('');
    lines.push(`⚠ ${p.warnings.length} warning(s) raised while assembling this snapshot:`);
    for (const w of p.warnings) {
      lines.push(`   ${w}`);
    }
    lines.push(`   (counts in 'queues:' / 'inbox unread:' may be inaccurate;`);
    lines.push(`    run 'gate doctor' to inspect the underlying repos)`);
  }

  // Cross-passage summary: render only the passages with records.
  // Empty cross_passage stays silent (voice budget — fresh roots
  // shouldn't see "agora: 0/0/null" noise).
  const crossEntries = Object.values(p.cross_passage);
  if (crossEntries.length > 0) {
    lines.push('');
    for (const s of crossEntries) {
      const suspendedNote =
        s.suspended > 0 ? ` (${s.suspended} paused)` : '';
      const lastNote =
        s.last_id !== null
          ? `; last ${s.last_id} [${s.last_state}]`
          : '';
      lines.push(`${s.passage}: ${s.open} open${suspendedNote}${lastNote}`);
    }
  }

  // Cross-session race surface (issue #234). Only rendered when at
  // least one target has ≥ 2 active requests; the empty case stays
  // silent so the common "no overlap" boot doesn't carry an empty
  // header line. JSON consumers read `active_overlapping_targets`
  // directly — text mode here is the human-readable projection.
  //
  // Profile gating (#323): swarm-only signal. Solo users on
  // profile=standard don't see the overlap section or the parallel-
  // session warning in text mode. JSON envelope is unchanged so
  // orchestrators keep their contract regardless of profile.
  if (profile === 'swarm' && p.active_overlapping_targets.length > 0) {
    lines.push('');
    lines.push('active waves with overlapping target:');
    for (const o of p.active_overlapping_targets) {
      for (const r of o.requests) {
        const exec =
          r.executors.length > 0 ? r.executors.join(',') : '(no executor)';
        const claim = r.claimed_by !== undefined ? ', claim_held' : '';
        // Session tag (#249 slice 4) — bracket-shaped, mirroring
        // the `gate show` stake-block convention so the two
        // surfaces share one annotation grammar.
        const session =
          r.opened_by_session !== undefined
            ? ` [session=${r.opened_by_session}]`
            : '';
        lines.push(
          `  - ${r.id} (${exec}, ${r.state}${claim})${session} — target: ${o.target}`,
        );
      }
    }
    lines.push(
      '  ⚠ overlap detected. coordinate via `gate witness <id>` or `gate claim <id>`.',
    );
    // Same-actor parallel-session warning (#249 slice 4). One line
    // per actor whose authorship splits across sessions in any
    // overlap group. The hint deliberately frames it as a question
    // ("was the second session intended?") rather than an
    // accusation — there are legitimate parallel-session shapes
    // (e.g. the same human deliberately running two waves), and
    // the substrate's job is to surface the case, not adjudicate it.
    const parallelLines: string[] = [];
    for (const o of p.active_overlapping_targets) {
      const map = o.parallel_session_authors;
      if (map === undefined) continue;
      for (const [author, sessions] of Object.entries(map)) {
        parallelLines.push(
          `  ⚠ same-actor parallel sessions: ${author} on target "${o.target}" ` +
            `(sessions: ${sessions.join(', ')}). check whether the second ` +
            `session was intended.`,
        );
      }
    }
    for (const line of parallelLines) lines.push(line);
  }

  if (p.tail.length > 0) {
    lines.push('');
    lines.push(`recent (${p.tail.length}):`);
    for (const u of p.tail.slice(0, 5)) {
      if (u.kind === 'review') {
        lines.push(`  ${u.at}  req=${u.request_id}  [${u.lense}/${u.verdict}] by ${u.by}`);
      } else if (u.kind === 'thank') {
        lines.push(`  ${u.at}  req=${u.request_id}  thank ${u.by} → ${u.to}`);
      } else {
        lines.push(`  ${u.at}  req=${u.request_id}  authored by ${u.from}`);
      }
    }
  }
  if (p.your_recent && p.your_recent.length > 0) {
    lines.push('');
    lines.push(`your recent (${p.your_recent.length}):`);
    for (const u of p.your_recent.slice(0, 3)) {
      if (u.kind === 'review') {
        lines.push(`  ${u.at}  req=${u.request_id}  [${u.lense}/${u.verdict}]`);
      } else {
        lines.push(`  ${u.at}  req=${u.request_id}  authored`);
      }
    }
  }
  if (p.suggested_next) {
    lines.push('');
    // Render the hint as a concrete shell command so the reader can
    // copy-paste. `export` is special-cased because it's a shell
    // builtin, not a gate subcommand.
    const n: BootSuggestedNextOrPendingResponse = p.suggested_next;
    if (isBroadcastPendingResponse(n)) {
      // No single verb to print — the recipient picks the shape of
      // their reply (message back, mark-read as ack, or branch into
      // a request). Lead with the broadcaster + timestamp so the
      // reader can locate the entry in their inbox.
      lines.push(
        `→ pending broadcast response: from ${n.broadcast_from} at ${n.broadcast_at}`,
      );
      lines.push(`  (${n.hint})`);
      return lines.join('\n') + '\n';
    }
    if (n.verb === 'export') {
      const [k, v] = Object.entries(n.args)[0] ?? ['GUILD_ACTOR', '<your-name>'];
      lines.push(`→ next: export ${k}=${v}`);
    } else {
      const argsStr = Object.entries(n.args)
        .map(([k, v]) => `--${k} ${v}`)
        .join(' ');
      lines.push(`→ next: gate ${n.verb}${argsStr ? ' ' + argsStr : ''}`);
    }
    lines.push(`  (${n.reason})`);
    // Alternative ladder: surface up to two sibling actionable verbs
    // beneath the primary suggestion. `verbs_available_now.actionable`
    // is the JSON catalog of every state-transition verb whose
    // preconditions the caller already meets; `suggested_next` picks
    // ONE to lead with. Without rendering the rest in text mode, the
    // caller has to round-trip through `gate boot --format json` to
    // see the siblings. Limited to two so the ladder stays scannable.
    //
    // We filter out the primary itself (matched on verb + id) so the
    // ladder doesn't echo `→ next:` as `→ or:`. The id sits in the
    // primary suggestion's `args.id` when present.
    const primaryId =
      'args' in n && typeof n.args['id'] === 'string' ? n.args['id'] : null;
    const alts = p.verbs_available_now.actionable
      .filter((a) => !(a.verb === n.verb && a.id === primaryId))
      .slice(0, 2);
    for (const a of alts) {
      lines.push(`→ or:   gate ${a.verb} ${a.id}`);
      lines.push(`        (${a.reason})`);
    }
  }
  return lines.join('\n') + '\n';
}
