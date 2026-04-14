import { buildContainer } from '../shared/container.js';
import {
  parseArgs,
  requireOption,
  optionalOption,
  ParsedArgs,
} from '../shared/parseArgs.js';
import { DomainError } from '../../domain/shared/DomainError.js';
import { Request } from '../../domain/request/Request.js';

const HELP = `gate — request lifecycle & dialogue CLI

Requests:
  gate request --from <m> --action <a> --reason <r>
                 [--executor <m>] [--target <s>] [--auto-review <m>]
  gate pending [--for <m>]
  gate list --state <state> [--for <m>] [--from <m>]
                            [--executor <m>] [--auto-review <m>]
  gate show <id> [--format json|text]
  gate approve <id> --by <m> [--note <s>]
  gate deny <id> --by <m> <reason>
  gate execute <id> --by <m> [--note <s>]
  gate complete <id> --by <m> [--note <s>]
  gate fail <id> --by <m> <reason>
  gate review <id> --by <m> --lense <l> --verdict <v>
                   [--comment <s> | --comment - | <comment>]
  gate fast-track --from <m> --action <a> --reason <r>
                  [--executor <m>] [--auto-review <m>] [--note <s>]

Issues:
  gate issues add --from <m> --severity <s> --area <a> <text>
  gate issues list [--state <s>]
  gate issues resolve|defer|start|reopen <id>
  gate issues promote <id> --from <m> [--executor <m>] [--auto-review <m>]
                                      [--action <a>] [--reason <r>]

Messages:
  gate message --from <m> --to <m> --text <s>
  gate broadcast --from <m> --text <s>
  gate inbox --for <m>

States: pending | approved | executing | completed | failed | denied
Verdicts: ok | concern | reject
Lenses: devil | layer | cognitive | user

Environment:
  GUILD_ACTOR=<name>   If set, used as the default for --from / --by /
                       --for when those flags are omitted. Explicit flags
                       always win. Intended for interactive shells
                       (export it in your shell profile or direnv).
                       Automations should continue to pass --from / --by
                       explicitly.
`;

export async function main(argv: readonly string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  const args = parseArgs(rest);
  const c = buildContainer();
  try {
    switch (cmd) {
      case 'request':
        return await reqCreate(c, args);
      case 'pending':
        return await reqList(c, 'pending', args);
      case 'list': {
        const state = requireOption(args, 'state', 'gate list --state <s>');
        return await reqList(c, state, args);
      }
      case 'show':
        return await reqShow(c, args);
      case 'approve':
        return await reqApprove(c, args);
      case 'deny':
        return await reqDeny(c, args);
      case 'execute':
        return await reqExecute(c, args);
      case 'complete':
        return await reqComplete(c, args);
      case 'fail':
        return await reqFail(c, args);
      case 'review':
        return await reqReview(c, args);
      case 'fast-track':
        return await reqFastTrack(c, args);
      case 'issues':
        return await issuesCmd(c, args);
      case 'message':
        return await msgSend(c, args);
      case 'broadcast':
        return await msgBroadcast(c, args);
      case 'inbox':
        return await msgInbox(c, args);
      default:
        process.stderr.write(`unknown command: ${cmd}\n${HELP}`);
        return 1;
    }
  } catch (e) {
    const msg = e instanceof DomainError
      ? `DomainError: ${e.message}${e.field ? ` (${e.field})` : ''}`
      : e instanceof Error
        ? e.message
        : String(e);
    process.stderr.write(`error: ${msg}\n`);
    return 1;
  }
}

type C = ReturnType<typeof buildContainer>;

async function reqCreate(c: C, args: ParsedArgs): Promise<number> {
  const from = requireOption(
    args,
    'from',
    'gate request --from <m> ...',
    'GUILD_ACTOR',
  );
  const action = requireOption(args, 'action', '--action required');
  const reason = requireOption(args, 'reason', '--reason required');
  const input: Parameters<typeof c.requestUC.create>[0] = {
    from,
    action,
    reason,
  };
  const executor = optionalOption(args, 'executor');
  const target = optionalOption(args, 'target');
  const autoReview = optionalOption(args, 'auto-review');
  if (executor !== undefined) input.executor = executor;
  if (target !== undefined) input.target = target;
  if (autoReview !== undefined) input.autoReview = autoReview;
  const r = await c.requestUC.create(input);
  process.stdout.write(`✓ created: ${r.id.value} (state=pending)\n`);
  return 0;
}

