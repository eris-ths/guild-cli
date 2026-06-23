import { CtxUseCases } from '../../application/CtxUseCases.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';
import { parseFormat } from '../../../../interface/shared/parseFormat.js';
import {
  ParsedArgs,
  optionalOption,
  requireOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { parseTagList } from './parseTagList.js';

const RECORD_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'fact',
  'tag',
  'by',
  'format',
]);

export interface RecordCtxDeps {
  readonly uc: CtxUseCases;
  readonly config: GuildConfig;
}

/**
 * ctx record — append a new fact to the substrate.
 *
 * Usage:
 *   ctx record --fact "..." [--tag tech:foo,status:bar] [--by <m>] [--format json|text]
 *
 * Produces: <content_root>/ctx/<id>.yaml
 *
 * --by defaults from GUILD_ACTOR (env or .guild-actor file). Same actor
 * resolution as gate / agora / devil.
 */
export async function recordCtx(
  deps: RecordCtxDeps,
  args: ParsedArgs,
): Promise<number> {
  rejectUnknownFlags(args, RECORD_KNOWN_FLAGS, 'record');

  const fact = requireOption(args, 'fact', '"..."');
  const tags = parseTagList(optionalOption(args, 'tag'));
  const by = requireOption(args, 'by', '<m>', 'GUILD_ACTOR');
  const format = parseFormat(args);

  const ctx = await deps.uc.record({ by, fact, tags });

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          id: ctx.id,
          ...ctx.toJSON(),
          where_written: `${deps.config.contentRoot}/ctx/${ctx.id}.yaml`,
          config_file: deps.config.configFile,
          suggested_next: {
            verb: 'ctx',
            args: ['list'],
            reason:
              'read the fact back (newest first) to confirm it landed; correct it later with `ctx supersede <id>`. fork / chain / status remain phase-2.',
          },
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(`✓ ctx recorded: ${ctx.id}\n`);
    if (tags.length > 0) {
      process.stdout.write(`  tags: ${tags.join(', ')}\n`);
    }
    process.stderr.write(
      `notice: wrote ${deps.config.contentRoot}/ctx/${ctx.id}.yaml (config: ${deps.config.configFile})\n`,
    );
  }
  return 0;
}
