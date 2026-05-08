import {
  ParsedArgs,
  optionalOption,
  requireOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { C } from './internal.js';
import { parseFormat } from './writeFormat.js';

/**
 * gate rest [--by <m>] [--note <s>] [--format json|text]
 *
 * Boundary record — "I am putting this down now" (#36 Phase 2).
 *
 * Not a lifecycle toggle: `rest` doesn't transition any state, it
 * just stamps a moment. The length of a break is itself information,
 * the way a commit timestamp is — explicit `rest` markers let
 * downstream verbs (`tail`, `voices`, `resume`) render the session
 * with the boundary visible.
 *
 * Free-form `--note` is optional. Mandating one would turn the verb
 * into "reflect" — a different shape with a different ergonomic
 * cost. The verb's bare form (`gate rest`) must stay frictionless,
 * so the agent reaches for it as easily as `git commit -m '.'`.
 *
 * The matching `gate wake` and `gate farewell` verbs land in
 * follow-up PRs. Their record kinds are already in the domain enum
 * — see `SessionEvent.ts` — so this PR's storage layer accepts
 * them on read without a future migration.
 */
const REST_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'by',
  'note',
  'format',
]);

export async function restCmd(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, REST_KNOWN_FLAGS, 'rest');
  const by = requireOption(args, 'by', '<m>', 'GUILD_ACTOR');
  const note = optionalOption(args, 'note');
  const format = parseFormat(args);

  const event = await c.sessionEventUC.record({
    kind: 'rest',
    by,
    ...(note !== undefined ? { note } : {}),
  });

  const message = `✓ rested: ${event.id} by ${event.by.value}`;
  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          ...event.toJSON(),
          message,
          // No suggested_next: the natural pair (`gate wake`) lands
          // in a follow-up PR. Pre-suggesting a verb that doesn't
          // exist yet would be a fake prescription. Once `wake`
          // ships, this slot will name it.
          suggested_next: null,
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(message + '\n');
    if (event.note !== undefined) {
      process.stdout.write(`  note: ${event.note}\n`);
    }
  }
  return 0;
}
