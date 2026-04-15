import { buildContainer } from '../shared/container.js';
import {
  parseArgs,
  requireOption,
  optionalOption,
  ParsedArgs,
} from '../shared/parseArgs.js';
import { DomainError } from '../../domain/shared/DomainError.js';
import { Request } from '../../domain/request/Request.js';
import { parseLense } from '../../domain/shared/Lense.js';
import { parseVerdict } from '../../domain/shared/Verdict.js';
import {
  collectUtterances,
  formatDelta,
  renderUtterance,
  RequestJSON,
  VoicesFilter,
} from './voices.js';
import {
  extractReferences,
  gatherIssueText,
  gatherRequestText,
} from './chain.js';

const HELP = `gate — request lifecycle & dialogue CLI

Requests:
  gate request --from <m> --action <a> --reason <r>
                 [--executor <m>] [--target <s>] [--auto-review <m>]
  gate pending [--for <m>]
  gate list --state <state> [--for <m>] [--from <m>]
                            [--executor <m>] [--auto-review <m>]
  gate show <id> [--format json|text]
  gate voices <name> [--lense <l>] [--verdict <v>] [--limit <N>]
                     [--format json|text]
  gate tail [N]                                   (default 20)
  gate whoami                                     (needs GUILD_ACTOR)
  gate chain <id>                                 (request or issue)
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
  gate inbox --for <m> [--unread]
  gate inbox mark-read [N] [--for <m>]

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
      case 'voices':
        return await reqVoices(c, args);
      case 'tail':
        return await reqTail(c, args);
      case 'whoami':
        return await reqWhoami(c, args);
      case 'chain':
        return await reqChain(c, args);
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
  // Two-pass layout: compute the widest review-marker string across
  // the visible rows first, then pad every row to that width. This
  // keeps the action column aligned even when one row has more or
  // longer marker strings than its neighbors. Pure per-row padding
  // (what we did first) alignment-breaks when any single row blew
  // past the baseline width.
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
    // formatReviewMarkers(minWidth=0) returns the natural string
    // (no floor), so we can measure the un-padded length.
    const natural = formatReviewMarkers(r.toJSON()['reviews'], 0);
    if (natural.length > max) max = natural.length;
  }
  // Leave at least two trailing spaces between marker column and
  // action column so nothing collides at the visual boundary.
  return max + 2;
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

  // Time deltas make the *pace* of the dialogue legible. A 45-second
  // correction and a 25-minute pause look identical in raw ISO-8601;
  // with deltas, the reader sees the difference at a glance between
  // "critic responded immediately" and "author came back after a
  // long think". The first status_log entry (pending/created) has no
  // predecessor so gets no delta.
  const log = Array.isArray(j['status_log']) ? j['status_log'] : [];
  if (log.length > 0) {
    lines.push('');
    lines.push(`  status_log (${log.length}):`);
    let prevAt: string | undefined;
    for (const entry of log as Array<Record<string, unknown>>) {
      const at = String(entry['at']);
      const note = entry['note'] ? ` — ${entry['note']}` : '';
      const delta = prevAt ? ` (${formatDelta(prevAt, at)})` : '';
      lines.push(
        `    ${at}  ${entry['state']}  by ${entry['by']}${delta}${note}`,
      );
      prevAt = at;
    }
  }

  // For reviews, the delta is measured from the final status_log
  // entry (typically completed/failed/denied), which is "when the
  // work finished" — so a delta of +10s means the critic jumped on
  // it immediately, and +3d means the critic came back days later.
  // Subsequent reviews show delta from the previous review.
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
      lines.push(
        `    [${rv['lense']}/${rv['verdict']}] by ${rv['by']} at ${at}${delta}`,
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

// `gate voices <name>` — cross-cutting read over the request corpus.
//
// Surfaces every utterance authored or reviewed by <name>, regardless
// of the containing request's lifecycle state, sorted chronologically.
// An utterance is either:
//   - an authored request (action + reason + whichever closure note
//     the lifecycle produced: completion_note / deny_reason /
//     failure_reason) — something you *wrote* as the from-actor, or
//   - a review (lens + verdict + comment) — something you *said*
//     about someone's (maybe your own) work.
//
// Filters:
//   --lense <l>    only reviews with that lens (implies review-only;
//                  authored requests carry no lens)
//   --verdict <v>  only reviews with that verdict (implies review-only)
//   --format json  emit the utterance list as JSON for piping
//
// This is deliberately a read over *all* states, not a lifecycle
// query. The point is to let an actor re-read their own voice as a
// stream across time, without grepping yaml by hand.
//
// Gather/filter/sort is delegated to collectUtterances in ./voices.ts
// (pure, unit-tested). This wrapper handles arg parsing, repo I/O,
// and rendering.
async function reqVoices(c: C, args: ParsedArgs): Promise<number> {
  const name = args.positional[0];
  if (!name) {
    throw new Error(
      'Usage: gate voices <name> [--lense <l>] [--verdict <v>] ' +
        '[--format json|text]',
    );
  }

  const lenseFilterRaw = optionalOption(args, 'lense');
  const verdictFilterRaw = optionalOption(args, 'verdict');
  // parseLense / parseVerdict throw DomainError with the allowed-values
  // list on failure. Retain the parsed values so we're passing typed
  // strings (not "any string the user typed") into the filter.
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
    // includeActor=false: voices is scoped to a single actor, so the
    // actor name is in the header, not on every line.
    process.stdout.write(renderUtterance(u, false) + '\n\n');
  }
  return 0;
}

// Shared loader for cross-cutting reads (voices, tail, whoami, chain).
// Delegates to RequestUseCases.listAll which reads every state
// directory in parallel and dedupes on id in case a concurrent
// transition has moved a file between directories during the scan.
// Replaces the prior sequential N-state loop which had a larger
// TOCTOU window (tracked in the dogfood session as i-2026-04-15-001).
async function loadAllRequestsAsJson(c: C): Promise<RequestJSON[]> {
  const all = await c.requestUC.listAll();
  return all.map((r) => r.toJSON() as unknown as RequestJSON);
}

function parseOptionalIntOption(
  args: ParsedArgs,
  key: string,
): number | undefined {
  const raw = optionalOption(args, key);
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0 || String(n) !== raw) {
    throw new Error(`--${key} must be a non-negative integer, got: ${raw}`);
  }
  return n;
}

// `gate tail [N]` — the unified recent-activity stream.
//
// Merges authored requests and reviews from every actor, sorts
// descending by timestamp, and prints the most recent N (default 20).
// This is the "git log" of the content_root dialogue — the first
// command you want to type when you open a content_root fresh.
async function reqTail(c: C, args: ParsedArgs): Promise<number> {
  // N can come from a positional arg or from --limit. Positional is
  // the friendlier interactive form; --limit exists for consistency
  // with voices and for scripted use where positional can conflict.
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
  // Preserve descending order in output so the newest entry is at the
  // top — matches `git log` mental model. Reader can scroll down for
  // older things.
  process.stdout.write(
    `${utterances.length} most recent utterance(s)\n\n`,
  );
  for (const u of utterances) {
    // includeActor=true: tail spans every actor, so each line is
    // labeled with who said it.
    process.stdout.write(renderUtterance(u, true) + '\n\n');
  }
  return 0;
}

// `gate whoami` — session-start orientation.
//
// Resolves GUILD_ACTOR, classifies it (member / host / unknown), and
// prints the actor's 5 most recent utterances so the reader re-enters
// the content_root with their own recent voice loaded. Think of it as
// the first command of a session: "who am I here, and where was I?"
async function reqWhoami(c: C, args: ParsedArgs): Promise<number> {
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

  // Classify: is this a known member, a configured host, or neither?
  // Neither is fine for one-off actors but worth flagging — the
  // session will still work, it just means this name won't appear
  // in `guild list`.
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

  // --limit lets tests and power users override the default 5.
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

// `gate chain <id>` — one-hop cross-reference walk.
//
// Given a request or issue id, loads the root record and every other
// record it mentions (by YYYY-MM-DD-NNN / i-YYYY-MM-DD-NNN pattern in
// any free-text field: action, reason, closure notes, review
// comments, issue text). Renders as a tree so a reader can walk the
// narrative of how pieces of work relate to each other without
// grepping yaml by hand.
//
// Scope: one hop. Deeper walks are achievable by calling `gate chain`
// on one of the surfaced ids — the CLI stays a single-step tool, and
// the reader drives the depth.
async function reqChain(c: C, args: ParsedArgs): Promise<number> {
  const rootId = args.positional[0];
  if (!rootId) {
    throw new Error('Usage: gate chain <request-id | issue-id>');
  }
  const isIssueId = /^i-\d{4}-\d{2}-\d{2}-\d{3}$/.test(rootId);
  const isRequestId = /^\d{4}-\d{2}-\d{2}-\d{3}$/.test(rootId);
  if (!isIssueId && !isRequestId) {
    // DomainError keeps the error style consistent with parseLense /
    // parseVerdict / parseRequestState, so the outer CLI catch prints
    // a "DomainError: ..." prefix instead of a generic "error: ..."
    // and the `field` label points the reader at the failing input.
    throw new DomainError(
      `id must match YYYY-MM-DD-NNN (request) or ` +
        `i-YYYY-MM-DD-NNN (issue), got: ${rootId}`,
      'id',
    );
  }

  // Load all requests and all issues once up front so the index
  // lookups below are O(1). For dogfood-scale this is <1ms.
  const [allRequests, allIssues] = await Promise.all([
    c.requestUC.listAll(),
    c.issueUC.listAll(),
  ]);
  const requestById = new Map(allRequests.map((r) => [r.id.value, r]));
  const issueById = new Map(allIssues.map((i) => [i.id.value, i]));

  // Extract references from the root's free text. If the root is
  // missing, we say so and bail — a typo should yield a clear error,
  // not an empty tree.
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

  // Drop self-references so the root doesn't appear as its own child.
  const linkedRequestIds = refs.requestIds.filter((id) => id !== rootId);
  const linkedIssueIds = refs.issueIds.filter((id) => id !== rootId);

  // Resolve ids → actual records (or mark as missing). Missing ids
  // are real — a prose string can mention an id that was never
  // created — so we surface them rather than silently dropping.
  type Resolved<T> = { id: string; record: T | undefined };
  const linkedRequests: Array<Resolved<ReturnType<typeof requestById.get>>> =
    linkedRequestIds.map((id) => ({ id, record: requestById.get(id) }));
  const linkedIssues: Array<Resolved<ReturnType<typeof issueById.get>>> =
    linkedIssueIds.map((id) => ({ id, record: issueById.get(id) }));

  // Output: tree with two branches (issues, requests), each branch
  // sorted by id for stability. Empty branches are dropped entirely
  // rather than shown as "(none)" — keeps the output scannable.
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
      a.id.localeCompare(b.id),
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
      a.id.localeCompare(b.id),
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
  // `gate inbox mark-read [N]` is dispatched here too — the first
  // positional is treated as a subverb. This keeps the verb family
  // under a single `inbox` namespace instead of introducing a
  // top-level `mark-read` command.
  if (args.positional[0] === 'mark-read') {
    return await msgInboxMarkRead(c, args);
  }

  const forName = requireOption(args, 'for', '--for required', 'GUILD_ACTOR');
  const unreadOnly = args.options['unread'] === true;
  const messages = await c.messageUC.inbox(forName);
  const filtered = unreadOnly
    ? messages.filter((m) => !m.read)
    : messages;

  if (filtered.length === 0) {
    const suffix = unreadOnly ? ' (unread only)' : '';
    process.stdout.write(`(inbox empty for ${forName}${suffix})\n`);
    return 0;
  }
  // Index is 1-based and counts every message in the inbox so the
  // user can `gate inbox mark-read <index>` referring to numbers
  // they see here. When --unread hides read messages the indices
  // stay stable (we index against the unfiltered list).
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (unreadOnly && m.read) continue;
    const idx = i + 1;
    const related = m.related ? ` (ref: ${m.related})` : '';
    const readTag = m.read
      ? m.readAt
        ? ` (read ${m.readAt})`
        : ' (read)'
      : ' (unread)';
    process.stdout.write(
      `  ${idx}. [${m.at}] ${m.type} from ${m.from}${related}${readTag}\n  ${m.text}\n`,
    );
  }
  return 0;
}

async function msgInboxMarkRead(c: C, args: ParsedArgs): Promise<number> {
  // Usage:
  //   gate inbox mark-read [N] [--for <m>]
  // When N is present, only that 1-based message is flipped. The
  // --for flag falls back to GUILD_ACTOR so interactive users can
  // type `GUILD_ACTOR=kiri gate inbox mark-read`.
  const forName = requireOption(args, 'for', '--for required', 'GUILD_ACTOR');
  let index: number | undefined;
  const positional = args.positional[1]; // [0] is 'mark-read'
  if (positional !== undefined) {
    const parsed = Number.parseInt(positional, 10);
    if (
      !Number.isFinite(parsed) ||
      parsed < 1 ||
      String(parsed) !== positional
    ) {
      throw new Error(
        `gate inbox mark-read: N must be a positive integer, got: ${positional}`,
      );
    }
    index = parsed;
  }

  const result = await c.messageUC.markRead(forName, index);
  if (result.total === 0) {
    process.stdout.write(`(inbox empty for ${forName})\n`);
    return 0;
  }
  if (result.marked === 0) {
    const scope = index !== undefined ? `#${index}` : 'all';
    process.stdout.write(
      `(nothing to mark for ${forName}: ${scope} already read)\n`,
    );
    return 0;
  }
  const scope = index !== undefined ? `#${index}` : `${result.marked}`;
  process.stdout.write(
    `✓ marked ${scope} as read for ${forName} (${result.alreadyRead} already read, ${result.total} total)\n`,
  );
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

