import { CtxUseCases } from '../../application/CtxUseCases.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';
import { parseFormat } from '../../../../interface/shared/parseFormat.js';
import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { parseCtxTag } from '../../domain/Ctx.js';

const LIST_KNOWN_FLAGS: ReadonlySet<string> = new Set(['tag', 'by', 'format']);

/** First non-empty, non-heading line of `fact`, collapsed and truncated. */
function snippet(fact: string, max = 100): string {
  const line = fact
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (line === undefined) return '';
  const collapsed = line.replace(/\s+/g, ' ');
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

export interface ListCtxDeps {
  readonly uc: CtxUseCases;
  readonly config: GuildConfig;
}

/**
 * ctx list — read recorded facts back, newest first.
 *
 * Usage:
 *   ctx list [--tag prefix:value] [--by <m>] [--format json|text]
 *
 * Closes the phase-1 read-side gap surfaced by dogfooding: before this,
 * the only way to read facts back was `grep` over `<content_root>/ctx/`.
 * `--tag` filters by an exact tag (validated at the boundary).
 */
export async function listCtx(
  deps: ListCtxDeps,
  args: ParsedArgs,
): Promise<number> {
  rejectUnknownFlags(args, LIST_KNOWN_FLAGS, 'list');
  const format = parseFormat(args);

  const tag = optionalOption(args, 'tag');
  if (tag !== undefined) parseCtxTag(tag); // validate the filter shape loud
  const by = optionalOption(args, 'by');

  const filter: { tag?: string; by?: string } = {};
  if (tag !== undefined) filter.tag = tag;
  if (by !== undefined) filter.by = by;

  const facts = await deps.uc.list(filter);

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          count: facts.length,
          filter,
          facts: facts.map((f) => f.toJSON()),
        },
        null,
        2,
      ) + '\n',
    );
    return 0;
  }

  const filtered = tag !== undefined || by !== undefined;
  if (facts.length === 0) {
    if (filtered) {
      process.stdout.write('no ctx facts match the filter.\n');
    } else {
      process.stdout.write(
        'no ctx facts recorded yet.\n' +
          '  record one: ctx record --fact "<prose>" [--tag prefix:value]\n',
      );
    }
    return 0;
  }

  const scope = filtered ? ' (filtered)' : '';
  process.stdout.write(
    `${facts.length} ctx fact${facts.length === 1 ? '' : 's'}${scope} — newest first\n\n`,
  );
  for (const f of facts) {
    process.stdout.write(`${f.id}  ${f.created_by}  ${f.created_at.slice(0, 16)}\n`);
    if (f.tags.length > 0) {
      process.stdout.write(`  [${f.tags.join(', ')}]\n`);
    }
    process.stdout.write(`  ${snippet(f.fact)}\n\n`);
  }
  return 0;
}