async function reqList(
  c: C,
  state: string,
  args: ParsedArgs,
): Promise<number> {
  const fromFilter = optionalOption(args, 'from');
  const executorFilter = optionalOption(args, 'executor');
  const autoReviewFilter = optionalOption(args, 'auto-review');
  // --for is sugar: "anything I touch" — match if I'm the author, the
  // executor, or the assigned reviewer. Combines with other filters via
  // AND, not OR.
  //
  // Env fallback: if --for is omitted and GUILD_ACTOR is set, use that
  // as the implicit filter. This lets interactive users treat
  // `gate pending` as "my queue" without retyping their name every time,
  // without moving identity state into shared config. We also emit a
  // one-line hint to stderr so the behavior is discoverable.
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
  for (const r of items) printSummary(r);
  return 0;
}

function describeFilters(filters: Record<string, string | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined) parts.push(`${k}=${v}`);
  }
  return parts.length === 0 ? '' : ` with ${parts.join(', ')}`;
}

async function reqShow(c: C, args: ParsedArgs): Promise<number> {
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
  lines.push(`  created:  ${j['created_at']}`);
  lines.push('');
  lines.push(`  action:   ${j['action']}`);
  lines.push(`  reason:   ${j['reason']}`);
  if (j['completion_note']) {
    lines.push(`  note:     ${j['completion_note']}`);
  }
  if (j['deny_reason']) {
    lines.push(`  denied:   ${j['deny_reason']}`);
  }
  if (j['failure_reason']) {
    lines.push(`  failed:   ${j['failure_reason']}`);
  }

  const log = Array.isArray(j['status_log']) ? j['status_log'] : [];
  if (log.length > 0) {
    lines.push('');
    lines.push(`  status_log (${log.length}):`);
    for (const entry of log as Array<Record<string, unknown>>) {
      const note = entry['note'] ? ` — ${entry['note']}` : '';
      lines.push(
        `    ${entry['at']}  ${entry['state']}  by ${entry['by']}${note}`,
      );
    }
  }

  const reviews = Array.isArray(j['reviews']) ? j['reviews'] : [];
  if (reviews.length > 0) {
    lines.push('');
    lines.push(`  reviews (${reviews.length}):`);
    for (const rv of reviews as Array<Record<string, unknown>>) {
      lines.push(
        `    [${rv['lense']}/${rv['verdict']}] by ${rv['by']} at ${rv['at']}`,
      );
      const comment = String(rv['comment'] ?? '');
      for (const line of comment.split('\n')) {
        lines.push(`      ${line}`);
      }
    }
  }
  return lines.join('\n');
}

async function reqApprove(c: C, args: ParsedArgs): Promise<number> {
  const id = args.positional[0];
  if (!id) throw new Error('Usage: gate approve <id> --by <m>');
  const by = requireOption(args, 'by', '--by required', 'GUILD_ACTOR');
  const note = optionalOption(args, 'note');
  await c.requestUC.approve(id, by, note);
  process.stdout.write(`✓ approved: ${id}\n`);
  return 0;
}

async function reqDeny(c: C, args: ParsedArgs): Promise<number> {
  const id = args.positional[0];
  const reason = args.positional.slice(1).join(' ');
  if (!id || !reason) throw new Error('Usage: gate deny <id> --by <m> <reason>');
  const by = requireOption(args, 'by', '--by required', 'GUILD_ACTOR');
  await c.requestUC.deny(id, by, reason);
  process.stdout.write(`✓ denied: ${id}\n`);
  return 0;
}

