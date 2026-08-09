import { DeltaUseCases } from '../../application/DeltaUseCases.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';
import { parseFormat } from '../../../../interface/shared/parseFormat.js';
import {
  ParsedArgs,
  optionalOption,
  requireOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';

const ADD_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'text',
  'source',
  'candidate',
  'by',
  'format',
]);

export interface AddDeltaDeps {
  readonly uc: DeltaUseCases;
  readonly config: GuildConfig;
}

/**
 * delta add — deposit a conclusion that has not been filed anywhere yet.
 *
 * Usage:
 *   delta add --text "..." [--source "..."] [--candidate "..."]
 *             [--by <m>] [--format json|text]
 *
 * Produces: <content_root>/delta/<id>.yaml
 *
 * Only `--text` is required beyond actor resolution. Every additional
 * mandatory flag would be paid on the interrupting path — the writer is
 * mid-task, which is why the deposit exists — so `source` and
 * `candidate` stay optional even though a filled-in `source` makes the
 * later `deliver` pass much easier.
 */
export async function addDelta(
  deps: AddDeltaDeps,
  args: ParsedArgs,
): Promise<number> {
  rejectUnknownFlags(args, ADD_KNOWN_FLAGS, 'add');

  const text = requireOption(args, 'text', '"..."');
  const source = optionalOption(args, 'source');
  const candidate = optionalOption(args, 'candidate');
  const by = requireOption(args, 'by', '<m>', 'GUILD_ACTOR');
  const format = parseFormat(args);

  const delta = await deps.uc.add({ by, text, source, candidate });
  const { count, oldest } = await deps.uc.pendingSummary();

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          id: delta.id,
          ...delta.toJSON(),
          pending_count: count,
          oldest_pending: oldest === null ? null : { id: oldest.id, created_at: oldest.created_at },
          where_written: `${deps.config.contentRoot}/delta/${delta.id}.yaml`,
          config_file: deps.config.configFile,
          suggested_next: {
            verb: 'delta',
            args: ['list'],
            reason:
              'depositing is meant to be cheap; draining is the part that needs attention. `delta list` shows what is outstanding, oldest first.',
          },
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(`✓ delta deposited: ${delta.id}\n`);
    // Surface the backlog on every deposit. A deposit surface without a
    // visible backlog turns into a drawer: cheap to add to, and nobody
    // learns it is full until something is lost out of it.
    if (count > 1 && oldest !== null) {
      process.stdout.write(
        `  pending: ${count} (oldest ${oldest.id}, ${oldest.created_at.slice(0, 10)})\n`,
      );
    }
    process.stderr.write(
      `notice: wrote ${deps.config.contentRoot}/delta/${delta.id}.yaml (config: ${deps.config.configFile})\n`,
    );
  }
  return 0;
}
