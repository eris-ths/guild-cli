// Read-side request handlers: `gate list`, `gate pending`, `gate show`.
// Plus the formatting helpers they own (text-mode renderers, marker
// width computation, ellipsis-aware action truncation).
//
// Extracted from request.ts during the 2026-05-13 split (#3xx). The
// original file mixed creation, read, lifecycle, and fast-track in a
// single 1656-line module; the split groups handlers by passage role
// without changing behavior. Tests reach these via CLI dispatch, so
// no test changes are needed.
//
// Exported helpers (`formatReviewMarkers`, `computeReviewMarkerWidth`)
// are re-exported from `gate/index.ts` for board.ts / templates.ts /
// tests/interface/reviewMarkers.test.ts consumers.

import { resolveGuildActor } from '../../shared/resolveGuildActor.js';
import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { maybeEmitExplain } from '../../shared/explain.js';
import { notFoundMessage } from '../../shared/notFoundHint.js';
import { Request } from '../../../domain/request/Request.js';
import { formatDelta, pushMultilineField } from '../voices.js';
import { C, truncateCodePoints } from './internal.js';
import { parseFormat } from '../../shared/parseFormat.js';

// `gate list` and `gate pending` share `reqList`. pending only takes
// `--for`; list adds the four narrowing filters. The list set is the
// superset and is used at the reqList layer; the index dispatch
// pre-checks the pending case before delegating, so unknown flags on
// `gate pending` (e.g. `--from x`) are still caught with the right
// verb name in the error.
const LIST_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'state',
  'for',
  'from',
  'executor',
  'auto-review',
  'format',
]);
const PENDING_KNOWN_FLAGS: ReadonlySet<string> = new Set(['for', 'format']);
const SHOW_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'plain',
  'format',
  'fields',
]);

