import {
  ParsedArgs,
  optionalOption,
  requireOption,
  rejectUnknownFlags,
} from '../../shared/parseArgs.js';
import { C } from './internal.js';
import { parseFormat } from './writeFormat.js';
import {
  fireBeforeSessionHook,
  fireAfterSessionHook,
  emitHookVeto,
} from '../../../application/plugin/HookBus.js';
import { SessionEventVetoed } from '../../../application/session/SessionEventUseCases.js';

/**
 * gate wake [--by <m>] [--note <s>] [--format json|text]
 *
 * Pairing verb to `gate rest` — "I am picking this back up"
 * (#36 Phase 2 step 2).
 *
 * Decoupled from rest by design: wake does NOT require a prior
 * rest record. The two are independent boundary stamps; the
 * relationship is observed by the reader (`gate resume` will
 * compute "you were away N hours" by reading rest/wake pairs in
 * a follow-up integration), not enforced by the writer. This
 * keeps wake usable on its own when an agent forgot to rest, and
 * keeps rest usable on its own when the next session never wakes
 * (the run was abandoned).
 *
 * Like rest: not a lifecycle toggle, just a moment-stamp. The
 * length of the interval between rest and wake is itself
 * information — explicit pairs let downstream verbs render the
 * session with the boundary visible. Optional `--note` follows
 * the same tight-scope rules as rest's: ≤ 240 chars, sanitised,
 * empty/whitespace collapses to undefined.
 *
 * Suggests `gate boot` next: by definition, wake means the agent
 * just returned. Boot is the orientation lense for that moment —
 * what changed in the inbox / queues / cross-passage state since
 * the rest. (The opposite direction — rest suggests wake — lives
 * in `rest.ts`.)
 */
const WAKE_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'by',
  'note',
  'format',
]);

export async function wakeCmd(c: C, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, WAKE_KNOWN_FLAGS, 'wake');
  const by = requireOption(args, 'by', '<m>', 'GUILD_ACTOR');
  const note = optionalOption(args, 'note');
  const format = parseFormat(args);

  // #290: same before:/after: hook fire shape as `gate rest`. See
  // rest.ts for the rationale; the only difference here is the verb.
  let event;
  try {
    event = await c.sessionEventUC.record(
      {
        kind: 'wake',
        by,
        ...(note !== undefined ? { note } : {}),
      },
      {
        beforeSave: async (e) => {
          const veto = await fireBeforeSessionHook(
            c.hookSubscriptions, 'wake', e, by,
          );
          return { veto: veto ? { reason: veto.reason } : null };
        },
        afterSave: async (e) => {
          await fireAfterSessionHook(c.hookSubscriptions, 'wake', e, by);
        },
      },
    );
  } catch (e) {
    if (e instanceof SessionEventVetoed) {
      return emitHookVeto('wake', '(unsaved)', {
        allow: false,
        reason: e.reason,
      });
    }
    throw e;
  }

  const message = `✓ woke: ${event.id} by ${event.by.value}`;
  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          ...event.toJSON(),
          message,
          // Wake → boot: the agent just returned, so the natural
          // next move is to orient against whatever changed during
          // the break. Suggesting boot rather than a specific
          // lifecycle verb keeps the prescription advisory — the
          // agent reads the boot output and decides what to do.
          suggested_next: {
            verb: 'boot',
            args: {},
            reason:
              'You just woke — boot surfaces the inbox / queues / cross-passage signals that landed during your rest, so you can pick up with full context.',
          },
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
