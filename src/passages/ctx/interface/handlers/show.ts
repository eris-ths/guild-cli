import { CtxUseCases } from '../../application/CtxUseCases.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';
import { parseFormat } from '../../../../interface/shared/parseFormat.js';
import {
  ParsedArgs,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { DomainError } from '../../../../domain/shared/DomainError.js';
import { RecoverableError } from '../../../../interface/shared/errorEnvelope.js';

const SHOW_KNOWN_FLAGS: ReadonlySet<string> = new Set(['format']);

export interface ShowCtxDeps {
  readonly uc: CtxUseCases;
  readonly config: GuildConfig;
}

/**
 * ctx show — display a single recorded fact in full.
 *
 * Usage:
 *   ctx show <id> [--format json|text]
 *
 * A malformed id fails at the domain boundary (parseCtxId); a
 * well-formed but absent id raises a not-found that names `ctx list` as
 * the recovery path (both text hint and structured `error.recovery`).
 */
export async function showCtx(
  deps: ShowCtxDeps,
  args: ParsedArgs,
): Promise<number> {
  rejectUnknownFlags(args, SHOW_KNOWN_FLAGS, 'show');
  const format = parseFormat(args);

  const id = args.positional[0];
  if (id === undefined || id.length === 0) {
    throw new DomainError('show requires a fact id (ctx show <id>)', 'id');
  }

  const fact = await deps.uc.show(id); // findById validates id shape

  if (fact === null) {
    throw new RecoverableError(
      `ctx fact ${id} not found.\n` +
        '  list the recorded facts to find the right id:\n' +
        '    ctx list',
      { verb: 'list', args: {}, reason: 'list the recorded facts to find the right id' },
      'not_found',
    );
  }

  // A superseded fact stays readable (immutable substrate) but is marked
  // with the fact that corrects it, so a reader who pulls up an old id sees
  // it has a successor rather than treating it as current.
  const successor = await deps.uc.supersededBy(id);

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          ...fact.toJSON(),
          // reverse link, resolved at read time (the substrate stores only
          // the forward `supersedes`); null when this fact is still current.
          superseded_by: successor !== null ? successor.id : null,
        },
        null,
        2,
      ) + '\n',
    );
    return 0;
  }

  process.stdout.write(`${fact.id}\n`);
  process.stdout.write(`  created ${fact.created_at} by ${fact.created_by}\n`);
  if (fact.supersedes !== undefined) {
    process.stdout.write(`  supersedes: ${fact.supersedes}\n`);
  }
  if (successor !== null) {
    process.stdout.write(`  ⊘ superseded by: ${successor.id}\n`);
  }
  if (fact.tags.length > 0) {
    process.stdout.write(`  tags: ${fact.tags.join(', ')}\n`);
  }
  process.stdout.write(`\n${fact.fact}\n`);
  return 0;
}
