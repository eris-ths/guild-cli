import { DeltaUseCases } from '../../application/DeltaUseCases.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';
import { parseFormat } from '../../../../interface/shared/parseFormat.js';
import {
  ParsedArgs,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { DomainError } from '../../../../domain/shared/DomainError.js';
import { RecoverableError } from '../../../../interface/shared/errorEnvelope.js';

const SHOW_KNOWN_FLAGS: ReadonlySet<string> = new Set(['format']);

export interface ShowDeltaDeps {
  readonly uc: DeltaUseCases;
  readonly config: GuildConfig;
}

/**
 * delta show — display a single deposit in full.
 *
 * Usage:
 *   delta show <id> [--format json|text]
 *
 * A malformed id fails at the domain boundary; a well-formed but absent
 * id raises a not-found that names `delta list` as the recovery path.
 */
export async function showDelta(
  deps: ShowDeltaDeps,
  args: ParsedArgs,
): Promise<number> {
  rejectUnknownFlags(args, SHOW_KNOWN_FLAGS, 'show');
  const format = parseFormat(args);

  const id = args.positional[0];
  if (id === undefined || id.length === 0) {
    throw new DomainError('show requires a deposit id (delta show <id>)', 'id');
  }

  const delta = await deps.uc.find(id); // find validates id shape

  if (delta === null) {
    throw new RecoverableError(
      `delta deposit ${id} not found.\n` +
        '  list the deposits to find the right id:\n' +
        '    delta list --state all',
      { verb: 'list', args: { state: 'all' }, reason: 'list deposits to find the right id' },
      'not_found',
    );
  }

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify({ ok: true, ...delta.toJSON(), state: delta.state }, null, 2) + '\n',
    );
    return 0;
  }

  process.stdout.write(`${delta.id}  [${delta.state}]\n`);
  process.stdout.write(`  created ${delta.created_at} by ${delta.created_by}\n`);
  if (delta.source !== undefined) process.stdout.write(`  source: ${delta.source}\n`);
  if (delta.candidate !== undefined) {
    process.stdout.write(`  candidate: ${delta.candidate}\n`);
  }
  if (delta.delivered !== undefined) {
    process.stdout.write(
      `  delivered → ${delta.delivered.to} at ${delta.delivered.at} by ${delta.delivered.by}\n`,
    );
    if (delta.delivered.note !== undefined) {
      process.stdout.write(`    note: ${delta.delivered.note}\n`);
    }
  }
  process.stdout.write(`\n${delta.text}\n`);
  return 0;
}
