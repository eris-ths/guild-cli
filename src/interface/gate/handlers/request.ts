import { resolveGuildActor } from '../../shared/resolveGuildActor.js';
import {
  ParsedArgs,
  requireOption,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { notFoundMessage } from '../../shared/notFoundHint.js';

// Known flags per write-verb. Silent-ignore of unknown flags (e.g.
// `--executr noir` instead of `--executor noir`) would let a typo
// slip through as "no executor assigned" with no error — the exact
// fail-open class that `tail` already opts into. See
// i-2026-04-22-0001 (hiroba) / devil review 2026-04-22-0001.
const REQUEST_CREATE_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'from',
  'action',
  'reason',
  'executor',
  'executors',
  'target',
  'depth',
  'auto-review',
  'with',
  'format',
]);
const APPROVE_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'by',
  'note',
  'dry-run',
  'format',
]);
const DENY_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'by',
  'reason',
  'note',
  'dry-run',
  'format',
]);
const EXECUTE_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'by',
  'note',
  'dry-run',
  'format',
]);
const COMPLETE_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'by',
  'note',
  'dry-run',
  'format',
]);
const FAIL_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'by',
  'reason',
  'note',
  'dry-run',
  'format',
]);
const FAST_TRACK_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'from',
  'action',
  'reason',
  'executor',
  'executors',
  'auto-review',
  'note',
  'with',
  'format',
]);
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
import { Request } from '../../../domain/request/Request.js';
import { formatDelta, pushMultilineField } from '../voices.js';
import {
  C,
  readStdin,
  deriveInvokedBy,
  emitInvokedByNotice,
  resolveInvokedBy,
  isDryRun,
  emitDryRunPreview,
} from './internal.js';
import { emitWriteResponse, parseFormat } from './writeFormat.js';