function printSummary(r: Request, markerWidth = 16): void {
  const j = r.toJSON();
  const markers = formatReviewMarkers(j['reviews'], markerWidth);
  process.stdout.write(
    `${j['id']}  [${j['state']}]  from=${j['from']}  ${markers}${String(j['action']).slice(0, 60)}\n`,
  );
}

// Render a compact per-lens verdict summary like "✓devil ✓layer" or
// "!devil ✓layer" so the reader can tell at a glance whether a
// completed request closed cleanly or carried a concern into its
// reviews. The `width` parameter is the minimum padded width;
// strings longer than `width` are returned unpadded (the caller is
// responsible for computing a width that fits every row in the
// output if cross-row alignment matters — see computeReviewMarkerWidth).
//
// Verdict icons:
//   ✓  ok       (clean pass from this lens)
//   !  concern  (reviewer wanted something fixed; may or may not have been)
//   x  reject   (reviewer said no — rare, blocking)
//
// NOTE on widths: `joined.length` is UTF-16 code units, not visual
// columns. The verdict icons and lens names are all in the BMP
// (single code units) so this is accurate today. If a future lens
// name uses astral characters, revisit — Array.from(joined).length
// would give code points but still not visual width.
export function formatReviewMarkers(reviews: unknown, width = 16): string {
  if (!Array.isArray(reviews) || reviews.length === 0) {
    return ''.padEnd(width);
  }
  const parts: string[] = [];
  for (const rv of reviews as Array<Record<string, unknown>>) {
    const verdict = String(rv['verdict'] ?? '');
    const lense = String(rv['lense'] ?? '');
    const icon =
      verdict === 'ok' ? '✓' : verdict === 'concern' ? '!' : verdict === 'reject' ? 'x' : '?';
    parts.push(`${icon}${lense}`);
  }
  const joined = parts.join(' ');
  return joined.padEnd(width);
}
