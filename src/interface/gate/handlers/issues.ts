import {
  ParsedArgs,
  requireOption,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { notFoundMessage } from '../../shared/notFoundHint.js';
import { resolveGuildSessionId } from '../../shared/resolveGuildSessionId.js';
import { parseExecutorsList } from './request.js';
import {
  C,
  readStdin,
  truncateCodePoints,
  deriveInvokedBy,
  emitInvokedByNotice,
  resolveInvokedBy,
} from './internal.js';

const ISSUES_ADD_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'from',
  'severity',
  'area',
  'text',
]);
const ISSUES_LIST_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'state',
  'format',
]);
// `gate issues show <id>` mirrors `gate show <id>` for requests and
// `agora show <id>` for plays. Read-only detail view: looks up one
// issue by id, surfaces its full body + notes. --format text|json
// matches `gate issues list` so a caller wiring a json pipeline can
// drop in `show` next to `list` without flag rework. See
// asymmetry-catchup landed in this PR for the gap this closes.
const ISSUES_SHOW_KNOWN_FLAGS: ReadonlySet<string> = new Set(['format']);
const ISSUES_PROMOTE_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'from',
  'executor',
  // Multi-executor (issue #230): `gate issues promote` should accept
  // the same executor surface as `gate request` — promote → request
  // is the same write-side primitive under the hood, so any
  // attribution-race surface that the multi-executor schema closes on
  // `gate request` must close here too. Devil review concern 1.
  'executors',
  'auto-review',
  'action',
  'reason',
]);
const ISSUES_NOTE_KNOWN_FLAGS: ReadonlySet<string> = new Set(['by', 'text']);
// `gate issues resolve/defer/start/reopen` take `--by <m>` (or fall
// back to GUILD_ACTOR) so the state_log audit entry can record who
// ran the transition. See Sec H3 (state_log per transition).
// `--note <s>` is optional free-form rationale (#289 hunk 1) persisted
// onto the state_log entry; omitted from the YAML when absent so
// pre-#289 records round-trip byte-identical.
const ISSUES_TRANSITION_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'by',
  'note',
]);