export async function reqCreate(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, REQUEST_CREATE_KNOWN_FLAGS, 'request');
  const from = requireOption(args, 'from', '<m>', 'GUILD_ACTOR');
  const action = requireOption(args, 'action', '"..."');
  let reason = requireOption(args, 'reason', '"..."');
  // `--reason -` reads from stdin — parity with `gate review --comment -`.
  // Trim because heredoc / echo append a trailing newline that clutters
  // the rendered status_log note.
  if (reason === '-') reason = (await readStdin()).trim();
  const input: Parameters<typeof c.requestUC.create>[0] = {
    from,
    action,
    reason,
  };
  const executor = optionalOption(args, 'executor');
  const executorsRaw = optionalOption(args, 'executors');
  const target = optionalOption(args, 'target');
  const depth = optionalOption(args, 'depth');
  const autoReview = optionalOption(args, 'auto-review');
  const withPartners = parseWithList(optionalOption(args, 'with'));
  // Mutual-exclusion: --executor (singular) and --executors (plural)
  // share semantics; allowing both would invite ambiguity ("which one
  // wins?") and let a typo go silent. Reject up front with a flag-
  // shaped message — same treatment as --reason vs positional reason
  // collisions elsewhere. Issue #230.
  if (executor !== undefined && executorsRaw !== undefined) {
    process.stderr.write(
      `error: --executor and --executors are mutually exclusive (got both). ` +
        `Use --executors a,b,c for multiple, or --executor <m> for one.\n`,
    );
    return 1;
  }
  if (executorsRaw !== undefined) {
    const parsed = parseExecutorsList(executorsRaw);
    if (parsed.error) {
      process.stderr.write(`error: --executors ${parsed.error}\n`);
      return 1;
    }
    if (parsed.list.length > 0) input.executors = parsed.list;
  }
  if (executor !== undefined) input.executor = executor;
  if (target !== undefined) input.target = target;
  // depth (issue #221): pre-check at the interface boundary so the
  // caller sees a flag-shaped error before the domain layer fires.
  // The advisory framing — 'shallow ⇒ surface point-check, deep ⇒
  // arch / threat model' — lives in `gate request --help` and the
  // schema description. Per principle 02, the value is advisory:
  // the substrate carries it through, the reviewer agent is the one
  // who chooses whether to honour it.
  if (depth !== undefined) {
    if (depth !== 'shallow' && depth !== 'standard' && depth !== 'deep') {
      process.stderr.write(
        `error: --depth must be one of shallow|standard|deep, got: ${depth}\n`,
      );
      return 1;
    }
    input.depth = depth;
  }
  if (autoReview !== undefined) input.autoReview = autoReview;
  if (withPartners.length > 0) input.with = withPartners;
  // Request creation is a proxy-eligible verb same as approve/review:
  // when GUILD_ACTOR differs from --from, the agent is filing on a
  // member's behalf. Derive the invoker pre-create so it lands on
  // the initial status_log entry; emit the stderr notice after the
  // id is allocated.
  const invokedBy = deriveInvokedBy(from);
  if (invokedBy !== undefined) input.invokedBy = invokedBy;
  const r = await c.requestUC.create(input);
  if (invokedBy !== undefined) {
    emitInvokedByNotice(from, invokedBy, 'request', r.id.value);
  }
  emitWriteResponse(
    parseFormat(args),
    r,
    `✓ created: ${r.id.value} (state=pending)`,
    c.config,
  );
  return 0;
}

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

  if (envActor !== undefined) {
    process.stderr.write(
      `# filtered by GUILD_ACTOR=${envActor} (use --for <m> or unset GUILD_ACTOR to override)\n`,
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
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    throw new Error(`--format must be 'json' or 'text', got: ${format}`);
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
      requests: items.map((r) => r.toRenderJSON()),
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
  const id = args.positional[0];
  if (!id)
    throw new Error(
      'Usage: gate show <id> [--format json|text] [--fields k1,k2,...] [--plain]',
    );
  const plain = args.options['plain'] === true;
  const format = optionalOption(args, 'format') ?? (plain ? 'plain' : 'json');
  if (format !== 'json' && format !== 'text' && format !== 'plain') {
    throw new Error(`--format must be 'json' or 'text', got: ${format}`);
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
    const payload = r.toRenderJSON();
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
    let payload: Record<string, unknown> = r.toRenderJSON();
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
  if (Array.isArray(j['executors']) && (j['executors'] as unknown[]).length > 0) {
    lines.push(`  executors: ${(j['executors'] as string[]).join(', ')}`);
  }
  if (j['target']) lines.push(`  target:   ${j['target']}`);
  if (j['auto_review']) lines.push(`  reviewer: ${j['auto_review']}`);
  if (Array.isArray(j['with']) && j['with'].length > 0) {
    lines.push(`  with:     ${(j['with'] as string[]).join(', ')}`);
  }
  if (j['promoted_from']) {
    lines.push(`  promoted_from: ${j['promoted_from']}`);
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

export async function reqApprove(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, APPROVE_KNOWN_FLAGS, 'approve');
  const id = args.positional[0];
  if (!id) throw new Error('Usage: gate approve <id> --by <m> [--dry-run]');
  const by = requireOption(args, 'by', '<m>', 'GUILD_ACTOR');
  const note = optionalOption(args, 'note');
  const invokedBy = resolveInvokedBy(by, 'approve', id);
  if (isDryRun(args)) {
    const prior = await c.requestUC.show(id);
    if (!prior) throw new Error(`Request not found: ${id}`);
    const fromState = prior.state;
    const r = await c.requestUC.approve(id, by, note, invokedBy, { dryRun: true });
    emitDryRunPreview({ verb: 'approve', id, by, fromState, toState: r.state, after: r, format: parseFormat(args) });
    return 0;
  }
  const r = await c.requestUC.approve(id, by, note, invokedBy);
  // Self-approval is policy-allowed but worth flagging on stderr so
  // the no-second-pair-of-eyes case never happens silently. Use the
  // on-record actor (`by`), not GUILD_ACTOR — invoked_by is already
  // surfaced separately by resolveInvokedBy above.
  if (by === r.from.value) {
    process.stderr.write(
      `notice: ${by} approved their own request ${id} ` +
        `(no second reviewer; for a single-step self-flow use ` +
        `'gate fast-track').\n`,
    );
  }
  emitWriteResponse(parseFormat(args), r, `✓ approved: ${id}`, c.config);
  return 0;
}

export async function reqDeny(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, DENY_KNOWN_FLAGS, 'deny');
  const id = args.positional[0];
  const reason = await resolveReason(args, 'deny');
  if (!id || !reason) {
    throw new Error(
      'Usage: gate deny <id> --by <m> [--note <s> | --reason <s> | <reason>] [--dry-run]' +
        dashedValueHint(args, ['reason', 'note']),
    );
  }
  const by = requireOption(args, 'by', '<m>', 'GUILD_ACTOR');
  const invokedBy = resolveInvokedBy(by, 'deny', id);
  if (isDryRun(args)) {
    const prior = await c.requestUC.show(id);
    if (!prior) throw new Error(`Request not found: ${id}`);
    const fromState = prior.state;
    const r = await c.requestUC.deny(id, by, reason, invokedBy, { dryRun: true });
    emitDryRunPreview({ verb: 'deny', id, by, fromState, toState: r.state, after: r, format: parseFormat(args) });
    return 0;
  }
  const r = await c.requestUC.deny(id, by, reason, invokedBy);
  emitWriteResponse(parseFormat(args), r, `✓ denied: ${id}`, c.config);
  return 0;
}

export async function reqExecute(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, EXECUTE_KNOWN_FLAGS, 'execute');
  const id = args.positional[0];
  if (!id) throw new Error('Usage: gate execute <id> --by <m> [--dry-run]');
  const by = requireOption(args, 'by', '<m>', 'GUILD_ACTOR');
  const note = optionalOption(args, 'note');
  const invokedBy = resolveInvokedBy(by, 'execute', id);
  if (isDryRun(args)) {
    const prior = await c.requestUC.show(id);
    if (!prior) throw new Error(`Request not found: ${id}`);
    const fromState = prior.state;
    const r = await c.requestUC.execute(id, by, note, invokedBy, { dryRun: true });
    emitDryRunPreview({ verb: 'execute', id, by, fromState, toState: r.state, after: r, format: parseFormat(args) });
    return 0;
  }
  const r = await c.requestUC.execute(id, by, note, invokedBy);
  // `--executor` / `--executors` is informational, not access
  // control: the substrate records both the assignment and the actual
  // actor, but does not refuse a mismatched execute. Surface a notice
  // so a fresh agent who reads `--executor bob` doesn't silently
  // interpret it as a gate. See issue #168 for the design rationale
  // ("anyone may execute; the audit trail captures who did"). Mirrors
  // the shape of the self-approve notice on `gate approve`.
  //
  // Multi-executor (issue #230 — Devil review blocker 1): the notice
  // fires only when `by` is NOT in the assigned set. Earlier shape
  // (`assignedExecutor !== by` against scalar first-of-list) would
  // print "assigned to miki" when leysia executed a request with
  // `--executors miki,leysia` — a false-positive misdirection that
  // contradicts the actual record. Membership check resolves both
  // false-positives and silent drops.
  const assigned = r.executors;
  if (assigned.length > 0 && !r.hasExecutor(by)) {
    const assignedList = assigned.map((m) => m.value).join(', ');
    const noun = assigned.length === 1 ? 'assigned to' : 'assigned to one of';
    process.stderr.write(
      `notice: ${by} executed request ${id} (${noun} ` +
        `${assignedList}); --executor records intent, not access.\n`,
    );
  }
  emitWriteResponse(parseFormat(args), r, `✓ executing: ${id}`, c.config);
  return 0;
}

export async function reqComplete(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, COMPLETE_KNOWN_FLAGS, 'complete');
  const id = args.positional[0];
  if (!id) throw new Error('Usage: gate complete <id> --by <m> [--dry-run]');
  const by = requireOption(args, 'by', '<m>', 'GUILD_ACTOR');
  const note = optionalOption(args, 'note');
  const invokedBy = resolveInvokedBy(by, 'complete', id);
  if (isDryRun(args)) {
    const prior = await c.requestUC.show(id);
    if (!prior) throw new Error(`Request not found: ${id}`);
    const fromState = prior.state;
    const r = await c.requestUC.complete(id, by, note, invokedBy, { dryRun: true });
    emitDryRunPreview({ verb: 'complete', id, by, fromState, toState: r.state, after: r, format: parseFormat(args) });
    return 0;
  }
  const r = await c.requestUC.complete(id, by, note, invokedBy);
  const extraLines: string[] = [];
  if (r.autoReview) {
    const reviewer = r.autoReview.value;
    const tpl =
      `gate review ${id} --by ${reviewer} --lense devil ` +
      `--verdict <ok|concern|reject> "<comment>"`;
    extraLines.push(`→ auto-review pending for: ${reviewer}`);
    extraLines.push(`  ${tpl}`);
  }
  emitWriteResponse(parseFormat(args), r, `✓ completed: ${id}`, c.config, extraLines);
  return 0;
}

