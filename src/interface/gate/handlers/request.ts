import {
  ParsedArgs,
  requireOption,
  optionalOption,
} from '../../shared/parseArgs.js';
import { Request } from '../../../domain/request/Request.js';
import { formatDelta } from '../voices.js';
import { C, readStdin, resolveInvokedBy } from './internal.js';
import { emitWriteResponse, parseFormat } from './writeFormat.js';

export async function reqCreate(c: C, args: ParsedArgs): Promise<number> {
  const from = requireOption(
    args,
    'from',
    'gate request --from <m> ...',
    'GUILD_ACTOR',
  );
  const action = requireOption(args, 'action', '--action required');
  let reason = requireOption(args, 'reason', '--reason required');
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
  const target = optionalOption(args, 'target');
  const autoReview = optionalOption(args, 'auto-review');
  const withPartners = parseWithList(optionalOption(args, 'with'));
  if (executor !== undefined) input.executor = executor;
  if (target !== undefined) input.target = target;
  if (autoReview !== undefined) input.autoReview = autoReview;
  if (withPartners.length > 0) input.with = withPartners;
  const r = await c.requestUC.create(input);
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
): Promise<number> {
  const fromFilter = optionalOption(args, 'from');
  const executorFilter = optionalOption(args, 'executor');
  const autoReviewFilter = optionalOption(args, 'auto-review');
  const explicitFor = optionalOption(args, 'for');
  const envActor =
    explicitFor === undefined && process.env['GUILD_ACTOR']
      ? process.env['GUILD_ACTOR']
      : undefined;
  const forFilter = explicitFor ?? envActor;

  let items = await c.requestUC.listByState(state);
  if (fromFilter !== undefined) {
    items = items.filter((r) => r.from.value === fromFilter);
  }
  if (executorFilter !== undefined) {
    items = items.filter((r) => r.executor?.value === executorFilter);
  }
  if (autoReviewFilter !== undefined) {
    items = items.filter((r) => r.autoReview?.value === autoReviewFilter);
  }
  if (forFilter !== undefined) {
    items = items.filter(
      (r) =>
        r.from.value === forFilter ||
        r.executor?.value === forFilter ||
        r.autoReview?.value === forFilter,
    );
  }

  if (envActor !== undefined) {
    process.stderr.write(
      `# filtered by GUILD_ACTOR=${envActor} (use --for <m> or unset GUILD_ACTOR to override)\n`,
    );
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
  const id = args.positional[0];
  if (!id) throw new Error('Usage: gate show <id> [--format json|text]');
  const format = optionalOption(args, 'format') ?? 'json';
  if (format !== 'json' && format !== 'text') {
    throw new Error(`--format must be 'json' or 'text', got: ${format}`);
  }
  const r = await c.requestUC.show(id);
  if (!r) {
    process.stderr.write(`not found: ${id}\n`);
    return 1;
  }
  if (format === 'json') {
    process.stdout.write(JSON.stringify(r.toJSON(), null, 2) + '\n');
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
  if (j['executor']) lines.push(`  executor: ${j['executor']}`);
  if (j['target']) lines.push(`  target:   ${j['target']}`);
  if (j['auto_review']) lines.push(`  reviewer: ${j['auto_review']}`);
  if (Array.isArray(j['with']) && j['with'].length > 0) {
    lines.push(`  with:     ${(j['with'] as string[]).join(', ')}`);
  }
  lines.push(`  created:  ${j['created_at']}`);
  lines.push('');
  lines.push(`  action:   ${j['action']}`);
  lines.push(`  reason:   ${j['reason']}`);
  if (j['completion_note']) lines.push(`  note:     ${j['completion_note']}`);
  if (j['deny_reason']) lines.push(`  denied:   ${j['deny_reason']}`);
  if (j['failure_reason']) lines.push(`  failed:   ${j['failure_reason']}`);

  const log = Array.isArray(j['status_log']) ? j['status_log'] : [];
  if (log.length > 0) {
    lines.push('');
    lines.push(`  status_log (${log.length}):`);
    let prevAt: string | undefined;
    for (const entry of log as Array<Record<string, unknown>>) {
      const at = String(entry['at']);
      const note = entry['note'] ? ` — ${entry['note']}` : '';
      const delta = prevAt ? ` (${formatDelta(prevAt, at)})` : '';
      const invokedBy = entry['invoked_by']
        ? ` [invoked_by=${entry['invoked_by']}]`
        : '';
      lines.push(
        `    ${at}  ${entry['state']}  by ${entry['by']}${invokedBy}${delta}${note}`,
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
  return lines.join('\n');
}

export async function reqApprove(c: C, args: ParsedArgs): Promise<number> {
  const id = args.positional[0];
  if (!id) throw new Error('Usage: gate approve <id> --by <m>');
  const by = requireOption(args, 'by', '--by required', 'GUILD_ACTOR');
  const note = optionalOption(args, 'note');
  const invokedBy = resolveInvokedBy(by, 'approve', id);
  const r = await c.requestUC.approve(id, by, note, invokedBy);
  emitWriteResponse(parseFormat(args), r, `✓ approved: ${id}`, c.config);
  return 0;
}

export async function reqDeny(c: C, args: ParsedArgs): Promise<number> {
  const id = args.positional[0];
  const reason = await resolveReason(args, 'deny');
  if (!id || !reason) {
    throw new Error(
      'Usage: gate deny <id> --by <m> [--note <s> | --reason <s> | <reason>]' +
        dashedValueHint(args, ['reason', 'note']),
    );
  }
  const by = requireOption(args, 'by', '--by required', 'GUILD_ACTOR');
  const invokedBy = resolveInvokedBy(by, 'deny', id);
  const r = await c.requestUC.deny(id, by, reason, invokedBy);
  emitWriteResponse(parseFormat(args), r, `✓ denied: ${id}`, c.config);
  return 0;
}

export async function reqExecute(c: C, args: ParsedArgs): Promise<number> {
  const id = args.positional[0];
  if (!id) throw new Error('Usage: gate execute <id> --by <m>');
  const by = requireOption(args, 'by', '--by required', 'GUILD_ACTOR');
  const note = optionalOption(args, 'note');
  const invokedBy = resolveInvokedBy(by, 'execute', id);
  const r = await c.requestUC.execute(id, by, note, invokedBy);
  emitWriteResponse(parseFormat(args), r, `✓ executing: ${id}`, c.config);
  return 0;
}

export async function reqComplete(c: C, args: ParsedArgs): Promise<number> {
  const id = args.positional[0];
  if (!id) throw new Error('Usage: gate complete <id> --by <m>');
  const by = requireOption(args, 'by', '--by required', 'GUILD_ACTOR');
  const note = optionalOption(args, 'note');
  const invokedBy = resolveInvokedBy(by, 'complete', id);
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
  const id = args.positional[0];
  const reason = await resolveReason(args, 'fail');
  if (!id || !reason) {
    throw new Error(
      'Usage: gate fail <id> --by <m> [--note <s> | --reason <s> | <reason>]' +
        dashedValueHint(args, ['reason', 'note']),
    );
  }
  const by = requireOption(args, 'by', '--by required', 'GUILD_ACTOR');
  const invokedBy = resolveInvokedBy(by, 'fail', id);
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
  const from = requireOption(args, 'from', '--from required', 'GUILD_ACTOR');
  const action = requireOption(args, 'action', '--action required');
  let reason = requireOption(args, 'reason', '--reason required');
  if (reason === '-') reason = (await readStdin()).trim();
  const executor = optionalOption(args, 'executor') ?? from;
  const autoReview = optionalOption(args, 'auto-review');
  const note = optionalOption(args, 'note');
  const withPartners = parseWithList(optionalOption(args, 'with'));

  const createInput: Parameters<typeof c.requestUC.create>[0] = {
    from,
    action,
    reason,
    executor,
  };
  if (autoReview !== undefined) createInput.autoReview = autoReview;
  if (withPartners.length > 0) createInput.with = withPartners;
  const created = await c.requestUC.create(createInput);
  const id = created.id.value;

  // Fast-track is one user-facing command even though it executes
  // three transitions. Resolve the invoker once (which also prints
  // the delegation notice exactly once) and pass it to each step.
  const invokedByFrom = resolveInvokedBy(from, 'fast-track', id);
  // `executor` may legitimately differ from `from`; when it does we
  // don't emit a second notice here — the env actor vs executor
  // mismatch is the same delegation already surfaced above.
  const envActor = process.env['GUILD_ACTOR'];
  const invokedByExec =
    envActor && envActor.length > 0 && envActor !== executor
      ? envActor
      : undefined;
  await c.requestUC.approve(id, from, 'fast-track: self-approved', invokedByFrom);
  await c.requestUC.execute(id, executor, 'fast-track: self-executed', invokedByExec);
  const completed = await c.requestUC.complete(id, executor, note, invokedByExec);

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

// Render a compact per-lens verdict summary like "✓devil ✓layer" or
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
