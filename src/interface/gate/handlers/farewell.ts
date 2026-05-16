import {
  ParsedArgs,
  optionalOption,
  requireOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { C } from './internal.js';
import { parseFormat } from '../../shared/parseFormat.js';
import {
  fireBeforeSessionHook,
  fireAfterSessionHook,
  emitHookVeto,
} from '../../../application/plugin/HookBus.js';
import { SessionEventVetoed } from '../../../application/session/SessionEventUseCases.js';

/**
 * gate farewell [--by <m>] [--note <s>] [--format json|text]
 *
 * Ceremonial close — "until next session" (#36 Phase 2 step 3).
 *
 * Distinct from `gate rest` ("until later today"): farewell is
 * the boundary an agent stamps before the session ENDS, not before
 * a break inside the same session. Pairs with `gate resume` at the
 * next session start — the future `gate resume` integration will
 * compose restoration prose around the most recent farewell, so the
 * next session starts with "your last farewell at {timestamp},
 * here's what was open at the time" rather than guessing from the
 * tail of the activity log.
 *
 * Why two boundary verbs (rest / farewell) rather than one with a
 * flag: ergonomics. The verb name carries the semantic — agents
 * reach for `rest` mid-session and `farewell` at session-end
 * naturally. A `--scope=session|day` flag on `rest` would push the
 * decision into the call site every time. Two short verbs cost
 * nothing on the dispatch table and stay frictionless.
 *
 * suggested_next is null: farewell is terminal in the session
 * sense. The next call comes from a NEW session running
 * `gate resume`. Pre-suggesting resume here would be a weird
 * shape — the JSON consumer that just farewelled wouldn't run it.
 * The advisory pointer at resume lives in the text-mode message
 * footer instead, where a human reader sees it as a parting note.
 */
const FAREWELL_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'by',
  'note',
  'format',
]);

export async function farewellCmd(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, FAREWELL_KNOWN_FLAGS, 'farewell');
  const by = requireOption(args, 'by', '<m>', 'GUILD_ACTOR');
  const note = optionalOption(args, 'note');
  const format = parseFormat(args);

  // #290: same before:/after: hook fire shape as `gate rest`. See
  // rest.ts for the rationale; the only difference here is the verb.
  let event;
  try {
    event = await c.sessionEventUC.record(
      {
        kind: 'farewell',
        by,
        ...(note !== undefined ? { note } : {}),
      },
      {
        beforeSave: async (e) => {
          const veto = await fireBeforeSessionHook(
            c.hookSubscriptions, 'farewell', e, by,
          );
          return { veto: veto ? { reason: veto.reason } : null };
        },
        afterSave: async (e) => {
          await fireAfterSessionHook(c.hookSubscriptions, 'farewell', e, by);
        },
      },
    );
  } catch (e) {
    if (e instanceof SessionEventVetoed) {
      return emitHookVeto('farewell', '(unsaved)', {
        allow: false,
        reason: e.reason,
      });
    }
    throw e;
  }

  const message = `✓ farewell: ${event.id} by ${event.by.value}`;
  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          ...event.toJSON(),
          message,
          // Terminal in the session sense — see file header for
          // why null here is the right shape.
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
    // Parting note — text-mode only, since the JSON envelope's
    // suggested_next is structured advisory and a free-form
    // "next time, do X" doesn't fit. Humans (or text-mode agents)
    // reading farewell's output see the resume hint here.
    process.stdout.write(
      `  next session: \`gate resume\` will pick up around this farewell.\n`,
    );
  }
  return 0;
}
