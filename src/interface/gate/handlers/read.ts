import {
  ParsedArgs,
  optionalOption,
} from '../../shared/parseArgs.js';
import { parseLense } from '../../../domain/shared/Lense.js';
import { parseVerdict } from '../../../domain/shared/Verdict.js';
import { DomainError } from '../../../domain/shared/DomainError.js';
import { compareSequenceIds } from '../../../domain/shared/compareSequenceIds.js';
import {
  collectUtterances,
  renderUtterance,
  RequestJSON,
  VoicesFilter,
} from '../voices.js';
import {
  extractReferences,
  gatherIssueText,
  gatherRequestText,
} from '../chain.js';
import {
  C,
  parseOptionalIntOption,
  loadAllRequestsAsJson,
  truncateCodePoints,
} from './internal.js';

/**
 * Read-side verbs: voices / tail / whoami / chain.
 * All are non-destructive cross-cutting reads over the content_root,
 * intended for session orientation and narrative walks.
 */

export async function reqVoices(c: C, args: ParsedArgs): Promise<number> {
  const name = args.positional[0];
  if (!name) {
    throw new Error(
      'Usage: gate voices <name> [--lense <l>] [--verdict <v>] ' +
        '[--format json|text]',
    );
  }

  const lenseFilterRaw = optionalOption(args, 'lense');
  const verdictFilterRaw = optionalOption(args, 'verdict');
  const lenseFilter =
    lenseFilterRaw !== undefined ? parseLense(lenseFilterRaw) : undefined;
  const verdictFilter =
    verdictFilterRaw !== undefined ? parseVerdict(verdictFilterRaw) : undefined;
  const limit = parseOptionalIntOption(args, 'limit');
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    throw new Error(`--format must be 'json' or 'text', got: ${format}`);
  }

  const allJson = await loadAllRequestsAsJson(c);

  const filter: VoicesFilter = { name };
  if (lenseFilter !== undefined) {
    (filter as { lense?: string }).lense = lenseFilter;
  }
  if (verdictFilter !== undefined) {
    (filter as { verdict?: string }).verdict = verdictFilter;
  }
  if (limit !== undefined) {
    (filter as { limit?: number }).limit = limit;
  }
  const utterances = collectUtterances(allJson, filter);

  if (format === 'json') {
    process.stdout.write(JSON.stringify(utterances, null, 2) + '\n');
    return 0;
  }

  const filterDesc: string[] = [];
  if (lenseFilter !== undefined) filterDesc.push(`lense=${lenseFilter}`);
  if (verdictFilter !== undefined) filterDesc.push(`verdict=${verdictFilter}`);
  if (limit !== undefined) filterDesc.push(`limit=${limit}`);
  const filterSuffix =
    filterDesc.length > 0 ? ` (${filterDesc.join(', ')})` : '';

  if (utterances.length === 0) {
    process.stdout.write(`(no utterances from ${name}${filterSuffix})\n`);
    return 0;
  }

  const reviewOnly =
    lenseFilter !== undefined || verdictFilter !== undefined;
  const header = reviewOnly ? 'reviews' : 'utterances';
  process.stdout.write(
    `${utterances.length} ${header} from ${name}${filterSuffix}\n\n`,
  );
  for (const u of utterances) {
    process.stdout.write(renderUtterance(u, false) + '\n\n');
  }
  return 0;
}

export async function reqTail(c: C, args: ParsedArgs): Promise<number> {
  let n: number | undefined;
  const positional = args.positional[0];
  if (positional !== undefined) {
    const parsed = Number.parseInt(positional, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || String(parsed) !== positional) {
      throw new Error(
        `gate tail: N must be a non-negative integer, got: ${positional}`,
      );
    }
    n = parsed;
  } else {
    n = parseOptionalIntOption(args, 'limit');
  }
  const limit = n ?? 20;

  const allJson = await loadAllRequestsAsJson(c);
  const utterances = collectUtterances(allJson, {
    limit,
    order: 'desc',
  });

  if (utterances.length === 0) {
    process.stdout.write('(no utterances on this content_root yet)\n');
    return 0;
  }
  process.stdout.write(
    `${utterances.length} most recent utterance(s)\n\n`,
  );
  for (const u of utterances) {
    process.stdout.write(renderUtterance(u, true) + '\n\n');
  }
  return 0;
}

export async function reqWhoami(c: C, args: ParsedArgs): Promise<number> {
  const actor = process.env['GUILD_ACTOR'];
  if (!actor || actor.length === 0) {
    process.stderr.write(
      'GUILD_ACTOR is not set.\n' +
        'Export it in your shell to identify yourself:\n' +
        '  export GUILD_ACTOR=<your-name>\n' +
        'See `gate --help` > Environment for details.\n',
    );
    return 1;
  }

  const members = await c.memberUC.list();
  const actorLower = actor.toLowerCase();
  const isMember = members.some((m) => m.name.value === actorLower);
  const isHost = c.config.hostNames.includes(actorLower);
  const role = isMember
    ? 'member'
    : isHost
      ? 'host'
      : 'unknown (not in members/ or host_names)';

  process.stdout.write(`you are ${actor} (${role})\n`);

  const limit = parseOptionalIntOption(args, 'limit') ?? 5;

  const allJson = await loadAllRequestsAsJson(c);
  const utterances = collectUtterances(allJson, {
    name: actor,
    limit,
    order: 'desc',
  });

  if (utterances.length === 0) {
    process.stdout.write(
      '\n(no utterances yet — try `gate fast-track --action "..." --reason "..."` ' +
        'to file your first one)\n',
    );
    return 0;
  }

  process.stdout.write(
    `\nyour most recent ${utterances.length} utterance(s):\n\n`,
  );
  for (const u of utterances) {
    process.stdout.write(renderUtterance(u, false) + '\n\n');
  }
  return 0;
}