export async function issuesCmd(c: C, args: ParsedArgs): Promise<number> {
  const sub = args.positional[0];
  if (sub === undefined) {
    // Pre-this-fix, a bare `gate issues` silently fell through to
    // `issues list` (open-only). The user typed `issues` not `list`,
    // so the silent fall-through hid the verb's actual surface from
    // first-time callers. Mirror what `gate list` does for missing
    // --state: short hint at common entry points, gesture at the full
    // catalog, exit 1 so a script chained on the call notices.
    process.stderr.write(
      'gate issues needs a subcommand. common ones:\n' +
        '  gate issues list                  # what is open\n' +
        '  gate issues show <id>             # full body + notes\n' +
        '  gate issues add --from <m> --severity <s> --area <a> --text <s>\n' +
        '  gate issues note <id> --by <m> --text <s>\n' +
        '  full set: add|list|show|note|resolve|defer|start|reopen|promote ' +
        '(gate --help)\n',
    );
    return 1;
  }
  if (sub === 'promote') {
    return await issuesPromote(c, args);
  }
  if (sub === 'note') {
    return await issuesNote(c, args);
  }
  if (sub === 'add') {
    rejectUnknownFlags(args, ISSUES_ADD_KNOWN_FLAGS, 'issues add');
    const from = requireOption(args, 'from', '<m>', 'GUILD_ACTOR');
    const severity = requireOption(args, 'severity', '<low|med|high>');
    const area = requireOption(args, 'area', '<area>');
    // Text resolution mirrors `gate issues note`:
    //   --text <s>       inline short text
    //   --text -         STDIN until EOF
    //   <positional>     everything after `add` (legacy / short form)
    // Before this, `issues add` accepted only the positional form
    // while `issues note` had all three — asymmetry that users hit
    // as soon as they reached for the muscle-memory they'd just built.
    const textOpt = optionalOption(args, 'text');
    const positional = args.positional.slice(1).join(' ');
    let text: string;
    if (textOpt === '-') {
      text = (await readStdin()).trim();
    } else if (textOpt !== undefined) {
      text = textOpt;
    } else if (positional === '-') {
      // Symmetry with `--text -`. `gate issues add ... -` with a
      // heredoc attached reads the body from stdin, same as the
      // explicit flag form.
      text = (await readStdin()).trim();
    } else {
      text = positional;
    }
    if (!text.trim()) {
      // If args.options.text landed as boolean, the user did pass
      // --text but with a value that began with "--" and the parser
      // refused it. Point at the POSIX escape valves, same hint shape
      // as `gate issues note`.
      const hint =
        args.options['text'] === true
          ? '\n  (Your --text value began with "--" and was not consumed. ' +
            'Use --text=<value> or put "-- <value>" after the other flags.)'
          : '';
      throw new Error(
        'Usage: gate issues add --from <m> --severity <s> --area <a> ' +
          '[--text <s> | --text - | <text>]' +
          hint,
      );
    }
    // Proxy creation: derive pre-save (id unknown), emit notice after
    // the issue is allocated. Same pattern as gate request.
    const invokedBy = deriveInvokedBy(from);
    const addInput: Parameters<typeof c.issueUC.add>[0] = {
      from,
      severity,
      area,
      text,
    };
    if (invokedBy !== undefined) addInput.invokedBy = invokedBy;
    const i = await c.issueUC.add(addInput);
    if (invokedBy !== undefined) {
      emitInvokedByNotice(from, invokedBy, 'issues add', i.id.value);
    }
    process.stdout.write(`✓ issue: ${i.id.value}\n`);
    return 0;
  }
  if (sub === 'list') {
    rejectUnknownFlags(args, ISSUES_LIST_KNOWN_FLAGS, 'issues list');
    const stateRaw = optionalOption(args, 'state');
    const format = optionalOption(args, 'format') ?? 'text';
    if (format !== 'text' && format !== 'json') {
      throw new Error(`--format must be 'text' or 'json', got: ${format}`);
    }

    // `--state all` is sugar for "every state, no filter". Implemented
    // here rather than in IssueUseCases because the use case is
    // "list issues filtered by a *valid* state" and `all` is a CLI-
    // level affordance, not a domain state. Distinguishing these
    // keeps domain validation strict (parseIssueState rejects 'all').
    let items: Awaited<ReturnType<typeof c.issueUC.list>>;
    if (stateRaw === 'all') {
      items = await c.issueUC.listAll();
    } else {
      items = await c.issueUC.list(stateRaw);
    }

    // Default-filter discoverability: when the caller passed nothing,
    // the underlying list silently filters to state=open. Empty stdout
    // gives no signal whether (a) zero issues, (b) filter excluded,
    // or (c) error. Surface the filter on stderr — the same shape
    // `gate list`/`gate pending` use to disclose implicit narrowing.
    //
    // The phrasing also closes the open-vs-active gap: status counts
    // open+in_progress as "open_issues" (a triage glance), but list
    // is a worklist (what's unclaimed). Naming the difference here
    // means a reader who notices the count mismatch finds the answer
    // at the surface that exposed it.
    if (stateRaw === undefined && format === 'text') {
      process.stderr.write(
        '# filtered to state=open; status counts open+in_progress (active) ' +
          '— --state to override (open|in_progress|deferred|resolved|all)\n',
      );
    }

    if (format === 'json') {
      // Shape pinned in 2026-05-01-0002 design review (devil C):
      //   array of issue objects with notes nested. text format
      //   flattens notes for human reading; json preserves structure
      //   so programmatic consumers can walk them as a tree.
      process.stdout.write(
        JSON.stringify(
          items.map((i) => i.toJSON()),
          null,
          2,
        ) + '\n',
      );
      return 0;
    }

    for (const i of items) {
      const j = i.toJSON();
      const proxyTag = j['invoked_by']
        ? ` [invoked_by=${j['invoked_by']}]`
        : '';
      process.stdout.write(
        `${j['id']} [${j['severity']}/${j['area']}] ${j['state']} from=${j['from']}${proxyTag} — ${j['text']}\n`,
      );
      const notes = Array.isArray(j['notes']) ? j['notes'] : [];
      for (const n of notes as Array<Record<string, unknown>>) {
        const noteProxy = n['invoked_by']
          ? ` [invoked_by=${n['invoked_by']}]`
          : '';
        process.stdout.write(
          `  └ note by ${n['by']}${noteProxy} at ${n['at']}: ${n['text']}\n`,
        );
      }
    }
    return 0;
  }
  if (sub === 'show') {
    rejectUnknownFlags(args, ISSUES_SHOW_KNOWN_FLAGS, 'issues show');
    const id = args.positional[1];
    if (!id) {
      throw new Error(
        'Usage: gate issues show <id> [--format text|json]',
      );
    }
    const format = optionalOption(args, 'format') ?? 'text';
    if (format !== 'text' && format !== 'json') {
      throw new Error(`--format must be 'text' or 'json', got: ${format}`);
    }
    const issue = await c.issueUC.find(id);
    if (!issue) {
      process.stderr.write(notFoundMessage('issue', id));
      return 1;
    }
    const j = issue.toJSON();
    if (format === 'json') {
      process.stdout.write(JSON.stringify(j, null, 2) + '\n');
      return 0;
    }
    // Text: full body without list-row truncation. Header line mirrors
    // the list row format so a caller who eyeballed `issues list` and
    // reached for `show` sees the same prefix shape, then the full
    // text below as a body block. Notes follow with their full text
    // (the list rendering already flattens notes inline; show keeps
    // that shape for continuity).
    const proxyTag = j['invoked_by'] ? ` [invoked_by=${j['invoked_by']}]` : '';
    process.stdout.write(
      `${j['id']} [${j['severity']}/${j['area']}] ${j['state']} from=${j['from']}${proxyTag}\n`,
    );
    process.stdout.write(`  created: ${j['created_at']}\n`);
    process.stdout.write(`\n  ${String(j['text']).replace(/\n/g, '\n  ')}\n`);
    const notes = Array.isArray(j['notes']) ? j['notes'] : [];
    if (notes.length > 0) {
      process.stdout.write(`\n  notes (${notes.length}):\n`);
      for (const n of notes as Array<Record<string, unknown>>) {
        const noteProxy = n['invoked_by']
          ? ` [invoked_by=${n['invoked_by']}]`
          : '';
        process.stdout.write(
          `    └ ${n['by']}${noteProxy} at ${n['at']}\n` +
            `      ${String(n['text']).replace(/\n/g, '\n      ')}\n`,
        );
      }
    }
    return 0;
  }
  // State transitions: resolve, defer, start, reopen.
  const nextState = resolveIssueVerb(sub);
  if (nextState !== undefined) {
    rejectUnknownFlags(args, ISSUES_TRANSITION_KNOWN_FLAGS, `issues ${sub}`);
    const id = args.positional[1];
    if (!id) {
      throw new Error(`Usage: gate issues ${sub} <id> --by <m> [--note <s>]`);
    }
    const by = requireOption(args, 'by', '<m>', 'GUILD_ACTOR');
    const invokedBy = resolveInvokedBy(by, `issues ${sub}`, id);
    const note = optionalOption(args, 'note');
    const issue = await c.issueUC.setState(id, nextState, by, invokedBy, note);
    process.stdout.write(`✓ issue ${issue.id.value}: → ${nextState} by ${by}\n`);
    return 0;
  }
  // Unknown sub: suggest the closest match plus a gesture at the full
  // catalog. The bare-list of valid subs is more useful than 'unknown
  // sub: X' alone — without a hint a caller wired into muscle memory
  // for `gate show <id>` reaches for `issues show` and bounces with
  // no orientation. principle 09 (orientation-disclosure) applied to
  // the error path.
  const validSubs = [
    'add', 'list', 'show', 'note',
    'resolve', 'defer', 'start', 'reopen', 'promote',
  ];
  const suggestion = closestSub(sub, validSubs);
  const hint = suggestion ? ` — did you mean 'gate issues ${suggestion}'?` : '';
  throw new Error(
    `unknown issues sub: ${sub}${hint}\n` +
      `  valid: ${validSubs.join(' | ')}`,
  );
}