export async function reqFail(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, FAIL_KNOWN_FLAGS, 'fail');
  const id = args.positional[0];
  const reason = await resolveReason(args, 'fail');
  if (!id || !reason) {
    throw new Error(
      'Usage: gate fail <id> --by <m> [--note <s> | --reason <s> | <reason>] [--dry-run]' +
        dashedValueHint(args, ['reason', 'note']),
    );
  }
  const by = requireOption(args, 'by', '<m>', 'GUILD_ACTOR');
  const invokedBy = resolveInvokedBy(by, 'fail', id);
  if (isDryRun(args)) {
    const prior = await c.requestUC.show(id);
    if (!prior) throw new Error(`Request not found: ${id}`);
    const fromState = prior.state;
    const r = await c.requestUC.fail(id, by, reason, invokedBy, { dryRun: true });
    emitDryRunPreview({ verb: 'fail', id, by, fromState, toState: r.state, after: r, format: parseFormat(args) });
    return 0;
  }
  const r = await c.requestUC.fail(id, by, reason, invokedBy);
  emitWriteResponse(parseFormat(args), r, `✓ failed: ${id}`, c.config);
  return 0;
}

// Append a short hint to usage errors when one of the string-valued
// flags landed as boolean (meaning the user passed a value that began
// with "--" and the parser refused to consume it). Parallels the same
// hint added inline in requireOption. Returns an empty string when no
// flag is in that state, so the usage message stays clean in the
// common forgot-the-arg case.
function dashedValueHint(args: ParsedArgs, keys: readonly string[]): string {
  const tripped = keys.filter((k) => args.options[k] === true);
  if (tripped.length === 0) return '';
  const pairs = tripped.map((k) => `--${k}=<value>`).join(' / ');
  return (
    `\n  (Your ${tripped.map((k) => '--' + k).join(' / ')} value began with "--" ` +
    `and was not consumed. Use ${pairs} or put "-- <value>" after the other flags.)`
  );
}