export async function reqChain(c: C, args: ParsedArgs): Promise<number> {
  const rootId = args.positional[0];
  if (!rootId) {
    throw new Error('Usage: gate chain <request-id | issue-id>');
  }
  // Accept 3- or 4-digit sequences for backward compat with pre-0.2.0 ids.
  const isIssueId = /^i-\d{4}-\d{2}-\d{2}-\d{3,4}$/.test(rootId);
  const isRequestId = /^\d{4}-\d{2}-\d{2}-\d{3,4}$/.test(rootId);
  if (!isIssueId && !isRequestId) {
    throw new DomainError(
      `id must match YYYY-MM-DD-NNNN (request) or ` +
        `i-YYYY-MM-DD-NNNN (issue), got: ${rootId}`,
      'id',
    );
  }

  const [allRequests, allIssues] = await Promise.all([
    c.requestUC.listAll(),
    c.issueUC.listAll(),
  ]);
  const requestById = new Map(allRequests.map((r) => [r.id.value, r]));
  const issueById = new Map(allIssues.map((i) => [i.id.value, i]));

  let rootText: string;
  let rootHeader: string;
  if (isIssueId) {
    const root = issueById.get(rootId);
    if (!root) {
      process.stderr.write(`not found: ${rootId}\n`);
      return 1;
    }
    const j = root.toJSON();
    rootText = gatherIssueText({ text: String(j['text'] ?? '') });
    rootHeader =
      `${rootId}  [${j['severity']}/${j['area']}]  ${j['state']}` +
      `  ${truncateCodePoints(String(j['text'] ?? ''), 80)}`;
  } else {
    const root = requestById.get(rootId);
    if (!root) {
      process.stderr.write(`not found: ${rootId}\n`);
      return 1;
    }
    const j = root.toJSON() as unknown as RequestJSON;
    rootText = gatherRequestText({
      action: j.action,
      reason: j.reason,
      ...(j.completion_note !== undefined
        ? { completion_note: j.completion_note }
        : {}),
      ...(j.deny_reason !== undefined ? { deny_reason: j.deny_reason } : {}),
      ...(j.failure_reason !== undefined
        ? { failure_reason: j.failure_reason }
        : {}),
      ...(j.reviews !== undefined
        ? { reviews: j.reviews.map((r) => ({ comment: r.comment })) }
        : {}),
    });
    rootHeader =
      `${rootId}  [${(root.toJSON() as Record<string, unknown>)['state']}]` +
      `  from=${j.from}  ${truncateCodePoints(j.action, 80)}`;
  }

  const refs = extractReferences(rootText);

  const linkedRequestIds = refs.requestIds.filter((id) => id !== rootId);
  const linkedIssueIds = refs.issueIds.filter((id) => id !== rootId);

  type Resolved<T> = { id: string; record: T | undefined };
  const linkedRequests: Array<Resolved<ReturnType<typeof requestById.get>>> =
    linkedRequestIds.map((id) => ({ id, record: requestById.get(id) }));
  const linkedIssues: Array<Resolved<ReturnType<typeof issueById.get>>> =
    linkedIssueIds.map((id) => ({ id, record: issueById.get(id) }));

  process.stdout.write(`${rootHeader}\n`);

  const haveIssues = linkedIssues.length > 0;
  const haveRequests = linkedRequests.length > 0;

  if (!haveIssues && !haveRequests) {
    process.stdout.write(
      '└── (no cross-referenced records in action/reason/notes/reviews)\n',
    );
    return 0;
  }

  if (haveIssues) {
    const isLastBranch = !haveRequests;
    const branchGlyph = isLastBranch ? '└──' : '├──';
    const childPrefix = isLastBranch ? '    ' : '│   ';
    process.stdout.write(`${branchGlyph} referenced issues\n`);
    const sorted = [...linkedIssues].sort((a, b) =>
      compareSequenceIds(a.id, b.id),
    );
    for (let i = 0; i < sorted.length; i++) {
      const item = sorted[i]!;
      const last = i === sorted.length - 1;
      const glyph = last ? '└──' : '├──';
      if (item.record) {
        const ij = item.record.toJSON();
        const summary =
          `${item.id}  [${ij['severity']}/${ij['area']}]  ${ij['state']}` +
          `  ${truncateCodePoints(String(ij['text'] ?? ''), 70)}`;
        process.stdout.write(`${childPrefix}${glyph} ${summary}\n`);
      } else {
        process.stdout.write(
          `${childPrefix}${glyph} ${item.id}  (referenced but not found)\n`,
        );
      }
    }
  }

  if (haveRequests) {
    process.stdout.write(`└── referenced requests\n`);
    const childPrefix = '    ';
    const sorted = [...linkedRequests].sort((a, b) =>
      compareSequenceIds(a.id, b.id),
    );
    for (let i = 0; i < sorted.length; i++) {
      const item = sorted[i]!;
      const last = i === sorted.length - 1;
      const glyph = last ? '└──' : '├──';
      if (item.record) {
        const rj = item.record.toJSON();
        const summary =
          `${item.id}  [${rj['state']}]  from=${rj['from']}` +
          `  ${truncateCodePoints(String(rj['action'] ?? ''), 70)}`;
        process.stdout.write(`${childPrefix}${glyph} ${summary}\n`);
      } else {
        process.stdout.write(
          `${childPrefix}${glyph} ${item.id}  (referenced but not found)\n`,
        );
      }
    }
  }

  return 0;
}
