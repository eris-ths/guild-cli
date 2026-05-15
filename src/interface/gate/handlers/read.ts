import {
  resolveGuildActor,
  resolveGuildActorWithSource,
} from '../../shared/resolveGuildActor.js';
import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { maybeEmitExplain } from '../../shared/explain.js';
import { notFoundMessage } from '../../shared/notFoundHint.js';
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

const VOICES_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'lense',
  'verdict',
  'limit',
  'format',
  'with-calibration',
]);

export async function reqVoices(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, VOICES_KNOWN_FLAGS, 'voices');
  maybeEmitExplain(args, 'voices');
  const name = args.positional[0];
  if (!name) {
    // No-arg discovery: which actors actually have utterances to show?
    // Pre-fix this bounced with bare Usage and forced the operator to
    // re-grep `members/` themselves — silent-fallback signal-loss against
    // the discovery question (trap_silent_fallback_loses_signal). We
    // count per-actor utterances across the substrate so a cold reader
    // can pick a name from the list directly.
    const format = optionalOption(args, 'format') ?? 'text';
    if (format !== 'text' && format !== 'json') {
      throw new Error(`--format must be 'text' or 'json', got: ${format}`);
    }
    return emitVoicesIndex(c, format);
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

  // Typo diagnostic: a `name` that matches neither a current member
  // nor a configured host AND produced zero utterances is almost
  // certainly a typo. Pre-fix, `gate voices ghost-actor` returned
  // identical empty output to `gate voices <registered-but-quiet>`,
  // a silent-fallback signal-loss (trap_silent_fallback_loses_signal).
  // The fix surfaces a structured `_meta.actor_unknown` field in JSON
  // mode and a one-line hint in text mode. A name that *does* produce
  // utterances is left alone — historical authors who are no longer
  // current members keep working without false-flagging.
  let actorUnknown = false;
  if (utterances.length === 0) {
    const nameLower = name.toLowerCase();
    const members = await c.memberUC.list();
    const isMember = members.some((m) => m.name.value === nameLower);
    const isHost = c.config.hostNames.some((h) => h.toLowerCase() === nameLower);
    actorUnknown = !isMember && !isHost;
  }

  // Voice calibration: per-(actor, lense) score derived from historical
  // verdicts vs outcomes. Hidden when viewing your own voice (the
  // voter shouldn't game their own score); shown otherwise. See the
  // `computeVoiceCalibration` header in voices.ts for semantics.
  const envActor = resolveGuildActor();
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
    //
    // Typo diagnostic: when `actorUnknown` is true (zero utterances
    // AND not a current member/host), wrap the output in an object
    // envelope carrying `_meta.actor_unknown: true`. Existing JSON
    // consumers reading the array shape continue to work for the
    // common path (registered actor with results); the envelope shape
    // only triggers on the typo case, where the consumer is already
    // re-interpreting an empty result anyway.
    if (withCalibration) {
      process.stdout.write(
        JSON.stringify(
          actorUnknown
            ? { utterances, calibration, _meta: { actor_unknown: true } }
            : { utterances, calibration },
          null,
          2,
        ) + '\n',
      );
    } else if (actorUnknown) {
      process.stdout.write(
        JSON.stringify(
          { utterances, _meta: { actor_unknown: true } },
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
    if (actorUnknown) {
      process.stdout.write(
        `(no utterances from ${name}${filterSuffix})\n` +
          `  note: '${name}' is not a registered member or host — ` +
          `did you typo the name?\n` +
          `  next: gate tail        # see actors with recent activity\n` +
          `        gate register    # see how to register a new actor\n`,
      );
    } else {
      process.stdout.write(`(no utterances from ${name}${filterSuffix})\n`);
    }
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
  // Calibration footer: one line per lense with recorded activity.
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

const TAIL_KNOWN_FLAGS: ReadonlySet<string> = new Set(['limit', 'format']);

/**
 * Bare `gate voices` (no positional): per-actor utterance counts so a
 * cold reader can pick a name from a real list instead of guessing.
 * Counts include both authored requests and reviews — i.e. anything
 * `collectUtterances(.., {name: X})` would surface.
 */
async function emitVoicesIndex(c: C, format: string): Promise<number> {
  const allJson = await loadAllRequestsAsJson(c);
  const counts = new Map<string, number>();
  for (const r of allJson) {
    const author =
      typeof r['from'] === 'string' && r['from'].length > 0
        ? (r['from'] as string)
        : null;
    if (author) counts.set(author, (counts.get(author) ?? 0) + 1);
    const reviews = Array.isArray(r['reviews']) ? r['reviews'] : [];
    for (const rv of reviews) {
      if (typeof rv !== 'object' || rv === null) continue;
      const by = (rv as Record<string, unknown>)['by'];
      if (typeof by === 'string' && by.length > 0) {
        counts.set(by, (counts.get(by) ?? 0) + 1);
      }
    }
  }
  const members = await c.memberUC.list();
  const memberNames = new Set(members.map((m) => m.name.value));
  const hostNames = new Set(c.config.hostNames.map((h) => h.toLowerCase()));
  const rows = [...counts.entries()]
    .map(([actor, n]) => ({
      actor,
      utterances: n,
      kind: memberNames.has(actor.toLowerCase())
        ? 'member'
        : hostNames.has(actor.toLowerCase())
          ? 'host'
          : 'historical',
    }))
    .sort((a, b) =>
      b.utterances !== a.utterances
        ? b.utterances - a.utterances
        : a.actor < b.actor
          ? -1
          : 1,
    );
  if (format === 'json') {
    process.stdout.write(
      JSON.stringify({ index: rows, total_actors: rows.length }, null, 2) +
        '\n',
    );
    return 0;
  }
  if (rows.length === 0) {
    process.stdout.write(
      '(no utterances on this content_root yet)\n' +
        '  next: gate register     # add an actor\n' +
        '        gate fast-track   # leave a first utterance\n',
    );
    return 0;
  }
  process.stdout.write(
    `voices index — ${rows.length} actor${rows.length === 1 ? '' : 's'} with utterances\n\n`,
  );
  const widest = rows.reduce((w, r) => Math.max(w, r.actor.length), 0);
  for (const r of rows) {
    const pad = r.actor.padEnd(widest);
    process.stdout.write(
      `  ${pad}  ${String(r.utterances).padStart(4)}  ${r.kind}\n`,
    );
  }
  process.stdout.write(
    `\n  next: gate voices <name>     # narrative walk for one actor\n`,
  );
  return 0;
}

export async function reqTail(c: C, args: ParsedArgs): Promise<number> {
  // Strict-reject unknown flags. `gate tail` has a small surface
  // (positional N + --limit + --format); typos like `--from noir`
  // would otherwise be silently ignored and the caller would read
  // "unfiltered" as "filtered" — exactly the fail-open pattern we
  // want surfaced. Pilot opt-in: other verbs migrate individually
  // in follow-up PRs.
  rejectUnknownFlags(args, TAIL_KNOWN_FLAGS, 'tail');
  maybeEmitExplain(args, 'tail');

  // Symmetric with the unknown-flag rejection above: extra positional
  // arguments are silently dropped pre-fix (e.g. `gate tail 3 extra`
  // returned the first 3 utterances ignoring `extra`). That's the
  // same fail-open shape — the caller's intent is lost without any
  // hint that it was lost. Reject with a usage line so a typo or
  // misremembered flag surfaces immediately.
  if (args.positional.length > 1) {
    throw new Error(
      `gate tail: takes at most one positional (N), got ${args.positional.length}: ` +
        `${args.positional.map((p) => JSON.stringify(p)).join(', ')}\n` +
        `  next: gate tail [N]                            # default N=20`,
    );
  }

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

  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    throw new Error(`--format must be 'json' or 'text', got: ${format}`);
  }

  const allJson = await loadAllRequestsAsJson(c);
  const utterances = collectUtterances(allJson, {
    limit,
    order: 'desc',
  });

  if (format === 'json') {
    // Empty list emits `[]` (not an error envelope) so pipeline
    // consumers can `jq` over the result without branching on
    // "is this an array or an error?". Same shape as `gate
    // voices --format json`. Keys are snake_case post-#109
    // (request_id / invoked_by / completion_note / ...).
    process.stdout.write(JSON.stringify(utterances, null, 2) + '\n');
    return 0;
  }

  if (utterances.length === 0) {
    // Disambiguate "source is empty" from "caller asked for zero":
    // pre-fix, `gate tail 0` on a rich content_root rendered the
    // same "(no utterances on this content_root yet)" message as a
    // truly-empty root — a false claim about the source state
    // (lore/traps/trap_silent_fallback_loses_signal). An explicit
    // limit=0 from the caller is the only path that yields empty-
    // without-source-emptiness, so the limit alone disambiguates.
    if (limit === 0) {
      process.stdout.write('(0 utterances requested)\n');
    } else {
      process.stdout.write('(no utterances on this content_root yet)\n');
    }
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

const WHOAMI_KNOWN_FLAGS: ReadonlySet<string> = new Set(['limit', 'format']);

export async function reqWhoami(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, WHOAMI_KNOWN_FLAGS, 'whoami');
  // Format-symmetry (principle 11): whoami is a read-shape verb whose
  // siblings (status / board / list / show / voices / tail / doctor)
  // all expose --format json|text. Pre-this-fix whoami was text-only,
  // forcing agents to regex-parse the principle-09 `actor source: ...`
  // line. JSON path emits the same data with snake_case fields so
  // orchestrators can reflect on identity / role / actor_source /
  // recent utterances without parsing prose.
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    throw new Error(`--format must be 'json' or 'text', got: ${format}`);
  }
  const resolved = resolveGuildActorWithSource();
  if (!resolved) {
    if (format === 'json') {
      process.stdout.write(
        JSON.stringify(
          {
            ok: false,
            error: {
              message:
                'GUILD_ACTOR is not set. Export it in your shell to identify yourself.',
            },
          },
          null,
          2,
        ) + '\n',
      );
      return 1;
    }
    process.stderr.write(
      'GUILD_ACTOR is not set.\n' +
        'Export it in your shell to identify yourself:\n' +
        '  export GUILD_ACTOR=<your-name>\n' +
        'See `gate --help` > Environment for details.\n',
    );
    return 1;
  }
  const actor = resolved.actor;

  const members = await c.memberUC.list();
  const actorLower = actor.toLowerCase();
  const memberRecord = members.find((m) => m.name.value === actorLower);
  const isMember = memberRecord !== undefined;
  const isHost = c.config.hostNames.includes(actorLower);
  // Role enum stays compact for the JSON path (member / host / unknown).
  // Text mode keeps the longer "unknown (not in members/ or host_names)"
  // hint because the human reader benefits from the where-to-look pointer;
  // the agent reader gets the structured fact in the JSON envelope.
  const roleEnum: 'member' | 'host' | 'unknown' = isMember
    ? 'member'
    : isHost
      ? 'host'
      : 'unknown';
  const roleText = isMember
    ? 'member'
    : isHost
      ? 'host'
      : 'unknown (not in members/ or host_names)';

  const displayName = memberRecord?.displayName;

  const limit = parseOptionalIntOption(args, 'limit') ?? 5;
  const allJson = await loadAllRequestsAsJson(c);
  const utterances = collectUtterances(allJson, {
    name: actor,
    limit,
    order: 'desc',
  });

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          actor,
          role: roleEnum,
          display_name: displayName ?? null,
          actor_source: resolved.source,
          recent_utterances: utterances,
        },
        null,
        2,
      ) + '\n',
    );
    return 0;
  }

  // Surface display_name when present: name and display_name carry
  // different signals — name is identity, display_name is the
  // human-facing label. Hiding display_name at the orientation
  // surface meant the member's chosen presentation lived only in
  // YAML and `guild list`. Em-dash separator follows how other
  // surfaces compose name/label pairs; the role parens stay so the
  // visual block parses left-to-right (name — label (role)).
  const displayChunk = displayName ? ` — ${displayName}` : '';
  process.stdout.write(`you are ${actor}${displayChunk} (${roleText})\n`);
  // Disclose the resolution source so a fresh agent can tell
  // GUILD_ACTOR-from-shell apart from a `.guild-actor` file dropped
  // into the tree by a colleague. Same observability principle as
  // `gate boot`'s misconfigured_cwd disclosure: when two equally-
  // valid configurations produce the same resolved value, the
  // surface should name which one was used.
  const sourceLabel =
    resolved.source === 'env' ? 'GUILD_ACTOR (env)' : '.guild-actor (file)';
  process.stdout.write(`actor source: ${sourceLabel}\n`);

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