async function reqExecute(c: C, args: ParsedArgs): Promise<number> {
  const id = args.positional[0];
  if (!id) throw new Error('Usage: gate execute <id> --by <m>');
  const by = requireOption(args, 'by', '--by required', 'GUILD_ACTOR');
  const note = optionalOption(args, 'note');
  await c.requestUC.execute(id, by, note);
  process.stdout.write(`✓ executing: ${id}\n`);
  return 0;
}

async function reqComplete(c: C, args: ParsedArgs): Promise<number> {
  const id = args.positional[0];
  if (!id) throw new Error('Usage: gate complete <id> --by <m>');
  const by = requireOption(args, 'by', '--by required', 'GUILD_ACTOR');
  const note = optionalOption(args, 'note');
  const r = await c.requestUC.complete(id, by, note);
  process.stdout.write(`✓ completed: ${id}\n`);
  // auto-review hint: if autoReview was set on the request, emit a
  // ready-to-run `gate review` command template. This is persistence-only
  // today (see README), so the outer orchestrator still has to invoke it —
  // we just save it the trouble of constructing the command.
  if (r.autoReview) {
    const reviewer = r.autoReview.value;
    const tpl =
      `gate review ${id} --by ${reviewer} --lense devil ` +
      `--verdict <ok|concern|reject> "<comment>"`;
    process.stdout.write(`→ auto-review pending for: ${reviewer}\n`);
    process.stdout.write(`  ${tpl}\n`);
  }
  return 0;
}

async function reqFail(c: C, args: ParsedArgs): Promise<number> {
  const id = args.positional[0];
  const reason = args.positional.slice(1).join(' ');
  if (!id || !reason) throw new Error('Usage: gate fail <id> --by <m> <reason>');
  const by = requireOption(args, 'by', '--by required', 'GUILD_ACTOR');
  await c.requestUC.fail(id, by, reason);
  process.stdout.write(`✓ failed: ${id}\n`);
  return 0;
}