// Levenshtein-ish closest-match: simple character-overlap heuristic
// sufficient for short subcommand names. Returns the best candidate
// when the input shares at least half its characters with one of the
// valid subs; otherwise undefined so we don't suggest at random.
function closestSub(input: string, valid: readonly string[]): string | undefined {
  if (!input) return undefined;
  const lower = input.toLowerCase();
  let best: string | undefined;
  let bestScore = 0;
  for (const v of valid) {
    const score = overlapScore(lower, v);
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  // Threshold: at least 50% character overlap with the candidate.
  // Below this we'd be suggesting noise (e.g. `gate issues xyz` →
  // 'add' is not helpful).
  return bestScore >= Math.max(2, Math.ceil(input.length / 2)) ? best : undefined;
}

function overlapScore(a: string, b: string): number {
  // Substring containment is the strongest signal — if the user
  // typed a prefix of a valid sub, that's almost certainly what
  // they meant. Otherwise count shared characters in order.
  if (b.startsWith(a)) return a.length + 1; // boost prefix match
  if (a.startsWith(b)) return b.length + 1;
  let i = 0;
  let j = 0;
  let score = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      score += 1;
      i += 1;
      j += 1;
    } else if (a.length - i > b.length - j) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return score;
}

async function issuesPromote(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, ISSUES_PROMOTE_KNOWN_FLAGS, 'issues promote');
  const id = args.positional[1];
  if (!id) {
    throw new Error(
      'Usage: gate issues promote <id> --from <m> [--executor <m> | --executors a,b] ' +
        '[--auto-review <m>] [--action <a>] [--reason <r>]',
    );
  }
  const from = requireOption(args, 'from', '<m>', 'GUILD_ACTOR');
  const executor = optionalOption(args, 'executor');
  const executorsRaw = optionalOption(args, 'executors');
  const autoReview = optionalOption(args, 'auto-review');
  // Mutual exclusion mirrors `gate request` — single + multiple
  // executor flags must never coexist (issue #230).
  if (executor !== undefined && executorsRaw !== undefined) {
    process.stderr.write(
      `error: --executor and --executors are mutually exclusive (got both).\n`,
    );
    return 1;
  }
  const actionOverride = optionalOption(args, 'action');
  const reasonOverride = optionalOption(args, 'reason');

  const issue = await c.issueUC.find(id);
  if (!issue) {
    process.stderr.write(notFoundMessage('issue', id));
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
  const reason =
    reasonOverride ??
    `Promoted from ${id} (${j['severity']}/${j['area']}): ${issueText}`;

  const input: Parameters<typeof c.requestUC.create>[0] = {
    from,
    action,
    reason,
    // Structured link to the source issue. The default action/reason
    // already mention the issue id textually, but --action and
    // --reason can both be overridden — in which case the textual
    // link disappears and chain would lose the connection. This
    // field carries the tool-generated link independent of text
    // content, so chain can walk it regardless of overrides.
    promotedFrom: id,
  };
  if (executor !== undefined) input.executor = executor;
  if (executorsRaw !== undefined) {
    // Reuse the same comma-parser + validation as `gate request` so
    // promote shares one error-message vocabulary (issue #230).
    const parsed = parseExecutorsList(executorsRaw);
    if (parsed.error) {
      process.stderr.write(`error: --executors ${parsed.error}\n`);
      return 1;
    }
    if (parsed.list.length > 0) input.executors = parsed.list;
  }
  if (autoReview !== undefined) input.autoReview = autoReview;
  // Promote creates a request on `from`'s behalf; when GUILD_ACTOR
  // differs, the invariant applies the same way as plain `gate
  // request`. Stamp invoked_by on the created request so proxy-
  // promotion is visible in the new request's initial status_log.
  const invokedByPromote = deriveInvokedBy(from);
  if (invokedByPromote !== undefined) input.invokedBy = invokedByPromote;
  // Boot-context session_id (#249 / #289 hunk 2). promote → request
  // is the same write-side primitive as `gate request`, so the same
  // GUILD_SESSION_ID stamping contract applies. Absence stays absent
  // on disk so pre-#249 records stay byte-identical.
  const sessionId = resolveGuildSessionId();
  if (sessionId !== undefined) input.openedBySession = sessionId;

  // Non-atomic by design: create request first, then resolve issue.
  // If the second step fails we emit the request id so the operator
  // knows the partial state and can manually resolve the issue.
  const req = await c.requestUC.create(input);
  if (invokedByPromote !== undefined) {
    emitInvokedByNotice(from, invokedByPromote, 'issues promote', req.id.value);
  }
  try {
    await c.issueUC.setState(id, 'resolved', from, invokedByPromote);
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

async function issuesNote(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, ISSUES_NOTE_KNOWN_FLAGS, 'issues note');
  // Issues are otherwise immutable by design: the original severity /
  // area / text freeze the first-frame record. A `note` is the
  // escape hatch for revised understanding — "severity should be med
  // in hindsight", "actually not reproducible on macOS", "see i-...
  // for the follow-up". Append-only, no edit, no delete.
  const id = args.positional[1];
  if (!id) {
    throw new Error(
      'Usage: gate issues note <id> --by <m> [--text <s> | --text - | <text>]',
    );
  }
  const by = requireOption(args, 'by', '<m>', 'GUILD_ACTOR');
  // Text resolution mirrors `gate review --comment`:
  //   --text <s>       inline short note
  //   --text -         STDIN until EOF
  //   <positional>     everything after the id
  const textOpt = optionalOption(args, 'text');
  const positional = args.positional.slice(2).join(' ');
  let text: string;
  if (textOpt === '-') {
    text = (await readStdin()).trim();
  } else if (textOpt !== undefined) {
    text = textOpt;
  } else if (positional === '-') {
    // Symmetry with `--text -`. A lone `-` as positional argument
    // means "read the note body from stdin," same as in review.
    text = (await readStdin()).trim();
  } else {
    text = positional;
  }
  if (!text.trim()) {
    // If args.options.text landed as boolean, the user did pass --text
    // but with a value that began with "--" and the parser refused it.
    // Point at the POSIX escape valves explicitly — the stock error
    // wouldn't explain why the value they typed vanished.
    const hint =
      args.options['text'] === true
        ? '\n  (Your --text value began with "--" and was not consumed. ' +
          'Use --text=<value> or put "-- <value>" after the other flags.)'
        : '';
    throw new Error(
      'note text is required (use --text <s>, --text - for STDIN, ' +
        'or pass as positional argument)' +
        hint,
    );
  }
  const invokedBy = resolveInvokedBy(by, 'issues note', id);
  const addNoteInput: Parameters<typeof c.issueUC.addNote>[0] = {
    id,
    by,
    text,
  };
  if (invokedBy !== undefined) addNoteInput.invokedBy = invokedBy;
  const { note } = await c.issueUC.addNote(addNoteInput);
  process.stdout.write(
    `✓ note added to ${id} by ${note.by} at ${note.at}\n`,
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
