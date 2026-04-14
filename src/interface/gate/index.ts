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
  await c.requestUC.complete(id, by, note);
  process.stdout.write(`✓ completed: ${id}\n`);
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
  throw new Error(`unknown issues sub: ${sub}`);
}

function printSummary(r: Request): void {
  const j = r.toJSON();
  process.stdout.write(
    `${j['id']}  [${j['state']}]  from=${j['from']}  ${String(j['action']).slice(0, 60)}\n`,
  );
}
