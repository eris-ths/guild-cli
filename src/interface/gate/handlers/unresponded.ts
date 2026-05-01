import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { C, parseOptionalIntOption } from './internal.js';
import {
  DEFAULT_MAX_AGE_DAYS,
  UnrespondedConcernsEntry,
} from '../../../application/concern/UnrespondedConcernsQuery.js';

const UNRESPONDED_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'for',
  'max-age-days',
  'format',
]);

/**
 * gate unresponded [--for <m>] [--max-age-days <N>] [--format json|text]
 *
 * Surfaces concern/reject verdicts on the actor's authored (or
 * pair-made) requests that have no follow-up record yet. Read-only —
 * a thin wrapper over `UnrespondedConcernsQuery` (deliberately the
 * same query that drives `gate resume`'s concerns surface, so the
 * two cannot diverge).
 *
 * Naming: the verb is `unresponded`, not `concerns`. The latter would
 * suggest the output enumerates *all* concerns; the actual semantic
 * is "concerns where no follow-up exists yet" — a deliberately coarse
 * follow-up detector (see UnrespondedConcernsQuery's header). Aligning
 * the verb with the underlying function name keeps reader expectations
 * matched to implementation. The detector explicitly does NOT try to
 * decide whether a follow-up actually addresses a concern; that
 * judgement is the reader's. `gate chain <id>` walks the actual
 * references when the reader wants to verify.
 *
 * Default actor: GUILD_ACTOR. `--for <m>` overrides for cross-actor
 * inspection (e.g. a host scanning what their executor has open).
 *
 * Default max-age: 30 days (`UnrespondedConcernsQuery.DEFAULT_MAX_AGE_DAYS`).
 * `--max-age-days <N>` overrides for retrospective sweeps.
 */

interface UnrespondedPayload {
  actor: string;
  max_age_days: number;
  entries: ReadonlyArray<UnrespondedConcernsEntry>;
  count: number;
}

export async function unrespondedCmd(
  c: C,
  args: ParsedArgs,
): Promise<number> {
  // Strict-flag rejection: keeps consistency with `gate tail` /
  // `gate doctor` / `gate repair` (read verbs that have already
  // adopted the discipline). A typo like `--max-age-day 7`
  // silently falling back to the 30-day default would be the
  // exact fail-open shape this guard exists to prevent.
  rejectUnknownFlags(args, UNRESPONDED_KNOWN_FLAGS, 'unresponded');
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    throw new Error(`--format must be 'json' or 'text', got: ${format}`);
  }

  const explicit = optionalOption(args, 'for');
  const envActor = process.env['GUILD_ACTOR'];
  const actor = explicit ?? envActor ?? '';
  if (!actor) {
    process.stderr.write(
      'gate unresponded needs an actor: pass --for <m> or export GUILD_ACTOR.\n',
    );
    return 1;
  }

  const maxAgeDays =
    parseOptionalIntOption(args, 'max-age-days') ?? DEFAULT_MAX_AGE_DAYS;

  const entries = await c.unrespondedConcernsQ.run({
    actor,
    now: new Date(),
    maxAgeDays,
  });

  const payload: UnrespondedPayload = {
    actor,
    max_age_days: maxAgeDays,
    entries,
    count: entries.length,
  };

  if (format === 'json') {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return 0;
  }

  if (entries.length === 0) {
    process.stdout.write(
      `(no unresponded concerns for ${actor} within ${maxAgeDays} days)\n`,
    );
    return 0;
  }

  process.stdout.write(
    `${entries.length} unresponded concern record(s) for ${actor} ` +
      `(window: ${maxAgeDays} days)\n\n`,
  );
  for (const e of entries) {
    process.stdout.write(`${e.request_id}  ${e.action}\n`);
    for (const c of e.concerns) {
      process.stdout.write(
        `  [${c.lense}/${c.verdict}] by ${c.by} ` +
          `(${c.age_days}d ago at ${c.at})\n`,
      );
    }
    process.stdout.write(
      `  → walk \`gate chain ${e.request_id}\` to see what (if anything) ` +
        `already references it.\n\n`,
    );
  }
  // Advisory footer — same shape as `gate suggest`'s footer.
  // Reminds the reader that "no follow-up" is a structural fact,
  // not a judgement about whether the concern matters today.
  process.stderr.write(
    '# advisory — these are concerns without follow-up records.\n' +
      '# leaving as-is, conversing them out, or letting them fade ' +
      'are all first-class.\n',
  );
  return 0;
}