export async function reqList(
  c: C,
  state: string,
  args: ParsedArgs,
  verb: 'list' | 'pending' = 'list',
): Promise<number> {
  // Different known-flag sets per verb so a typo on `gate pending`
  // doesn't get a list-grade hint, and the error names the right verb.
  rejectUnknownFlags(
    args,
    verb === 'pending' ? PENDING_KNOWN_FLAGS : LIST_KNOWN_FLAGS,
    verb,
  );
  maybeEmitExplain(args, verb);
  const fromFilter = optionalOption(args, 'from');
  const executorFilter = optionalOption(args, 'executor');
  const autoReviewFilter = optionalOption(args, 'auto-review');
  const explicitFor = optionalOption(args, 'for');
  const envActor =
    explicitFor === undefined && resolveGuildActor()
      ? resolveGuildActor()
      : undefined;
  const forFilter = explicitFor ?? envActor;

  // `--state all` is sugar for "every state, no filter" — parity with
  // `gate issues list --state all`. Implemented at the interface layer
  // because `all` is a CLI-level affordance, not a domain state;
  // parseRequestState rejects it. The asymmetry where one list verb
  // accepted the sugar and the other errored was the touch-feel gap
  // surfaced in P3 dogfood.
  let items =
    state === 'all'
      ? await c.requestUC.listAll()
      : await c.requestUC.listByState(state);
  if (fromFilter !== undefined) {
    items = items.filter((r) => r.from.value === fromFilter);
  }
  if (executorFilter !== undefined) {
    // Multi-executor (issue #230): match if the filter name appears
    // anywhere in the assigned list. Single-executor records still
    // hit because their `executors` is a one-element array.
    items = items.filter((r) =>
      r.executors.some((m) => m.value === executorFilter),
    );
  }
  if (autoReviewFilter !== undefined) {
    items = items.filter((r) => r.autoReview?.value === autoReviewFilter);
  }
  if (forFilter !== undefined) {
    items = items.filter(
      (r) =>
        r.from.value === forFilter ||
        r.executors.some((m) => m.value === forFilter) ||
        r.autoReview?.value === forFilter,
    );
  }

  // --format closes the asymmetry surfaced in the post-merge bird's-eye
  // check (2026-05-03): every other gate read verb (board / status /
  // voices / tail / show / why / summarize) accepts --format json|text;
  // list / pending were text-only. JSON envelope mirrors board's shape:
  // top-level `requests` array of full request.toJSON(), `_meta` carries
  // the state being listed (informational for both list and pending) and
  // any active filter so a JSON consumer sees what the stderr notice
  // shows to humans.
  const format = parseFormat(args);

  // The "filtered by GUILD_ACTOR=..." stderr notice exists so a *human*
  // reading text output knows why their result set is implicitly
  // scoped. JSON consumers already get this on stdout as
  // `_meta.filter.for_source: 'GUILD_ACTOR'`, so the stderr line is
  // redundant in JSON mode — and emitting it on every JSON invocation
  // crosses the chronic-noise threshold named by
  // lore/traps/trap_chronic_noise_blindness.md (stay quiet when a
  // structured field already says it). Gate the stderr write on
  // text-mode only; JSON envelope's _meta.filter remains authoritative.
  if (envActor !== undefined && format !== 'json') {
    process.stderr.write(
      `# filtered by GUILD_ACTOR=${envActor} (use --for <m> or unset GUILD_ACTOR to override)\n`,
    );
  }

  if (format === 'json') {
    const filterEcho: Record<string, string> = {};
    if (fromFilter !== undefined) filterEcho['from'] = fromFilter;
    if (executorFilter !== undefined) filterEcho['executor'] = executorFilter;
    if (autoReviewFilter !== undefined) filterEcho['auto_review'] = autoReviewFilter;
    if (forFilter !== undefined) {
      filterEcho['for'] = forFilter;
      filterEcho['for_source'] = explicitFor !== undefined ? '--for' : 'GUILD_ACTOR';
    }
    const payload: Record<string, unknown> = {
      // toRenderJSON keeps the deprecated `executor` alias visible
      // alongside the new `executors` array (issue #230 back-compat).
      requests: items.map((r) => r.toJSON()),
      _meta: {
        state,
        verb,
        ...(Object.keys(filterEcho).length > 0 ? { filter: filterEcho } : {}),
      },
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return 0;
  }

  if (items.length === 0) {
    const suffix = describeFilters({
      from: fromFilter,
      executor: executorFilter,
      'auto-review': autoReviewFilter,
      for: forFilter,
    });
    process.stdout.write(`(no requests in ${state}${suffix})\n`);
    return 0;
  }
  const markerWidth = computeReviewMarkerWidth(items);
  for (const r of items) printSummary(r, markerWidth);
  return 0;
}

// Compute the widest review-marker string across a list of requests,
// returning at least the fallback minimum. Used to align the action
// column in `gate list` / `gate pending` output.
export function computeReviewMarkerWidth(
  items: ReadonlyArray<Request>,
  fallbackMin = 16,
): number {
  let max = fallbackMin;
  for (const r of items) {
    const natural = formatReviewMarkers(r.toJSON()['reviews'], 0);
    if (natural.length > max) max = natural.length;
  }
  return max + 2;
}

function describeFilters(filters: Record<string, string | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined) parts.push(`${k}=${v}`);
  }
  return parts.length === 0 ? '' : ` with ${parts.join(', ')}`;
}