/**
 * Parse `--with eris,alice` (comma-separated) into a clean string list.
 * Empty entries and whitespace-only entries are dropped so
 * `--with "eris, , alice"` behaves the way it reads. Exact name
 * validation happens upstream (MemberName.of / assertActor).
 */
/**
 * Parse `--executors a,b,c` (issue #230) into a clean string list with
 * structural validation done at the interface boundary so the user sees
 * a flag-shaped error before any domain hydration occurs.
 *
 * Rules (per spec):
 *   - Empty / whitespace-only entry  → error  (`--executors miki,` is a typo, not "no second")
 *   - Duplicate entry                → error  (silent dedupe would mask the typo)
 *   - Per-entry charset              → MemberName.of validates regex / reserved names
 *
 * Returns either `{ list, error: undefined }` on success or
 * `{ list: [], error: <message> }` on failure. Caller writes the
 * message to stderr and returns exit 1.
 */
export function parseExecutorsList(
  raw: string,
): { list: string[]; error?: string } {
  const parts = raw.split(',').map((s) => s.trim());
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    if (p.length === 0) {
      return {
        list: [],
        error:
          'contains empty entry — comma-separated list must have no blanks ' +
          '(e.g. "miki,leysia", not "miki," or "miki,,leysia")',
      };
    }
    const lower = p.toLowerCase();
    if (seen.has(lower)) {
      return {
        list: [],
        error: `contains duplicate executor "${lower}" — each name may appear at most once`,
      };
    }
    seen.add(lower);
    out.push(p);
  }
  return { list: out };
}

