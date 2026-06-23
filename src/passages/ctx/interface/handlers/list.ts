import { CtxUseCases } from '../../application/CtxUseCases.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';
import { parseFormat } from '../../../../interface/shared/parseFormat.js';
import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { parseCtxTag } from '../../domain/Ctx.js';

const LIST_KNOWN_FLAGS: ReadonlySet<string> = new Set(['tag', 'by', 'all', 'format']);

/** Boolean flags `ctx list` owns (so the parser doesn't eat a positional). */
export const LIST_BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['all']);

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
 *   ctx list [--tag prefix:value] [--by <m>] [--all] [--format json|text]
 *
 * Closes the phase-1 read-side gap surfaced by dogfooding: before this,
 * the only way to read facts back was `grep` over `<content_root>/ctx/`.
 * `--tag` filters by an exact tag (validated at the boundary). By default
 * superseded facts are folded out (current view); `--all` keeps every
 * fact, superseded ones included, for audit / history.
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
  const includeAll = args.options['all'] === true;

  const filter: { tag?: string; by?: string; includeAll?: boolean } = {};
  if (tag !== undefined) filter.tag = tag;
  if (by !== undefined) filter.by = by;
  if (includeAll) filter.includeAll = true;

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
      // An empty default view means an empty store: the newest fact can
      // never be superseded (nothing is written after it to point back at
      // it), so a non-empty store always keeps at least one current head.
      // There is therefore no "everything is superseded" state to message —
      // an empty unfiltered list is genuinely empty, --all or not.
      process.stdout.write(
        'no ctx facts recorded yet.\n' +
          '  record one: ctx record --fact "<prose>" [--tag prefix:value]\n',
      );
    }
    return 0;
  }

  // With --all, superseded facts are present; mark them so the reader can
  // tell the current head from a corrected predecessor without a second
  // call. supersededIds is the set of ids that some shown fact corrects.
  const supersededIds = new Set<string>();
  if (includeAll) {
    for (const f of facts) {
      if (f.supersedes !== undefined) supersededIds.add(f.supersedes);
    }
  }

  const scope = filtered ? ' (filtered)' : includeAll ? ' (all, incl. superseded)' : '';
  process.stdout.write(
    `${facts.length} ctx fact${facts.length === 1 ? '' : 's'}${scope} — newest first\n\n`,
  );
  for (const f of facts) {
    const mark = supersededIds.has(f.id) ? '  ⊘ superseded' : '';
    process.stdout.write(`${f.id}  ${f.created_by}  ${f.created_at.slice(0, 16)}${mark}\n`);
    if (f.supersedes !== undefined) {
      process.stdout.write(`  ↳ supersedes ${f.supersedes}\n`);
    }
    if (f.tags.length > 0) {
      process.stdout.write(`  [${f.tags.join(', ')}]\n`);
    }
    process.stdout.write(`  ${snippet(f.fact)}\n\n`);
  }
  return 0;
}
