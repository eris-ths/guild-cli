import {
  ParsedArgs,
  requireOption,
  optionalOption,
} from '../../shared/parseArgs.js';
import {
  C,
  readStdin,
  truncateCodePoints,
  deriveInvokedBy,
  emitInvokedByNotice,
  resolveInvokedBy,
} from './internal.js';

export async function issuesCmd(c: C, args: ParsedArgs): Promise<number> {
  const sub = args.positional[0];
  if (sub === 'promote') {
    return await issuesPromote(c, args);
  }
  if (sub === 'note') {
    return await issuesNote(c, args);
  }
  if (sub === 'add') {
    const from = requireOption(args, 'from', '--from required', 'GUILD_ACTOR');
    const severity = requireOption(args, 'severity', '--severity required');
    const area = requireOption(args, 'area', '--area required');
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
  if (sub === 'list' || sub === undefined) {
    const state = optionalOption(args, 'state');
    const items = await c.issueUC.list(state);
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
  // State transitions: resolve, defer, start, reopen.
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
  };
  if (executor !== undefined) input.executor = executor;
  if (autoReview !== undefined) input.autoReview = autoReview;
  // Promote creates a request on `from`'s behalf; when GUILD_ACTOR
  // differs, the invariant applies the same way as plain `gate
  // request`. Stamp invoked_by on the created request so proxy-
  // promotion is visible in the new request's initial status_log.
  const invokedByPromote = deriveInvokedBy(from);
  if (invokedByPromote !== undefined) input.invokedBy = invokedByPromote;

  // Non-atomic by design: create request first, then resolve issue.
  // If the second step fails we emit the request id so the operator
  // knows the partial state and can manually resolve the issue.
  const req = await c.requestUC.create(input);
  if (invokedByPromote !== undefined) {
    emitInvokedByNotice(from, invokedByPromote, 'issues promote', req.id.value);
  }
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

async function issuesNote(c: C, args: ParsedArgs): Promise<number> {
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
  const by = requireOption(args, 'by', '--by required', 'GUILD_ACTOR');
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
