import { DeltaUseCases, DeltaListFilter } from '../../application/DeltaUseCases.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';
import { parseFormat } from '../../../../interface/shared/parseFormat.js';
import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { DomainError } from '../../../../domain/shared/DomainError.js';
import { parseDeltaDestination } from '../../domain/Delta.js';

const LIST_KNOWN_FLAGS: ReadonlySet<string> = new Set(['state', 'by', 'to', 'format']);

const STATES = ['pending', 'delivered', 'all'] as const;
type ListState = (typeof STATES)[number];

/** First non-empty line of `text`, collapsed and truncated. */
function snippet(text: string, max = 100): string {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (line === undefined) return '';
  const collapsed = line.replace(/\s+/g, ' ');
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

/** Whole days between an ISO timestamp and now (floored, never negative). */
function daysAgo(iso: string, now: Date): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}

export interface ListDeltaDeps {
  readonly uc: DeltaUseCases;
  readonly config: GuildConfig;
}

/**
 * delta list — read deposits back, oldest first.
 *
 * Usage:
 *   delta list [--state pending|delivered|all] [--by <m>] [--to <dest>]
 *              [--format json|text]
 *
 * Oldest-first is deliberate (see DeltaUseCases.list): this list is read
 * to drain a backlog, so the item that has waited longest must be the
 * one that cannot scroll away.
 */
export async function listDelta(
  deps: ListDeltaDeps,
  args: ParsedArgs,
): Promise<number> {
  rejectUnknownFlags(args, LIST_KNOWN_FLAGS, 'list');
  const format = parseFormat(args);

  const rawState = optionalOption(args, 'state');
  if (rawState !== undefined && !(STATES as readonly string[]).includes(rawState)) {
    throw new DomainError(
      `state must be one of ${STATES.join(' | ')}, got: ${rawState}`,
      'state',
    );
  }
  const state = (rawState ?? 'pending') as ListState;
  const by = optionalOption(args, 'by');
  const to = optionalOption(args, 'to');
  if (to !== undefined) parseDeltaDestination(to); // validate the filter shape loud

  const filter: DeltaListFilter = {
    state,
    ...(by !== undefined ? { by } : {}),
    ...(to !== undefined ? { to } : {}),
  };

  const deltas = await deps.uc.list(filter);
  const now = new Date();

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          count: deltas.length,
          filter,
          deltas: deltas.map((d) => ({ ...d.toJSON(), state: d.state })),
        },
        null,
        2,
      ) + '\n',
    );
    return 0;
  }

  const filtered = by !== undefined || to !== undefined;
  if (deltas.length === 0) {
    if (filtered) {
      process.stdout.write('no delta deposits match the filter.\n');
    } else if (state === 'pending') {
      // Distinguish "drained" from "never used": an empty pending list is
      // the healthy end state, and reporting it as if the passage were
      // unused would hide a real signal.
      const any = await deps.uc.list({ state: 'all' });
      process.stdout.write(
        any.length === 0
          ? 'no delta deposits yet.\n' +
              '  deposit one: delta add --text "<what is unfiled>" [--source "<where it came from>"]\n'
          : `nothing outstanding — all ${any.length} deposit${any.length === 1 ? '' : 's'} delivered.\n`,
      );
    } else {
      process.stdout.write(`no delta deposits in state '${state}'.\n`);
    }
    return 0;
  }

  const scope = filtered ? ' (filtered)' : state === 'pending' ? '' : ` (${state})`;
  process.stdout.write(
    `${deltas.length} delta deposit${deltas.length === 1 ? '' : 's'}${scope} — oldest first\n\n`,
  );
  for (const d of deltas) {
    const age = daysAgo(d.created_at, now);
    // Age is shown on the deposit, not just on the backlog header: a
    // single stale item inside a short list is exactly what a count
    // hides.
    const aged = age >= 1 ? `  ${age}d` : '';
    process.stdout.write(`${d.id}  ${d.created_by}  ${d.created_at.slice(0, 16)}${aged}\n`);
    process.stdout.write(`  ${snippet(d.text)}\n`);
    if (d.source !== undefined) process.stdout.write(`  ⟵ ${snippet(d.source, 80)}\n`);
    if (d.candidate !== undefined && d.delivered === undefined) {
      process.stdout.write(`  → candidate: ${snippet(d.candidate, 60)}\n`);
    }
    if (d.delivered !== undefined) {
      process.stdout.write(
        `  ⟹ ${d.delivered.to} (${d.delivered.at.slice(0, 10)} by ${d.delivered.by})\n`,
      );
      if (d.delivered.note !== undefined) {
        process.stdout.write(`    ${snippet(d.delivered.note, 80)}\n`);
      }
    }
    process.stdout.write('\n');
  }
  return 0;
}