export async function reqShow(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, SHOW_KNOWN_FLAGS, 'show');
  maybeEmitExplain(args, 'show');
  const id = args.positional[0];
  if (!id)
    throw new Error(
      'Usage: gate show <id> [--format json|text] [--fields k1,k2,...] [--plain]',
    );
  const plain = args.options['plain'] === true;
  const format = optionalOption(args, 'format') ?? (plain ? 'plain' : 'json');
  if (format !== 'json' && format !== 'text' && format !== 'plain') {
    throw new Error(`--format must be 'json', 'text', or 'plain', got: ${format}`);
  }
  const r = await c.requestUC.show(id);
  if (!r) {
    process.stderr.write(notFoundMessage('request', id));
    return 1;
  }
  const fields = optionalOption(args, 'fields');
  if (plain || format === 'plain') {
    // --plain is for shell composition: `$(gate show $id --fields
    // state --plain)` returns just `approved` without JSON quoting.
    // Requires exactly one --fields entry; the "one value, no
    // envelope" contract is what makes it pipeline-friendly.
    const keep = (fields ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (keep.length !== 1) {
      throw new Error(
        '--plain requires exactly one field (use --fields <key>). ' +
          'For multiple fields, drop --plain and read the JSON object.',
      );
    }
    // toRenderJSON: JSON-side back-compat surface (issue #230 — Devil
    // review blocker 2). `gate show --fields executor --plain $id` was
    // a documented selector; preserve it by emitting the deprecated
    // alias on the render path. Persistence still writes only the new
    // `executors` key.
    const payload = r.toJSON();
    const key = keep[0]!;
    if (!(key in payload)) {
      // Missing field: emit nothing, exit 1 so shell `[ -z "$v" ]`
      // handles it without hallucinating a default.
      return 1;
    }
    const v = payload[key];
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      process.stdout.write(String(v) + '\n');
    } else {
      // Objects / arrays — fall back to compact JSON so callers
      // still get something usable. Rare in practice (most useful
      // fields are scalars).
      process.stdout.write(JSON.stringify(v) + '\n');
    }
    return 0;
  }
  if (format === 'json') {
    // `--fields state,executor` trims the payload to what the caller
    // actually needs. A full `show` JSON runs ~400-800 bytes; for an
    // agent checking just `state` in a tight loop, that's a lot of
    // tokens for one boolean-ish answer. Only available in JSON mode
    // (text already has its own compact summary).
    // toRenderJSON: include the deprecated `executor` alias so the
    // documented `--fields state,executor` shape keeps working. See
    // toRenderJSON for the deprecation timeline.
    let payload: Record<string, unknown> = r.toJSON();
    if (fields !== undefined) {
      const keep = fields
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const picked: Record<string, unknown> = {};
      for (const k of keep) {
        if (k in payload) picked[k] = payload[k];
      }
      payload = picked;
    }
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    process.stdout.write(formatRequestText(r) + '\n');
  }
  return 0;
}

