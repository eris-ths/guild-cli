import { CtxUseCases, SupersedeTargetMissing } from '../../application/CtxUseCases.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';
import { parseFormat } from '../../../../interface/shared/parseFormat.js';
import { resolveStdinSentinels } from '../../../../interface/shared/stdinSentinel.js';
import {
  ParsedArgs,
  optionalOption,
  requireOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { DomainError } from '../../../../domain/shared/DomainError.js';
import { RecoverableError } from '../../../../interface/shared/errorEnvelope.js';
import { parseTagList } from './parseTagList.js';

const SUPERSEDE_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'fact',
  'tag',
  'by',
  'format',
]);

export interface SupersedeCtxDeps {
  readonly uc: CtxUseCases;
  readonly config: GuildConfig;
}

/**
 * ctx supersede — correct an older fact with a new one.
 *
 * Usage:
 *   ctx supersede <old-id> --fact "<corrected prose>"
 *                          [--tag tech:foo,status:bar] [--by <m>] [--format json|text]
 *
 * Records a *new* fact whose `supersedes` points back at <old-id>. The old
 * record is never mutated (immutable substrate); `ctx list` folds it out by
 * default and `ctx list --all` / `ctx show <old-id>` keep it visible, marked
 * with its successor. A missing <old-id> is a recoverable not-found that
 * names `ctx list` as the recovery path — a correction must point at
 * something real, so a dangling link is rejected loudly rather than written.
 */
export async function supersedeCtx(
  deps: SupersedeCtxDeps,
  args: ParsedArgs,
): Promise<number> {
  rejectUnknownFlags(args, SUPERSEDE_KNOWN_FLAGS, 'supersede');

  const oldId = args.positional[0];
  if (oldId === undefined || oldId.length === 0) {
    throw new DomainError(
      'supersede requires the id being corrected (ctx supersede <old-id> --fact "...")',
      'id',
    );
  }

  const { fact } = await resolveStdinSentinels({
    fact: requireOption(args, 'fact', '"..."'),
  });
  const tags = parseTagList(optionalOption(args, 'tag'));
  const by = requireOption(args, 'by', '<m>', 'GUILD_ACTOR');
  const format = parseFormat(args);

  let ctx;
  try {
    ctx = await deps.uc.supersede({ oldId, by, fact, tags });
  } catch (e) {
    if (e instanceof SupersedeTargetMissing) {
      throw new RecoverableError(
        `ctx supersede target ${e.id} not found.\n` +
          '  a correction must point at a real fact. list them to find the id:\n' +
          '    ctx list',
        { verb: 'list', args: {}, reason: 'list the recorded facts to find the right id' },
        'not_found',
      );
    }
    throw e;
  }

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          id: ctx.id,
          ...ctx.toJSON(),
          where_written: `${deps.config.contentRoot}/ctx/${ctx.id}.yaml`,
          config_file: deps.config.configFile,
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(`✓ ctx ${ctx.id} supersedes ${oldId}\n`);
    if (tags.length > 0) {
      process.stdout.write(`  tags: ${tags.join(', ')}\n`);
    }
    process.stderr.write(
      `notice: wrote ${deps.config.contentRoot}/ctx/${ctx.id}.yaml (config: ${deps.config.configFile})\n`,
    );
  }
  return 0;
}