async function reqReview(c: C, args: ParsedArgs): Promise<number> {
  const id = args.positional[0];
  if (!id) {
    throw new Error(
      'Usage: gate review <id> --by <m> --lense <l> --verdict <v> ' +
        '[--comment <s> | --comment - | <comment>]',
    );
  }
  const by = requireOption(args, 'by', '--by required', 'GUILD_ACTOR');
  const lense = requireOption(args, 'lense', '--lense required');
  const verdict = requireOption(args, 'verdict', '--verdict required');

  // Comment resolution order:
  //   1. --comment <s>  (option value)
  //   2. --comment -    (read STDIN until EOF — for piped/heredoc input)
  //   3. <positional>   (legacy: everything after <id>)
  const commentOpt = optionalOption(args, 'comment');
  let comment: string;
  if (commentOpt === '-') {
    comment = await readStdin();
  } else if (commentOpt !== undefined) {
    comment = commentOpt;
  } else {
    comment = args.positional.slice(1).join(' ');
  }
  if (!comment.trim()) {
    throw new Error(
      'review comment is required (use --comment <s>, --comment - for STDIN, ' +
        'or a positional argument)',
    );
  }

  await c.requestUC.review({ id, by, lense, verdict, comment });
  process.stdout.write(`✓ review recorded: ${id} [${lense}/${verdict}]\n`);
  return 0;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function reqFastTrack(c: C, args: ParsedArgs): Promise<number> {
  const from = requireOption(args, 'from', '--from required', 'GUILD_ACTOR');
  const action = requireOption(args, 'action', '--action required');
  const reason = requireOption(args, 'reason', '--reason required');
  const executor = optionalOption(args, 'executor') ?? from;
  const autoReview = optionalOption(args, 'auto-review');
  const note = optionalOption(args, 'note');

  // Self-approval: fast-track is explicitly a "trust me, I'm doing this
  // myself" path. The record still captures who acted at each step, so
  // the audit trail is preserved — the Two-Persona Devil Review is just
  // not enforced up front (it can still happen via auto-review).
  const createInput: Parameters<typeof c.requestUC.create>[0] = {
    from,
    action,
    reason,
    executor,
  };
  if (autoReview !== undefined) createInput.autoReview = autoReview;
  const created = await c.requestUC.create(createInput);
  const id = created.id.value;

  await c.requestUC.approve(id, from, 'fast-track: self-approved');
  await c.requestUC.execute(id, executor, 'fast-track: self-executed');
  const completed = await c.requestUC.complete(id, executor, note);

  process.stdout.write(`✓ fast-tracked: ${id} (pending→completed)\n`);
  if (completed.autoReview) {
    const reviewer = completed.autoReview.value;
    const tpl =
      `gate review ${id} --by ${reviewer} --lense devil ` +
      `--verdict <ok|concern|reject> "<comment>"`;
    process.stdout.write(`→ auto-review pending for: ${reviewer}\n`);
    process.stdout.write(`  ${tpl}\n`);
  }
  return 0;
}

async function issuesCmd(c: C, args: ParsedArgs): Promise<number> {
  const sub = args.positional[0];
  if (sub === 'promote') {
    return await issuesPromote(c, args);
  }
  if (sub === 'add') {
    const from = requireOption(args, 'from', '--from required', 'GUILD_ACTOR');
    const severity = requireOption(args, 'severity', '--severity required');
    const area = requireOption(args, 'area', '--area required');
    const text = args.positional.slice(1).join(' ');
    if (!text) throw new Error('Usage: gate issues add ... <text>');
    const i = await c.issueUC.add({ from, severity, area, text });
    process.stdout.write(`✓ issue: ${i.id.value}\n`);
    return 0;
  }
  if (sub === 'list' || sub === undefined) {
    const state = optionalOption(args, 'state');
    const items = await c.issueUC.list(state);
    for (const i of items) {
      const j = i.toJSON();
      process.stdout.write(
        `${j['id']} [${j['severity']}/${j['area']}] ${j['state']} — ${j['text']}\n`,
      );
    }
    return 0;
  }
  // State transitions: resolve, defer, start, reopen.
  // Each is a thin alias over IssueUseCases.setState. The Issue domain
  // currently has no transition rules (unlike Request) — any state can
  // move to any other state, so e.g. `resolve` followed by `reopen` is
  // allowed by design. The enforcement point for future transition rules
  // is Issue.setState() in src/domain/issue/Issue.ts, not this CLI layer.
  const nextState = resolveIssueVerb(sub);
  if (nextState !== undefined) {
    const id = args.positional[1];
    if (!id) throw new Error(`Usage: gate issues ${sub} <id>`);
    const issue = await c.issueUC.setState(id, nextState);
    process.stdout.write(`✓ issue ${issue.id.value}: → ${nextState}\n`);
    return 0;
  }
  throw new Error(`unknown issues sub: ${sub}`);
}

async function issuesPromote(c: C, args: ParsedArgs): Promise<number> {
  const id = args.positional[1];
  if (!id) {
    throw new Error(
      'Usage: gate issues promote <id> --from <m> [--executor <m>] ' +
        '[--auto-review <m>] [--action <a>] [--reason <r>]',
    );
  }
  const from = requireOption(args, 'from', '--from required', 'GUILD_ACTOR');
  const executor = optionalOption(args, 'executor');
  const autoReview = optionalOption(args, 'auto-review');
  const actionOverride = optionalOption(args, 'action');
  const reasonOverride = optionalOption(args, 'reason');

  const issue = await c.issueUC.find(id);
  if (!issue) {
    process.stderr.write(`issue not found: ${id}\n`);
    return 1;
  }
  const j = issue.toJSON();
  // Early-exit on resolved issues for a friendly error. The domain
  // would also catch the resolved→resolved transition below via
  // assertIssueTransition, but that message is less user-facing.
  if (j['state'] === 'resolved') {
    throw new Error(
      `issue ${id} is already resolved; cannot promote a resolved issue`,
    );
  }

  const issueText = String(j['text']);
  const shortText = truncateCodePoints(issueText, 60);
  const action = actionOverride ?? `Fix issue ${id}: ${shortText}`;
  // Request MAX_TEXT is 4096 and Issue MAX_TEXT is 2048, so prefix + full
  // issue text always fits in reason. No truncation needed.
  const reason =
    reasonOverride ??
    `Promoted from ${id} (${j['severity']}/${j['area']}): ${issueText}`;

  const input: Parameters<typeof c.requestUC.create>[0] = {
    from,
    action,
    reason,
  };
  if (executor !== undefined) input.executor = executor;
  if (autoReview !== undefined) input.autoReview = autoReview;

  // Non-atomic by design: create the request first, then resolve the
  // issue. If the second step fails we still emit the request id so the
  // operator knows the partial state and can manually resolve the issue.
  const req = await c.requestUC.create(input);
  try {
    await c.issueUC.setState(id, 'resolved');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(
      `⚠ request created but issue state transition failed\n` +
        `  request: ${req.id.value} (pending)\n` +
        `  issue:   ${id} (state unchanged)\n` +
        `  cause:   ${msg}\n` +
        `  fix:     gate issues resolve ${id}\n`,
    );
    return 1;
  }
  process.stdout.write(
    `✓ promoted ${id} → ${req.id.value} (issue resolved)\n`,
  );
  return 0;
}

// Safely truncate a string by Unicode code points, not UTF-16 code units,
// so we never cleave a surrogate pair in half. Appends "..." when cut.
function truncateCodePoints(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  return chars.slice(0, max - 3).join('') + '...';
}

async function msgSend(c: C, args: ParsedArgs): Promise<number> {
  const from = requireOption(args, 'from', '--from required', 'GUILD_ACTOR');
  const to = requireOption(args, 'to', '--to required');
  const text = requireOption(args, 'text', '--text required');
  const type = optionalOption(args, 'type');
  await c.messageUC.send({
    from,
    to,
    text,
    ...(type !== undefined ? { type } : {}),
  });
  process.stdout.write(`✓ message sent: ${from} → ${to}\n`);
  return 0;
}

async function msgBroadcast(c: C, args: ParsedArgs): Promise<number> {
  const from = requireOption(args, 'from', '--from required', 'GUILD_ACTOR');
  const text = requireOption(args, 'text', '--text required');
  const type = optionalOption(args, 'type');
  const { delivered, failed } = await c.messageUC.broadcast({
    from,
    text,
    ...(type !== undefined ? { type } : {}),
  });
  if (delivered.length === 0 && failed.length === 0) {
    process.stdout.write(
      `(no recipients — ${from} is the only active member)\n`,
    );
    return 0;
  }
  if (delivered.length > 0) {
    process.stdout.write(
      `✓ broadcast from ${from} → ${delivered.length} recipient(s): ${delivered.join(', ')}\n`,
    );
  }
  if (failed.length > 0) {
    for (const f of failed) {
      process.stderr.write(`⚠ delivery failed: ${f.to} — ${f.error}\n`);
    }
    return 1;
  }
  return 0;
}

async function msgInbox(c: C, args: ParsedArgs): Promise<number> {
  const forName = requireOption(args, 'for', '--for required', 'GUILD_ACTOR');
  const messages = await c.messageUC.inbox(forName);
  if (messages.length === 0) {
    process.stdout.write(`(inbox empty for ${forName})\n`);
    return 0;
  }
  for (const m of messages) {
    const related = m.related ? ` (ref: ${m.related})` : '';
    process.stdout.write(
      `  [${m.at}] ${m.type} from ${m.from}${related}\n  ${m.text}\n`,
    );
  }
  return 0;
}

function resolveIssueVerb(sub: string | undefined): string | undefined {
  switch (sub) {
    case 'resolve':
      return 'resolved';
    case 'defer':
      return 'deferred';
    case 'start':
      return 'in_progress';
    case 'reopen':
      return 'open';
    default:
      return undefined;
  }
}

function printSummary(r: Request): void {
  const j = r.toJSON();
  process.stdout.write(
    `${j['id']}  [${j['state']}]  from=${j['from']}  ${String(j['action']).slice(0, 60)}\n`,
  );
}