// gate chain accepts --format text|json. Previously text-only by
// design (strict-reject on --format kept noise out), but the asymmetry
// vs every other read verb made `chain` an outlier — pipeline writers
// branched their --format json composition around chain alone. This
// PR makes chain symmetric with the rest of the read surface.
const CHAIN_KNOWN_FLAGS: ReadonlySet<string> = new Set(['format']);

export async function reqChain(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, CHAIN_KNOWN_FLAGS, 'chain');
  maybeEmitExplain(args, 'chain');
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'text' && format !== 'json') {
    throw new Error(`--format must be 'text' or 'json', got: ${format}`);
  }
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
      process.stderr.write(notFoundMessage('issue', rootId));
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
      process.stderr.write(notFoundMessage('request', rootId));
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

  // Cross-passage resolution: agora play ids match the request id
  // regex (both are YYYY-MM-DD-NNN[N]), so they come through as
  // `linkedRequestIds` but miss the request store. Before rendering,
  // probe the play repo for any "not found" id so we can label it
  // as an agora play instead of leaving the reader with the
  // unhelpful "(referenced but not found)" status. Only the ids that
  // missed the request store are probed — issues have a distinct
  // i- prefix and never collide with agora.
  const unresolvedRequestIds = linkedRequestIds.filter(
    (id) => !requestById.has(id),
  );
  type CrossPassageMatch = { gameSlug: string; state: string };
  type CrossPassage = { passage: 'agora'; matches: CrossPassageMatch[] };
  const crossPassageById = new Map<string, CrossPassage>();
  for (const id of unresolvedRequestIds) {
    const plays = await c.playRepo.findAllById(id);
    if (plays.length > 0) {
      const matches: CrossPassageMatch[] = plays.map((p) => {
        const pj = p.toJSON() as Record<string, unknown>;
        return {
          gameSlug: String(pj['game'] ?? ''),
          state: String(pj['state'] ?? ''),
        };
      });
      crossPassageById.set(id, { passage: 'agora', matches });
    }
  }

  // JSON rendering: a structured shape mirroring the four sections
  // plus a `cross_passage` view of any ids resolved outside gate.
  // Each item has {id, found, bidirectional, summary?} so the
  // pipeline consumer sees the same content the text tree shows,
  // minus the glyphs.
  if (format === 'json') {
    type JsonItem = {
      id: string;
      found: boolean;
      bidirectional: boolean;
      summary: Record<string, unknown> | null;
      cross_passage: CrossPassage | null;
    };
    const toJsonItem = (
      r: typeof linkedRequests[number] | typeof linkedIssues[number],
      kind: 'request' | 'issue',
    ): JsonItem => {
      const xp = crossPassageById.get(r.id) ?? null;
      let summary: Record<string, unknown> | null = null;
      if (r.record) {
        const j = r.record.toJSON() as Record<string, unknown>;
        if (kind === 'issue') {
          summary = {
            severity: j['severity'],
            area: j['area'],
            state: j['state'],
            text: j['text'],
          };
        } else {
          summary = {
            state: j['state'],
            from: j['from'],
            action: j['action'],
          };
        }
      }
      return {
        id: r.id,
        found: r.record !== undefined,
        bidirectional: r.bidirectional,
        summary,
        cross_passage: xp,
      };
    };
    const payload = {
      root: {
        id: rootId,
        kind: isIssueId ? 'issue' : 'request',
        header: rootHeader,
      },
      forward: {
        issues: linkedIssues.map((i) => toJsonItem(i, 'issue')),
        requests: linkedRequests.map((r) => toJsonItem(r, 'request')),
      },
      inbound: {
        issues: inboundIssues.map((i) => toJsonItem(i, 'issue')),
        requests: inboundRequests.map((r) => toJsonItem(r, 'request')),
      },
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return 0;
  }

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
        // Cross-passage hint: when an id misses the gate stores but
        // resolves in agora, label it so the reader doesn't read
        // 'not found' as a broken link. Only request-shaped ids
        // collide with agora (issues carry the i- prefix).
        const xp = section.kind === 'request' ? crossPassageById.get(item.id) : undefined;
        if (xp) {
          // Multi-match: each game has its own play-id sequence so the
          // same id can resolve to plays in multiple games. Render all
          // — the reader needs every candidate to disambiguate.
          const labels = xp.matches
            .map((m) => `game=${m.gameSlug}, ${m.state}`)
            .join(' | ');
          process.stdout.write(
            `${childPrefix}${glyph} ${bidirMark}${item.id}  ` +
              `→ agora play (${labels})\n`,
          );
        } else {
          process.stdout.write(
            `${childPrefix}${glyph} ${bidirMark}${item.id}  (referenced but not found)\n`,
          );
        }
      }
    }
  }

  return 0;
}
