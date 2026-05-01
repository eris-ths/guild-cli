import {
  ParsedArgs,
  requireOption,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import {
  C,
  readStdin,
  resolveInvokedBy,
  isDryRun,
  emitDryRunPreview,
} from './internal.js';
import { emitWriteResponse, parseFormat } from './writeFormat.js';

const THANK_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'for',
  'by',
  'reason',
  'dry-run',
  'format',
]);

/**
 * gate thank <to> --for <id> [--reason <s>] [--by <m>] [--dry-run]
 *
 * Record a cross-actor appreciation against a specific request. The
 * primitive is deliberately lightweight: no verdict, no state change,
 * no calibration impact. Pairs with `review` — reviews track
 * judgement, thanks track gratitude.
 *
 * Positional form: `gate thank <to> --for <id>`. `--by` defaults to
 * GUILD_ACTOR. Self-thank (`by == to`) is allowed but flagged on
 * stderr — it's not harmful, just odd.
 *
 * `--reason` is optional. Most of the time the fact of the thank is
 * the signal; a reason is a grace note. Supports `--reason -` for
 * stdin (symmetric with review --comment -).
 */
export async function reqThank(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, THANK_KNOWN_FLAGS, 'thank');
  const to = args.positional[0];
  if (!to) {
    throw new Error(
      'Usage: gate thank <to> --for <id> [--reason <s>] [--dry-run]',
    );
  }
  const id = requireOption(args, 'for', '--for <request-id> required');
  const by = requireOption(args, 'by', '--by required', 'GUILD_ACTOR');
  let reason = optionalOption(args, 'reason');
  if (reason === '-') reason = (await readStdin()).trim();
  const invokedBy = resolveInvokedBy(by, 'thank', id);

  const ucInput: Parameters<typeof c.requestUC.thank>[0] = {
    id,
    by,
    to,
  };
  if (reason !== undefined && reason.length > 0) ucInput.reason = reason;
  if (invokedBy !== undefined) ucInput.invokedBy = invokedBy;

  if (isDryRun(args)) {
    const updated = await c.requestUC.thank({ ...ucInput, dryRun: true });
    emitDryRunPreview({ verb: 'thank', id, by, after: updated, format: parseFormat(args) });
    return 0;
  }

  const updated = await c.requestUC.thank(ucInput);

  // Self-thank: not an error, just surface it so the log reads
  // honestly. Mirrors the self-review / self-approval notices.
  if (by === to) {
    process.stderr.write(
      `notice: self-thank — ${by} thanked themselves on ${id}. ` +
        `thanks is usually a cross-actor primitive; if that's intentional ` +
        `(e.g. thanking a past version of yourself), the record stands.\n`,
    );
  }

  emitWriteResponse(
    parseFormat(args),
    updated,
    `✓ thanked: ${to} on ${id}`,
    c.config,
  );
  return 0;
}
