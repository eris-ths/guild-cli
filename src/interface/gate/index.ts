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
  gate pending
  gate list --state <state>
  gate show <id>
  gate approve <id> --by <m> [--note <s>]
  gate deny <id> --by <m> <reason>
  gate execute <id> --by <m> [--note <s>]
  gate complete <id> --by <m> [--note <s>]
  gate fail <id> --by <m> <reason>
  gate review <id> --by <m> --lense <l> --verdict <v> <comment>

Issues:
  gate issues add --from <m> --severity <s> --area <a> <text>
  gate issues list [--state <s>]
  gate issues resolve|defer|start|reopen <id>
  gate issues promote <id> --from <m> [--executor <m>] [--auto-review <m>]
                                      [--action <a>] [--reason <r>]

Messages:
  gate message --from <m> --to <m> --text <s>
  gate broadcast --from <m> --text <s>
  gate inbox --for <m> [--unread]

States: pending | approved | executing | completed | failed | denied
Verdicts: ok | concern | reject
Lenses: devil | layer | cognitive | user
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
        return await reqList(c, 'pending');
      case 'list': {
        const state = requireOption(args, 'state', 'gate list --state <s>');
        return await reqList(c, state);
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
  const from = requireOption(args, 'from', 'gate request --from <m> ...');
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

async function reqList(c: C, state: string): Promise<number> {
  const items = await c.requestUC.listByState(state);
  if (items.length === 0) {
    process.stdout.write(`(no requests in ${state})\n`);
    return 0;
  }
  for (const r of items) printSummary(r);
  return 0;
}

async function reqShow(c: C, args: ParsedArgs): Promise<number> {
  const id = args.positional[0];
  if (!id) throw new Error('Usage: gate show <id>');
  const r = await c.requestUC.show(id);
  if (!r) {
    process.stderr.write(`not found: ${id}\n`);
    return 1;
  }
  process.stdout.write(JSON.stringify(r.toJSON(), null, 2) + '\n');
  return 0;
}

async function reqApprove(c: C, args: ParsedArgs): Promise<number> {
  const id = args.positional[0];
  if (!id) throw new Error('Usage: gate approve <id> --by <m>');
  const by = requireOption(args, 'by', '--by required');
  const note = optionalOption(args, 'note');
  await c.requestUC.approve(id, by, note);
  process.stdout.write(`✓ approved: ${id}\n`);
  return 0;
}

async function reqDeny(c: C, args: ParsedArgs): Promise<number> {
  const id = args.positional[0];
  const reason = args.positional.slice(1).join(' ');
  if (!id || !reason) throw new Error('Usage: gate deny <id> --by <m> <reason>');
  const by = requireOption(args, 'by', '--by required');
  await c.requestUC.deny(id, by, reason);
  process.stdout.write(`✓ denied: ${id}\n`);
  return 0;
}

async function reqExecute(c: C, args: ParsedArgs): Promise<number> {
  const id = args.positional[0];
  if (!id) throw new Error('Usage: gate execute <id> --by <m>');
  const by = requireOption(args, 'by', '--by required');
  const note = optionalOption(args, 'note');
  await c.requestUC.execute(id, by, note);
  process.stdout.write(`✓ executing: ${id}\n`);
  return 0;
}

async function reqComplete(c: C, args: ParsedArgs): Promise<number> {
  const id = args.positional[0];
  if (!id) throw new Error('Usage: gate complete <id> --by <m>');
  const by = requireOption(args, 'by', '--by required');
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
  const by = requireOption(args, 'by', '--by required');
  await c.requestUC.fail(id, by, reason);
  process.stdout.write(`✓ failed: ${id}\n`);
  return 0;
}

async function reqReview(c: C, args: ParsedArgs): Promise<number> {
  const id = args.positional[0];
  const comment = args.positional.slice(1).join(' ');
  if (!id || !comment)
    throw new Error(
      'Usage: gate review <id> --by <m> --lense <l> --verdict <v> <comment>',
    );
  const by = requireOption(args, 'by', '--by required');
  const lense = requireOption(args, 'lense', '--lense required');
  const verdict = requireOption(args, 'verdict', '--verdict required');
  await c.requestUC.review({ id, by, lense, verdict, comment });
  process.stdout.write(`✓ review recorded: ${id} [${lense}/${verdict}]\n`);
  return 0;
}

async function issuesCmd(c: C, args: ParsedArgs): Promise<number> {
  const sub = args.positional[0];
  if (sub === 'promote') {
    return await issuesPromote(c, args);
  }
  if (sub === 'add') {
    const from = requireOption(args, 'from', '--from required');
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
  const from = requireOption(args, 'from', '--from required');
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
  const from = requireOption(args, 'from', '--from required');
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
  const from = requireOption(args, 'from', '--from required');
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
  const forName = requireOption(args, 'for', '--for required');
  const unreadOnly = args.options['unread'] === true;
  const messages = await c.messageUC.inbox(forName);
  const filtered = unreadOnly ? messages.filter((m) => !m.read) : messages;
  if (filtered.length === 0) {
    process.stdout.write(
      unreadOnly
        ? `(no unread messages for ${forName})\n`
        : `(inbox empty for ${forName})\n`,
    );
    return 0;
  }
  for (const m of filtered) {
    const flag = m.read ? ' ' : '*';
    const related = m.related ? ` (ref: ${m.related})` : '';
    process.stdout.write(
      `${flag} [${m.at}] ${m.type} from ${m.from}${related}\n  ${m.text}\n`,
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
