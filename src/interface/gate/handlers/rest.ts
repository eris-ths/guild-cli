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

  // #290: fire before:rest / after:rest hooks around the record path.
  // The `before` veto sees the unsaved SessionEvent (so a policy can
  // inspect note / actor before persistence); a veto blocks the save.
  // The `after` fires post-save so an audit hook sees the final id.
  let event;
  try {
    event = await c.sessionEventUC.record(
      {
        kind: 'rest',
        by,
        ...(note !== undefined ? { note } : {}),
      },
      {
        beforeSave: async (e) => {
          const veto = await fireBeforeSessionHook(
            c.hookSubscriptions, 'rest', e, by,
          );
          return { veto: veto ? { reason: veto.reason } : null };
        },
        afterSave: async (e) => {
          await fireAfterSessionHook(c.hookSubscriptions, 'rest', e, by);
        },
      },
    );
  } catch (e) {
    if (e instanceof SessionEventVetoed) {
      // No id is allocated to a vetoed record — render `(unsaved)` so
      // the operator's grep for "hook vetoed rest" still matches the
      // standard surface from `emitHookVeto`.
      return emitHookVeto('rest', '(unsaved)', {
        allow: false,
        reason: e.reason,
      });
    }
    throw e;
  }

  const message = `✓ rested: ${event.id} by ${event.by.value}`;
  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          ...event.toJSON(),
          message,
          // Rest → wake: the natural pair. The agent stamps a
          // boundary now, picks the work back up later with
          // `gate wake`. Both verbs are independent (wake doesn't
          // require a prior rest, rest doesn't require a follow-
          // up wake); the suggestion is advisory, not enforced.
          suggested_next: {
            verb: 'wake',
            args: { by: event.by.value },
            reason:
              'When you return, `gate wake` stamps the matching boundary so the gap between rest and wake is recoverable from the record. Skip if the run is abandoned — wake is optional.',
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
