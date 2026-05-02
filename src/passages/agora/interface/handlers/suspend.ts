import {
  PlayCannotSuspend,
  PlayNotFound,
  SuspensionEntry,
} from '../../domain/Play.js';
import { PlayRepository } from '../../application/PlayRepository.js';
import {
  ParsedArgs,
  optionalOption,
  requireOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';

const SUSPEND_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'cliff',
  'invitation',
  'by',
  'format',
]);

/**
 * agora suspend — pause a playing session with a cliff/invitation.
 *
 * Usage:
 *   agora suspend <play-id> --cliff "<what just happened>"
 *                           --invitation "<what the next move should do>"
 *                           [--by <m>] [--format json|text]
 *
 * State transition: playing → suspended.
 *
 * The cliff is what just happened (the unfinished thread); the
 * invitation is what the next opener should do. Both are required
 * because the substrate-side Zeigarnik effect (issue #117) requires
 * the suspension to be informative — an empty suspension entry
 * defeats the design.
 *
 * Append-only: every suspend creates a new entry in `suspensions[]`,
 * with the corresponding `resumes[]` entry filled later via
 * `agora resume`. Multi-suspend/resume cycles are preserved.
 */
export interface SuspendDeps {
  readonly plays: PlayRepository;
  readonly config: GuildConfig;
}

export async function suspendPlay(
  deps: SuspendDeps,
  args: ParsedArgs,
): Promise<number> {
  rejectUnknownFlags(args, SUSPEND_KNOWN_FLAGS, 'suspend');

  const playId = args.positional[0];
  if (!playId) {
    process.stderr.write(
      'error: positional <play-id> required.\n  Usage: agora suspend <play-id> --cliff "..." --invitation "..." [--by <m>]\n',
    );
    return 1;
  }
  const cliff = requireOption(args, 'cliff', '--cliff required (what just happened, prose)');
  const invitation = requireOption(
    args,
    'invitation',
    '--invitation required (what the next opener should do, prose)',
  );
  const by = optionalOption(args, 'by') ?? process.env['GUILD_ACTOR'];
  if (!by) {
    process.stderr.write(
      'error: --by required (or set GUILD_ACTOR). agora suspend attributes the suspension to an actor.\n',
    );
    return 1;
  }
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    process.stderr.write(`error: --format must be 'json' or 'text', got: ${format}\n`);
    return 1;
  }

  const play = await deps.plays.findById(playId);
  if (!play) {
    throw new PlayNotFound(playId);
  }
  if (play.state !== 'playing') {
    throw new PlayCannotSuspend(playId, play.state);
  }

  const entry: SuspensionEntry = {
    at: new Date().toISOString(),
    by,
    cliff,
    invitation,
  };

  await deps.plays.appendSuspension(play, play.suspensions.length, entry);

  const where_written = deps.plays.pathFor(play.game, play.id);
  const suspension_index = play.suspensions.length; // new entry's index

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          play_id: play.id,
          state: 'suspended',
          suspension_index,
          where_written,
          config_file: deps.config.configFile,
          suggested_next: {
            // args.by intentionally omitted (issue #122) — the next
            // resumer is often a different actor (and frequently a
            // different session of the same actor). agora doesn't
            // pre-fill the recommendation.
            verb: 'resume',
            args: { play_id: play.id },
            reason:
              'Play suspended. The cliff and invitation are recorded; the next instance reading this play sees the suspension and acts on the invitation. To pick up: agora resume <play-id>.',
          },
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(
      `✓ play suspended: ${play.id} [playing → suspended] by ${by}\n` +
        `  cliff:      ${cliff}\n` +
        `  invitation: ${invitation}\n` +
        `  next: agora resume ${play.id} --by <m>  (when re-entering)\n`,
    );
  }
  return 0;
}