function formatRequestText(r: Request): string {
  const j = r.toJSON();
  const lines: string[] = [];
  lines.push(`${j['id']}  [${j['state']}]`);
  lines.push(`  from:     ${j['from']}`);
  // executors: new wire form (array) — render as `executors: a, b`.
  // Records that hydrated from the legacy `executor: <string>` shape
  // come through toJSON as a single-element array. The label is
  // pluralised even for one entry so the schema is uniform; the
  // single-name case still reads naturally (`executors: alice`).
  // Issue #230.
  // Read via the domain getter — slice-closure (issue #294) doesn't
  // affect this row; status surfaces through dedicated verbs (e.g.
  // `gate wave-status`).
  const execNames = r.executors.map((m) => m.value);
  if (execNames.length > 0) {
    lines.push(`  executors: ${execNames.join(', ')}`);
  }
  if (j['target']) lines.push(`  target:   ${j['target']}`);
  if (j['auto_review']) lines.push(`  reviewer: ${j['auto_review']}`);
  if (Array.isArray(j['with']) && j['with'].length > 0) {
    lines.push(`  with:     ${(j['with'] as string[]).join(', ')}`);
  }
  if (j['promoted_from']) {
    lines.push(`  promoted_from: ${j['promoted_from']}`);
  }
  // source_agora_play (#232) — agora play this request was bridged
  // from via `gate request --from-agora`. Rendered next to
  // promoted_from because both are tool-stamped backlinks ("this came
  // out of <X>") and a reader scanning the header pairs them mentally.
  if (j['source_agora_play']) {
    lines.push(`  source_agora_play: ${j['source_agora_play']}`);
  }
  // opened_by_session (#249 slice 3) — the request author's boot
  // session at create time. Sits with the other tool-stamped
  // backlinks (promoted_from / source_agora_play) for the same
  // "where did this come from" mental cluster. Absence is the
  // common case (pre-#249 records, unstamped post-#249 writes); the
  // line drops out entirely so byte-stable text rendering survives.
  if (typeof j['opened_by_session'] === 'string' && j['opened_by_session'].length > 0) {
    lines.push(`  opened_by_session: ${j['opened_by_session']}`);
  }
  lines.push(`  created:  ${j['created_at']}`);
  lines.push('');
  pushMultilineField(lines, '  action:   ', String(j['action']));
  pushMultilineField(lines, '  reason:   ', String(j['reason']));
  if (j['completion_note']) {
    pushMultilineField(lines, '  note:     ', String(j['completion_note']));
  }
  if (j['deny_reason']) {
    pushMultilineField(lines, '  denied:   ', String(j['deny_reason']));
  }
  if (j['failure_reason']) {
    pushMultilineField(lines, '  failed:   ', String(j['failure_reason']));
  }

  const log = Array.isArray(j['status_log']) ? j['status_log'] : [];
  if (log.length > 0) {
    lines.push('');
    lines.push(`  status_log (${log.length}):`);
    // Pad the state column to the max width in *this* log so the
    // `by X` column doesn't shuffle column-wise per row. Computed
    // per-render rather than hard-coded to the REQUEST_STATES max,
    // so logs that never reached executing/completed stay compact.
    const stateWidth = Math.max(
      ...(log as Array<Record<string, unknown>>).map(
        (e) => String(e['state']).length,
      ),
    );
    let prevAt: string | undefined;
    for (const entry of log as Array<Record<string, unknown>>) {
      const at = String(entry['at']);
      const note = entry['note'] ? ` — ${entry['note']}` : '';
      const delta = prevAt ? ` (${formatDelta(prevAt, at)})` : '';
      const invokedBy = entry['invoked_by']
        ? ` [invoked_by=${entry['invoked_by']}]`
        : '';
      const state = String(entry['state']).padEnd(stateWidth);
      lines.push(
        `    ${at}  ${state}  by ${entry['by']}${invokedBy}${delta}${note}`,
      );
      prevAt = at;
    }
  }

  // Stake markers (issues #226 / #244): claim and witnesses sit on
  // the "who has this right now / who has eyes on it" axis. Rendered
  // as their own sub-section below status_log so they don't read as
  // a transition entry — same indentation under the same header was
  // misleading scanners (#245). Only emitted when at least one is
  // set; an unstaked record produces no `stake:` block.
  const hasClaim =
    typeof j['claimed_by'] === 'string' && typeof j['claimed_at'] === 'string';
  const hasWitnesses =
    Array.isArray(j['witnesses']) && (j['witnesses'] as unknown[]).length > 0;
  if (hasClaim || hasWitnesses) {
    lines.push('');
    lines.push('  stake:');
    if (hasClaim) {
      // Optional claim_note (issue #246) appended after an em-dash
      // separator. Stays on one line so the stake block scans
      // compactly even with several witnesses.
      const claimNote =
        typeof j['claim_note'] === 'string' && j['claim_note'].length > 0
          ? ` — ${j['claim_note']}`
          : '';
      // claimed_by_session (#249 slice 3): inline `[session=<id>]`
      // tag between actor and timestamp. Bracket form (rather than
      // parens) keeps it visually distinct from claim_note's em-dash
      // suffix so a reader scanning the line sees three independent
      // axes: who, when, attribution.
      const claimSession =
        typeof j['claimed_by_session'] === 'string' && j['claimed_by_session'].length > 0
          ? ` [session=${j['claimed_by_session']}]`
          : '';
      lines.push(
        `    claimed by: ${j['claimed_by']}${claimSession} at ${j['claimed_at']}${claimNote}`,
      );
    }
    if (hasWitnesses) {
      // Per-witness notes (issue #246) emitted inline as
      // `name (note)` so a 5-witness wave with mixed annotations
      // reads naturally:  `witnesses: alice (watching dedup), bob, carol (perf)`.
      const witnessNotes =
        j['witness_notes'] && typeof j['witness_notes'] === 'object' && !Array.isArray(j['witness_notes'])
          ? (j['witness_notes'] as Record<string, string>)
          : {};
      // Per-witness session_id (#249 slice 3) surfaces as a
      // bracket-tagged `[session=<id>]` suffix on the actor name.
      // Mirrors the claim line's tagging shape so a reader sees one
      // consistent annotation grammar across both stake variants.
      const witnessSessions =
        j['witness_sessions'] && typeof j['witness_sessions'] === 'object' && !Array.isArray(j['witness_sessions'])
          ? (j['witness_sessions'] as Record<string, string>)
          : {};
      const names = (j['witnesses'] as unknown[]).map((w) => {
        const name = String(w);
        const note = witnessNotes[name];
        const session = witnessSessions[name];
        const noteSuffix =
          typeof note === 'string' && note.length > 0 ? ` (${note})` : '';
        const sessionSuffix =
          typeof session === 'string' && session.length > 0
            ? ` [session=${session}]`
            : '';
        return `${name}${noteSuffix}${sessionSuffix}`;
      }).join(', ');
      lines.push(`    witnesses: ${names}`);
    }
  }

  // Template stamp (issue #235): wave-brief provenance. Lifted out
  // of status_log alongside the stake markers (#245) — the same
  // "looks like a log entry" anti-pattern applied here.
  if (typeof j['template'] === 'string') {
    const v =
      typeof j['template_version'] === 'number' ? ` (v${j['template_version']})` : '';
    const ack = j['gate_required_acknowledged'] === true ? ' [gate-ack]' : '';
    lines.push('');
    lines.push(`  template: ${j['template']}${v}${ack}`);
  }

  const reviews = Array.isArray(j['reviews']) ? j['reviews'] : [];
  if (reviews.length > 0) {
    lines.push('');
    lines.push(`  reviews (${reviews.length}):`);
    const lastLogAt =
      log.length > 0
        ? String((log[log.length - 1] as Record<string, unknown>)['at'])
        : undefined;
    let prevAt = lastLogAt;
    for (const rv of reviews as Array<Record<string, unknown>>) {
      const at = String(rv['at']);
      const delta = prevAt ? ` (${formatDelta(prevAt, at)})` : '';
      const invokedBy = rv['invoked_by']
        ? ` [invoked_by=${rv['invoked_by']}]`
        : '';
      lines.push(
        `    [${rv['lense']}/${rv['verdict']}] by ${rv['by']}${invokedBy} at ${at}${delta}`,
      );
      const comment = String(rv['comment'] ?? '');
      for (const line of comment.split('\n')) {
        lines.push(`      ${line}`);
      }
      prevAt = at;
    }
  }

  // Chain hint: detect full-id references (YYYY-MM-DD-NNN...) in free
  // text fields so the reader can notice whether `gate chain <id>` will
  // surface anything. Pure read-time signal; the write path is
  // untouched, preserving "write forgivingness" (free-form text) while
  // surfacing structural awareness at read time. Short-form references
  // like "(0004)" are intentionally not detected — the full ID format
  // is what `chain` walks, and hinting otherwise would mislead.
  const REF_PATTERN = /\b\d{4}-\d{2}-\d{2}-\d+\b/g;
  const selfId = String(j['id'] ?? '');
  const refs = new Set<string>();
  const scanText = (value: unknown): void => {
    if (typeof value !== 'string') return;
    const matches = value.match(REF_PATTERN);
    if (matches) for (const m of matches) refs.add(m);
  };
  scanText(j['action']);
  scanText(j['reason']);
  scanText(j['completion_note']);
  scanText(j['deny_reason']);
  scanText(j['failure_reason']);
  for (const entry of log as Array<Record<string, unknown>>) {
    scanText(entry['note']);
  }
  for (const rv of reviews as Array<Record<string, unknown>>) {
    scanText(rv['comment']);
  }
  refs.delete(selfId);
  const refList = [...refs].sort();
  lines.push('');
  if (refList.length === 0) {
    lines.push(
      `  chain hint: no outbound id references detected (gate chain ${selfId} will return nothing)`,
    );
  } else {
    const noun = refList.length === 1 ? 'reference' : 'references';
    lines.push(
      `  chain hint: ${refList.length} outbound ${noun} detected — ${refList.join(', ')}`,
    );
  }

  // Concern marker: a 3-state existence signal, not a count. Counting
  // ("3 concerns, 1 follow-up") would invite the reader to play a
  // "drive the number down" game — performance-for-the-record
  // (principle 03). Three states keep perception engaged without
  // setting a target:
  //   - no concerns recorded
  //   - concern recorded; no inbound reference
  //   - concern recorded; inbound reference present
  // The reader walks `gate chain` to see the actual references and
  // judges for themselves whether they address the concerns. The
  // tool only asserts existence.
  const hasConcernReview = (reviews as Array<Record<string, unknown>>).some(
    (rv) => rv['verdict'] === 'concern' || rv['verdict'] === 'reject',
  );
  if (hasConcernReview) {
    // We don't have the cross-record inbound count here without an
    // extra repository pass; instead say "see gate chain" and let
    // the reader resolve presence vs absence with one command. This
    // keeps formatRequestText synchronous + repo-free.
    lines.push(
      `  concern marker: concern recorded — ` +
        `walk \`gate chain ${selfId}\` to see inbound references (if any)`,
    );
  } else {
    lines.push('  concern marker: no concerns recorded');
  }

  return lines.join('\n');
}

