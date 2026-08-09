import { DeltaUseCases, DeltaNotFound } from '../../application/DeltaUseCases.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';
import { parseFormat } from '../../../../interface/shared/parseFormat.js';
import {
  ParsedArgs,
  optionalOption,
  requireOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { DomainError } from '../../../../domain/shared/DomainError.js';
import { RecoverableError } from '../../../../interface/shared/errorEnvelope.js';

const DELIVER_KNOWN_FLAGS: ReadonlySet<string> = new Set(['to', 'note', 'by', 'format']);

export interface DeliverDeltaDeps {
  readonly uc: DeltaUseCases;
  readonly config: GuildConfig;
}

/**
 * delta deliver — record that a deposit reached a destination.
 *
 * Usage:
 *   delta deliver <id> --to <dest> [--note "..."] [--by <m>]
 *                      [--format json|text]
 *
 * `--to` is free-form: destinations are whatever the operator's
 * workflow contains, and a closed vocabulary would push the real ones
 * into `--note` where they stop being filterable.
 *
 * A second delivery on the same deposit is refused by the domain. The
 * error names the first destination, because the case it guards is a
 * reader assuming a deposit went where they are about to file it.
 */
export async function deliverDelta(
  deps: DeliverDeltaDeps,
  args: ParsedArgs,
): Promise<number> {
  rejectUnknownFlags(args, DELIVER_KNOWN_FLAGS, 'deliver');
  const format = parseFormat(args);

  const id = args.positional[0];
  if (id === undefined || id.length === 0) {
    throw new DomainError('deliver requires a deposit id (delta deliver <id> --to <dest>)', 'id');
  }
  const to = requireOption(args, 'to', '<dest>');
  const note = optionalOption(args, 'note');
  const by = requireOption(args, 'by', '<m>', 'GUILD_ACTOR');

  let delta;
  try {
    delta = await deps.uc.deliver({ id, to, by, note });
  } catch (e) {
    if (e instanceof DeltaNotFound) {
      throw new RecoverableError(
        `delta deposit ${id} not found.\n` +
          '  list what is outstanding to find the right id:\n' +
          '    delta list',
        { verb: 'list', args: {}, reason: 'list outstanding deposits to find the right id' },
        'not_found',
      );
    }
    throw e;
  }

  const { count, oldest } = await deps.uc.pendingSummary();

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          id: delta.id,
          ...delta.toJSON(),
          state: delta.state,
          pending_count: count,
          oldest_pending: oldest === null ? null : { id: oldest.id, created_at: oldest.created_at },
          suggested_next:
            count > 0
              ? {
                  verb: 'delta',
                  args: ['list'],
                  reason: `${count} deposit${count === 1 ? '' : 's'} still outstanding, oldest first`,
                }
              : null,
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(`✓ delivered ${delta.id} → ${delta.delivered?.to}\n`);
    if (count > 0 && oldest !== null) {
      process.stdout.write(
        `  pending: ${count} (oldest ${oldest.id}, ${oldest.created_at.slice(0, 10)})\n`,
      );
    } else {
      process.stdout.write('  nothing outstanding.\n');
    }
  }
  return 0;
}
