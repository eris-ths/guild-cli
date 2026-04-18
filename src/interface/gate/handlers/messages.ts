import {
  ParsedArgs,
  requireOption,
  optionalOption,
} from '../../shared/parseArgs.js';
import { C } from './internal.js';

export async function msgSend(c: C, args: ParsedArgs): Promise<number> {
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

export async function msgBroadcast(c: C, args: ParsedArgs): Promise<number> {
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

export async function msgInbox(c: C, args: ParsedArgs): Promise<number> {
  // `gate inbox mark-read [N]` dispatches here too — the first
  // positional is treated as a subverb. This keeps the verb family
  // under a single `inbox` namespace.
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
    process.stdout.write(
      `  ${idx}. [${m.at}] ${m.type} from ${m.from}${related}${readTag}\n  ${m.text}\n`,
    );
  }
  return 0;
}

async function msgInboxMarkRead(c: C, args: ParsedArgs): Promise<number> {
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
