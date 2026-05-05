import { CtxUseCases } from '../../application/CtxUseCases.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';
import {
  ParsedArgs,
  optionalOption,
  requireOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { resolveGuildActor } from '../../../../interface/shared/resolveGuildActor.js';

const RECORD_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'fact',
  'tag',
  'by',
  'format',
]);

/**
 * Parse `--tag tech:typescript,status:active` (comma-separated) into a
 * clean tag list. Same convention as gate's `--with` (request.ts:
 * `parseWithList`). Tag-shape validation happens upstream in
 * Ctx.create -> parseCtxTag.
 */
function parseTagList(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

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
  const by = optionalOption(args, 'by') ?? resolveGuildActor();
  if (!by) {
    process.stderr.write(
      'error: --by required (or set GUILD_ACTOR / .guild-actor). ctx record attributes the observation to an actor.\n',
    );
    return 1;
  }
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    process.stderr.write(`error: --format must be 'json' or 'text', got: ${format}\n`);
    return 1;
  }

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
            verb: 'gate',
            args: ['boot'],
            reason:
              "phase 1 ships record only; show / list / fork / supersede / chain / status arrive in phase 2. Confirm the write landed via filesystem or `gate boot`.",
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