function parseWithList(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Resolve the closure reason for deny/fail accepting any of:
//   --reason <s>    explicit & semantically precise
//   --reason -      STDIN (parity with `gate review --comment -`)
//   --note <s>      muscle-memory parity with approve/execute/complete
//   --note -        STDIN
//   <positional>    legacy form retained for back-compat
// Explicit options take precedence over positional.
async function resolveReason(args: ParsedArgs, _verb: string): Promise<string> {
  const reasonOpt = optionalOption(args, 'reason');
  const noteOpt = optionalOption(args, 'note');
  if (reasonOpt === '-') return (await readStdin()).trim();
  if (reasonOpt !== undefined && reasonOpt.trim()) return reasonOpt;
  if (noteOpt === '-') return (await readStdin()).trim();
  if (noteOpt !== undefined && noteOpt.trim()) return noteOpt;
  return args.positional.slice(1).join(' ');
}

export async function reqFastTrack(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, FAST_TRACK_KNOWN_FLAGS, 'fast-track');
  const from = requireOption(args, 'from', '<m>', 'GUILD_ACTOR');
  const action = requireOption(args, 'action', '"..."');
  let reason = requireOption(args, 'reason', '"..."');
  if (reason === '-') reason = (await readStdin()).trim();
  const executorOpt = optionalOption(args, 'executor');
  const executorsRaw = optionalOption(args, 'executors');
  const autoReview = optionalOption(args, 'auto-review');
  const note = optionalOption(args, 'note');
  const withPartners = parseWithList(optionalOption(args, 'with'));
  // Same mutual-exclusion as `gate request`. Fast-track defaults the
  // single-executor case to `from` (self-execute) when neither flag
  // is supplied; the multi-executor case must be explicit.
  if (executorOpt !== undefined && executorsRaw !== undefined) {
    process.stderr.write(
      `error: --executor and --executors are mutually exclusive (got both).\n`,
    );
    return 1;
  }
  let executorsList: readonly string[] | undefined;
  if (executorsRaw !== undefined) {
    const parsed = parseExecutorsList(executorsRaw);
    if (parsed.error) {
      process.stderr.write(`error: --executors ${parsed.error}\n`);
      return 1;
    }
    if (parsed.list.length > 0) executorsList = parsed.list;
  }
  // Single-executor surface: explicit --executor wins, else default
  // to the author for the self-execute happy path.
  const executor = executorsList === undefined
    ? (executorOpt ?? from)
    : undefined;

  const createInput: Parameters<typeof c.requestUC.create>[0] = {
    from,
    action,
    reason,
  };
  if (executor !== undefined) createInput.executor = executor;
  if (executorsList !== undefined) createInput.executors = executorsList;
  if (autoReview !== undefined) createInput.autoReview = autoReview;
  if (withPartners.length > 0) createInput.with = withPartners;
  const created = await c.requestUC.create(createInput);
  const id = created.id.value;

  // Fast-track is one user-facing command even though it executes
  // three transitions. Resolve the invoker once (which also prints
  // the delegation notice exactly once) and pass it to each step.
  const invokedByFrom = resolveInvokedBy(from, 'fast-track', id);
  // For the execute/complete steps fast-track needs ONE actor on
  // record. With --executors a,b the substrate genuinely doesn't know
  // which one ran the work — pick the first as the on-record actor
  // (deterministic, explicit in the assignment list) and let the
  // status_log + invoked_by capture the rest. Single-executor stays
  // exactly as before.
  const execActor = executor ?? executorsList?.[0] ?? from;
  // `execActor` may legitimately differ from `from`; when it does we
  // don't emit a second notice here — the env actor vs executor
  // mismatch is the same delegation already surfaced above.
  const envActor = resolveGuildActor();
  const invokedByExec =
    envActor && envActor.length > 0 && envActor !== execActor
      ? envActor
      : undefined;
  await c.requestUC.approve(id, from, 'fast-track: self-approved', invokedByFrom);
  await c.requestUC.execute(id, execActor, 'fast-track: self-executed', invokedByExec);
  const completed = await c.requestUC.complete(id, execActor, note, invokedByExec);

  const extraLines: string[] = [];
  if (completed.autoReview) {
    const reviewer = completed.autoReview.value;
    const tpl =
      `gate review ${id} --by ${reviewer} --lense devil ` +
      `--verdict <ok|concern|reject> "<comment>"`;
    extraLines.push(`→ auto-review pending for: ${reviewer}`);
    extraLines.push(`  ${tpl}`);
  }
  emitWriteResponse(
    parseFormat(args),
    completed,
    `✓ fast-tracked: ${id} (pending→completed)`,
    c.config,
    extraLines,
  );
  return 0;
}

function printSummary(r: Request, markerWidth = 16): void {
  const j = r.toJSON();
  const markers = formatReviewMarkers(j['reviews'], markerWidth);
  process.stdout.write(
    `${j['id']}  [${j['state']}]  from=${j['from']}  ${markers}${String(j['action']).slice(0, 60)}\n`,
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
