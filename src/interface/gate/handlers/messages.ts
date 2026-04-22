import {
  ParsedArgs,
  requireOption,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import {
  C,
  deriveInvokedBy,
  emitInvokedByNotice,
  readStdin,
} from './internal.js';

const MESSAGE_SEND_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'from',
  'to',
  'text',
  'type',
]);
const MESSAGE_BROADCAST_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'from',
  'text',
  'type',
]);
const INBOX_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'for',
  'unread',
]);

export async function msgSend(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, MESSAGE_SEND_KNOWN_FLAGS, 'message');
  const from = requireOption(args, 'from', '--from required', 'GUILD_ACTOR');
  const to = requireOption(args, 'to', '--to required');
  let text = requireOption(args, 'text', '--text required');
  // `--text -` reads from stdin — same sentinel as `gate issues note
  // --text -` and `gate review --comment -`. Heredoc bodies for long
  // handoff messages landed as literal "-" until this; that was
  // silent data loss, since the record-is-truth invariant broke
  // without any error to show for it.
  if (text === '-') text = (await readStdin()).trim();
  const type = optionalOption(args, 'type');
  const invokedBy = deriveInvokedBy(from);
  await c.messageUC.send({
    from,
    to,
    text,
    ...(type !== undefined ? { type } : {}),
    ...(invokedBy !== undefined ? { invokedBy } : {}),
  });
  if (invokedBy !== undefined) {
    emitInvokedByNotice(from, invokedBy, 'message →', to);
  }
  process.stdout.write(`✓ message sent: ${from} → ${to}\n`);
  return 0;
}

export async function msgBroadcast(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, MESSAGE_BROADCAST_KNOWN_FLAGS, 'broadcast');
  const from = requireOption(args, 'from', '--from required', 'GUILD_ACTOR');
  let text = requireOption(args, 'text', '--text required');
  if (text === '-') text = (await readStdin()).trim();
  const type = optionalOption(args, 'type');
  const invokedBy = deriveInvokedBy(from);
  if (invokedBy !== undefined) {
    emitInvokedByNotice(from, invokedBy, 'broadcast from', from);
  }
  const { delivered, failed } = await c.messageUC.broadcast({
    from,
    text,
    ...(type !== undefined ? { type } : {}),
    ...(invokedBy !== undefined ? { invokedBy } : {}),
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

export async function msgInbox(c: C, args: ParsedArgs): Promise<number> {
  // `gate inbox mark-read [N]` dispatches here too — the first
  // positional is treated as a subverb. This keeps the verb family
  // under a single `inbox` namespace. mark-read has its own flag set
  // (subset of INBOX_KNOWN_FLAGS), so the inner handler re-validates.
  if (args.positional[0] === 'mark-read') {
    return await msgInboxMarkRead(c, args);
  }

  rejectUnknownFlags(args, INBOX_KNOWN_FLAGS, 'inbox');
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
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (unreadOnly && m.read) continue;
    const idx = i + 1;
    const related = m.related ? ` (ref: ${m.related})` : '';
    const readTag = m.read
      ? m.readAt
        ? m.readBy && m.readBy !== forName
          ? ` (read ${m.readAt} by ${m.readBy})`
          : ` (read ${m.readAt})`
        : ' (read)'
      : ' (unread)';
    // Show invoked_by on the sender side so a recipient can tell a
    // ghost-sent message from a hand-typed one at a glance. The
    // mark-read side already has its own "by ..." marker on readTag.
    const sendProxy = m.invokedBy ? ` [invoked_by=${m.invokedBy}]` : '';
    process.stdout.write(
      `  ${idx}. [${m.at}] ${m.type} from ${m.from}${sendProxy}${related}${readTag}\n  ${m.text}\n`,
    );
  }
  return 0;
}

const INBOX_MARK_READ_KNOWN_FLAGS: ReadonlySet<string> = new Set(['for']);

async function msgInboxMarkRead(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, INBOX_MARK_READ_KNOWN_FLAGS, 'inbox mark-read');
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

  // The actor that ran the command (GUILD_ACTOR), which can legitimately
  // differ from the inbox owner when `--for <other>` is used. We pass
  // both so the audit trail records "who read for whom". Fall back to
  // the inbox owner when GUILD_ACTOR is unset — same-actor self-reader
  // is the common case, and stamping `read_by: <owner>` is correct.
  const envActor = process.env['GUILD_ACTOR'];
  const by = envActor && envActor.length > 0 ? envActor : forName;
  const result = await c.messageUC.markRead(forName, by, index);
  if (by !== forName) {
    // Surface the delegation so the operator sees that the trail will
    // say "by=<actor> for=<owner>" rather than a plain self-read.
    process.stderr.write(
      `# mark-read by ${by} on behalf of ${forName} (read_by recorded as ${by})\n`,
    );
  }
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
