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
  computeVoiceCalibration,
  RequestJSON,
  VoicesFilter,
  VoiceCalibration,
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
    lenseFilterRaw !== undefined ? parseLense(lenseFilterRaw, c.config.lenses) : undefined;
  const verdictFilter =
    verdictFilterRaw !== undefined ? parseVerdict(verdictFilterRaw) : undefined;
  const limit = parseOptionalIntOption(args, 'limit');
  const format = optionalOption(args, 'format') ?? 'json';
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

  // Voice calibration: per-(actor, lens) score derived from historical
  // verdicts vs outcomes. Hidden when viewing your own voice (the
  // voter shouldn't game their own score); shown otherwise. See the
  // `computeVoiceCalibration` header in voices.ts for semantics.
  const envActor = process.env['GUILD_ACTOR'];
  const isSelfView =
    envActor !== undefined &&
    envActor.length > 0 &&
    envActor.toLowerCase() === name.toLowerCase();
  const calibration: VoiceCalibration | null = isSelfView
    ? null
    : computeVoiceCalibration(allJson, name);
  const withCalibration = args.options['with-calibration'] === true;

  if (format === 'json') {
    // Shape contract: default stays the utterances array so existing
    // consumers don't break. `--with-calibration` opts into an object
    // shape that carries both. The flag is registered in
    // KNOWN_BOOLEAN_FLAGS so its presence doesn't swallow positionals.
    if (withCalibration) {
      process.stdout.write(
        JSON.stringify(
          { utterances, calibration: calibration },
          null,
          2,
        ) + '\n',
      );
    } else {
      process.stdout.write(JSON.stringify(utterances, null, 2) + '\n');
    }
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
  // Calibration footer: one line per lens with recorded activity.
  // Placed after the utterances so a reader who scanned the prose
  // sees the summary below without it fighting for attention. Self-
  // view skips this entirely (see isSelfView above).
  if (calibration !== null) {
    const lensEntries = Object.entries(calibration.by_lens);
    if (lensEntries.length > 0) {
      process.stdout.write('── calibration ──\n');
      for (const [, c] of lensEntries) {
        process.stdout.write(`  ${c.prose}\n`);
      }
      process.stdout.write('\n');
    }
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

  // Structured forward link: a request root that was promoted from
  // an issue carries `promoted_from: <issue-id>` independent of its
  // action/reason text. Add that issue to the forward-referenced
  // list so chain surfaces the link even when --action and --reason
  // were both overridden at promote time (the narrow case where the
  // text-mention scan can't reach). Dedup against linkedIssueIds so
  // the default case (text mentions i-X + structured field = i-X)
  // doesn't render the same issue twice.
  if (!isIssueId) {
    const rootReq = requestById.get(rootId);
    const rootRj = rootReq?.toJSON() as unknown as RequestJSON | undefined;
    const structuredIssue = rootRj?.promoted_from;
    if (
      structuredIssue !== undefined &&
      structuredIssue !== rootId &&
      !linkedIssueIds.includes(structuredIssue)
    ) {
      linkedIssueIds.push(structuredIssue);
    }
  }

  // Inbound references: scan every other record's text for rootId so
  // an issue that was promoted to a request can `gate chain` the
  // resolving request, not just the other way around. Without this
  // the tool only walks one direction — an asymmetry that shows up
  // the moment you try to follow a resolution backwards. O(N) scan,
  // acceptable for the typical content_root.
  const inboundRequestRecords: typeof allRequests = [];
  for (const r of allRequests) {
    if (r.id.value === rootId) continue;
    const rj = r.toJSON() as unknown as RequestJSON;
    const text = gatherRequestText({
      action: rj.action,
      reason: rj.reason,
      ...(rj.completion_note !== undefined
        ? { completion_note: rj.completion_note }
        : {}),
      ...(rj.deny_reason !== undefined ? { deny_reason: rj.deny_reason } : {}),
      ...(rj.failure_reason !== undefined
        ? { failure_reason: rj.failure_reason }
        : {}),
      ...(rj.reviews !== undefined
        ? { reviews: rj.reviews.map((rv) => ({ comment: rv.comment })) }
        : {}),
    });
    const inboundRefs = extractReferences(text);
    const textMentions =
      inboundRefs.requestIds.includes(rootId) ||
      inboundRefs.issueIds.includes(rootId);
    // Structured inbound: a request whose `promoted_from` equals the
    // current issue root is linked via the tool-generated field even
    // if its overridden text doesn't mention the issue id. Issue
    // roots are the only ones that can catch this kind of link;
    // request roots have their own forward promoted_from handled
    // above.
    const structuredInbound =
      isIssueId && rj.promoted_from === rootId;
    if (textMentions || structuredInbound) {
      inboundRequestRecords.push(r);
    }
  }
  const inboundIssueRecords: typeof allIssues = [];
  for (const i of allIssues) {
    if (i.id.value === rootId) continue;
    const ij = i.toJSON();
    const notesRaw = Array.isArray(ij['notes'])
      ? (ij['notes'] as Array<Record<string, unknown>>).map((n) => ({
          text: String(n['text'] ?? ''),
        }))
      : undefined;
    const text = gatherIssueText({
      text: String(ij['text'] ?? ''),
      ...(notesRaw ? { notes: notesRaw } : {}),
    });
    const inboundRefs = extractReferences(text);
    if (
      inboundRefs.requestIds.includes(rootId) ||
      inboundRefs.issueIds.includes(rootId)
    ) {
      inboundIssueRecords.push(i);
    }
  }

  // Bidirectional dedup: when record X appears on both sides (root
  // mentions X AND X mentions root), render it once in the forward
  // section with a `↔` marker rather than twice (once under
  // "referenced X" and again under "referenced by X"). The
  // bidirectional mark is NOT the same information as the pair of
  // one-way marks; it's tighter — "they know about each other" —
  // and that's usually what the reader cares about.
  const inboundRequestIdSet = new Set(
    inboundRequestRecords.map((r) => r.id.value),
  );
  const inboundIssueIdSet = new Set(
    inboundIssueRecords.map((i) => i.id.value),
  );
  const bidirRequestIds = new Set(
    linkedRequestIds.filter((id) => inboundRequestIdSet.has(id)),
  );
  const bidirIssueIds = new Set(
    linkedIssueIds.filter((id) => inboundIssueIdSet.has(id)),
  );

  type Resolved<T> = {
    id: string;
    record: T | undefined;
    bidirectional: boolean;
  };
  const linkedRequests: Array<Resolved<ReturnType<typeof requestById.get>>> =
    linkedRequestIds.map((id) => ({
      id,
      record: requestById.get(id),
      bidirectional: bidirRequestIds.has(id),
    }));
  const linkedIssues: Array<Resolved<ReturnType<typeof issueById.get>>> =
    linkedIssueIds.map((id) => ({
      id,
      record: issueById.get(id),
      bidirectional: bidirIssueIds.has(id),
    }));
  const inboundRequests: Array<Resolved<ReturnType<typeof requestById.get>>> =
    inboundRequestRecords
      .filter((r) => !bidirRequestIds.has(r.id.value))
      .map((r) => ({ id: r.id.value, record: r, bidirectional: false }));
  const inboundIssues: Array<Resolved<ReturnType<typeof issueById.get>>> =
    inboundIssueRecords
      .filter((i) => !bidirIssueIds.has(i.id.value))
      .map((i) => ({ id: i.id.value, record: i, bidirectional: false }));

  process.stdout.write(`${rootHeader}\n`);

  // Assemble the four possible sections. Rendered only when non-empty;
  // the tree glyphs pick the correct last-child markers automatically
  // based on position in the `sections` list, so adding a 5th category
  // later wouldn't require re-juggling the ├/└ logic.
  type Kind = 'issue' | 'request';
  interface Section {
    title: string;
    items: Array<Resolved<ReturnType<typeof requestById.get> | ReturnType<typeof issueById.get>>>;
    kind: Kind;
  }
  const sections: Section[] = [];
  if (linkedIssues.length > 0) {
    sections.push({ title: 'referenced issues', items: linkedIssues, kind: 'issue' });
  }
  if (linkedRequests.length > 0) {
    sections.push({ title: 'referenced requests', items: linkedRequests, kind: 'request' });
  }
  if (inboundIssues.length > 0) {
    sections.push({ title: 'referenced by issues', items: inboundIssues, kind: 'issue' });
  }
  if (inboundRequests.length > 0) {
    sections.push({ title: 'referenced by requests', items: inboundRequests, kind: 'request' });
  }

  if (sections.length === 0) {
    process.stdout.write(
      '└── (no cross-referenced records; nothing references this either)\n',
    );
    return 0;
  }

  for (let s = 0; s < sections.length; s++) {
    const section = sections[s]!;
    const isLastSection = s === sections.length - 1;
    const branchGlyph = isLastSection ? '└──' : '├──';
    const childPrefix = isLastSection ? '    ' : '│   ';
    process.stdout.write(`${branchGlyph} ${section.title}\n`);
    const sorted = [...section.items].sort((a, b) =>
      compareSequenceIds(a.id, b.id),
    );
    for (let i = 0; i < sorted.length; i++) {
      const item = sorted[i]!;
      const last = i === sorted.length - 1;
      const glyph = last ? '└──' : '├──';
      // `↔` prefix signals "root and this record reference each
      // other"; no prefix means "one-way in this direction only."
      // The marker is short on purpose — readers scan a tree, not a
      // paragraph.
      const bidirMark = item.bidirectional ? '↔ ' : '';
      if (item.record) {
        const j = item.record.toJSON();
        const summary =
          section.kind === 'issue'
            ? `${bidirMark}${item.id}  [${j['severity']}/${j['area']}]  ${j['state']}` +
              `  ${truncateCodePoints(String(j['text'] ?? ''), 70)}`
            : `${bidirMark}${item.id}  [${j['state']}]  from=${j['from']}` +
              `  ${truncateCodePoints(String(j['action'] ?? ''), 70)}`;
        process.stdout.write(`${childPrefix}${glyph} ${summary}\n`);
      } else {
        process.stdout.write(
          `${childPrefix}${glyph} ${bidirMark}${item.id}  (referenced but not found)\n`,
        );
      }
    }
  }

  return 0;
}
