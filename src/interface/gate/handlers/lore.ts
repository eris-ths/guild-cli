// `gate lore` — package-shipped doctrine reader.
//
// Two read subverbs:
//   - `gate lore list [--type] [--applies-to] [--relevant-until]`
//   - `gate lore show <name> [--format text|json]`
//
// Lore lives under `<packageRoot>/lore/principles/*.md` and
// `<packageRoot>/lore/traps/*.md`. The verb is read-only — lore is
// authored by editing markdown + shipping a PR, not by a CLI write.
//
// Why a verb when `cat lore/principles/X.md` works: discoverability
// from inside the substrate (no need to know the lore/ layout),
// frontmatter-aware filtering (applies_to, relevant_until), JSON
// output for orchestrators, and a single entry point for "what
// doctrine is live right now."

import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { maybeEmitExplain } from '../../shared/explain.js';
import { LoreType } from '../../../infrastructure/lore/LoreRepository.js';
import { C, truncateCodePoints } from './internal.js';
import { parseFormat } from '../../shared/parseFormat.js';

const LORE_LIST_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'type',
  'applies-to',
  'relevant-until',
  'format',
]);
const LORE_SHOW_KNOWN_FLAGS: ReadonlySet<string> = new Set(['format']);

export async function loreCmd(c: C, args: ParsedArgs): Promise<number> {
  const sub = args.positional[0];
  if (sub === undefined) {
    process.stderr.write(
      'gate lore needs a subcommand:\n' +
        '  gate lore list                          # every principle + trap\n' +
        '  gate lore list --type principle         # principles only\n' +
        '  gate lore list --applies-to swarm       # principles for swarm profile\n' +
        '  gate lore list --relevant-until current # active traps\n' +
        '  gate lore show <name>                   # full body\n',
    );
    return 1;
  }
  if (!c.loreUC.available) {
    process.stderr.write(
      `gate lore: lore directory not found (looked under packageRoot/lore/).\n` +
        `  This usually means the guild-cli install is incomplete; reinstall ` +
        `or run from a checkout that has lore/ in place.\n`,
    );
    return 1;
  }
  if (sub === 'list') return loreList(c, args);
  if (sub === 'show') return loreShow(c, args);
  process.stderr.write(
    `unknown subcommand: gate lore ${sub}\n` +
      `  valid: list | show\n`,
  );
  return 1;
}

function loreList(c: C, args: ParsedArgs): number {
  rejectUnknownFlags(args, LORE_LIST_KNOWN_FLAGS, 'lore list');
  maybeEmitExplain(args, 'lore list');
  const typeRaw = optionalOption(args, 'type');
  const appliesTo = optionalOption(args, 'applies-to');
  const relevantUntilRaw = optionalOption(args, 'relevant-until');
  const format = parseFormat(args);
  let type: LoreType | undefined;
  if (typeRaw !== undefined) {
    if (typeRaw !== 'principle' && typeRaw !== 'trap') {
      throw new Error(
        `--type must be 'principle' or 'trap', got: ${typeRaw}`,
      );
    }
    type = typeRaw;
  }
  let relevantUntil: 'current' | 'expired' | 'indefinite' | undefined;
  if (relevantUntilRaw !== undefined) {
    if (
      relevantUntilRaw !== 'current' &&
      relevantUntilRaw !== 'expired' &&
      relevantUntilRaw !== 'indefinite'
    ) {
      throw new Error(
        `--relevant-until must be 'current', 'expired', or 'indefinite', ` +
          `got: ${relevantUntilRaw}`,
      );
    }
    relevantUntil = relevantUntilRaw;
  }
  const filter = {
    ...(type !== undefined ? { type } : {}),
    ...(appliesTo !== undefined ? { appliesTo } : {}),
    ...(relevantUntil !== undefined ? { relevantUntil } : {}),
  };
  const items = c.loreUC.list(filter);
  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        items.map((e) => ({
          name: e.name,
          type: e.type,
          title: e.title,
          frontmatter: e.frontmatter,
        })),
        null,
        2,
      ) + '\n',
    );
    return 0;
  }
  if (items.length === 0) {
    process.stdout.write(
      `(no lore entries match the filter; try a wider --type / --applies-to / --relevant-until)\n`,
    );
    return 0;
  }
  for (const e of items) {
    const tag =
      e.type === 'principle'
        ? `[principle${
            e.frontmatter['applies_to']
              ? `/${e.frontmatter['applies_to']}`
              : ''
          }]`
        : `[trap/${e.frontmatter['relevant_until'] ?? '?'}]`;
    const title = e.title ?? '(no title)';
    process.stdout.write(
      `${e.name}  ${tag}  ${truncateCodePoints(title, 60)}\n`,
    );
  }
  return 0;
}

function loreShow(c: C, args: ParsedArgs): number {
  rejectUnknownFlags(args, LORE_SHOW_KNOWN_FLAGS, 'lore show');
  maybeEmitExplain(args, 'lore show');
  const name = args.positional[1];
  if (!name) {
    throw new Error(
      'Usage: gate lore show <name> [--format text|json]',
    );
  }
  const format = parseFormat(args);
  const entry = c.loreUC.find(name);
  if (!entry) {
    // Custom not-found message — `notFoundMessage` ships with a typed
    // entity enum (request|issue|member) we don't want to widen for
    // one verb. Hint shape: name what's missing + how to discover.
    process.stderr.write(
      `lore entry not found: ${name}\n` +
        `  next: gate lore list  # see every available principle / trap\n`,
    );
    return 1;
  }
  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          name: entry.name,
          type: entry.type,
          title: entry.title,
          frontmatter: entry.frontmatter,
          body: entry.body,
        },
        null,
        2,
      ) + '\n',
    );
    return 0;
  }
  // Text: print body verbatim. Lore files are markdown; the source
  // is already human-readable. Adding a header here would duplicate
  // the H1 already in the body — let the file speak for itself.
  process.stdout.write(entry.body);
  if (!entry.body.endsWith('\n')) process.stdout.write('\n');
  return 0;
}