function printSummary(r: Request, markerWidth = 16): void {
  const j = r.toJSON();
  const markers = formatReviewMarkers(j['reviews'], markerWidth);
  // Two issues with the previous `String(j['action']).slice(0, 60)`:
  //   1. silent truncation — a 500-char action rendered as exactly 60
  //      chars with no indicator; the caller couldn't tell prefix from
  //      full content (trap_silent_fallback_loses_signal).
  //   2. newline-preserving — multi-line actions break the columnar
  //      table layout; the second line shifts to column 0.
  //   3. UTF-16 surrogate cleave — `.slice(60)` on a string ending
  //      with an emoji can produce a broken char.
  // truncateCodePoints handles (1) and (3) (appends `...`, splits on
  // code points). Newlines/CRs/tabs are collapsed to a U+21B5 RETURN
  // SYMBOL so the table stays one line per request while the truncation
  // remains visible.
  const oneLine = String(j['action']).replace(/[\r\n\t]+/g, ' ↵ ');
  const display = truncateCodePoints(oneLine, 60);
  process.stdout.write(
    `${j['id']}  [${j['state']}]  from=${j['from']}  ${markers}${display}\n`,
  );
}

// Render a compact per-lense verdict summary like "✓devil ✓layer" or
// "!devil ✓layer". See comments in the prior index.ts implementation
// for design notes (UTF-16 width caveat, icon map, etc).
export function formatReviewMarkers(reviews: unknown, width = 16): string {
  if (!Array.isArray(reviews) || reviews.length === 0) {
    return ''.padEnd(width);
  }
  const parts: string[] = [];
  for (const rv of reviews as Array<Record<string, unknown>>) {
    const verdict = String(rv['verdict'] ?? '');
    const lense = String(rv['lense'] ?? '');
    const icon =
      verdict === 'ok'
        ? '✓'
        : verdict === 'concern'
          ? '!'
          : verdict === 'reject'
            ? 'x'
            : '?';
    parts.push(`${icon}${lense}`);
  }
  const joined = parts.join(' ');
  return joined.padEnd(width);
}
