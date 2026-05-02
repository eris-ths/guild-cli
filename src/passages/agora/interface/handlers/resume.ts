import {
  PlayCannotResume,
  PlayNotFound,
  ResumeEntry,
} from '../../domain/Play.js';
import { PlayRepository } from '../../application/PlayRepository.js';
import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';

const RESUME_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'note',
  'by',
  'format',
]);

/**
 * agora resume — pick up a suspended play.
 *
 * Usage:
 *   agora resume <play-id> [--note "<resume note>"] [--by <m>] [--format json|text]
 *
 * State transition: suspended → playing.
 *
 * `--note` is optional prose describing the resume action ("noir
 * resumed and addressed the contradiction"). The cliff/invitation
 * from the suspension stay in the record (append-only history) so
 * the audit trail of "what was the cliff, what addressed it" is
 * intact.
 *
 * The handler surfaces the most recent suspension's cliff/invitation
 * in the success output so the agent re-entering reads what was
 * paused on without separately invoking show — Zeigarnik substrate
 * (issue #117) at work.
 */
export interface ResumeDeps {
  readonly plays: PlayRepository;
  readonly config: GuildConfig;
}

export async function resumePlay(deps: ResumeDeps, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, RESUME_KNOWN_FLAGS, 'resume');

  const playId = args.positional[0];
  if (!playId) {
    process.stderr.write(
      'error: positional <play-id> required.\n  Usage: agora resume <play-id> [--note "..."] [--by <m>]\n',
    );
    return 1;
  }
  const note = optionalOption(args, 'note');
  const by = optionalOption(args, 'by') ?? process.env['GUILD_ACTOR'];
  if (!by) {
    process.stderr.write(
      'error: --by required (or set GUILD_ACTOR). agora resume attributes the resume to an actor.\n',
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
  if (play.state !== 'suspended') {
    throw new PlayCannotResume(playId, play.state);
  }

  // The suspension being resumed is the most recent (and only
  // un-resumed) one. Per the invariant: when state=suspended,
  // suspensions.length === resumes.length + 1; the entry being
  // closed is suspensions[resumes.length].
  const closing = play.suspensions[play.resumes.length];

  const entry: ResumeEntry = {
    at: new Date().toISOString(),
    by,
    ...(note !== undefined ? { note } : {}),
  };

  await deps.plays.appendResume(play, play.resumes.length, entry);

  const where_written = deps.plays.pathFor(play.game, play.id);

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          play_id: play.id,
          state: 'playing',
          resumed_suspension: closing
            ? {
                at: closing.at,
                by: closing.by,
                cliff: closing.cliff,
                invitation: closing.invitation,
              }
            : null,
          where_written,
          config_file: deps.config.configFile,
          suggested_next: {
            verb: 'move',
            args: { play_id: play.id, by },
            reason:
              'Play resumed. The cliff/invitation that paused you is in `resumed_suspension`; address it with the next move (or suspend again if the answer surfaces another cliff).',
          },
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(
      `✓ play resumed: ${play.id} [suspended → playing] by ${by}\n`,
    );
    if (closing) {
      process.stdout.write(
        `  closing cliff:      ${closing.cliff}\n` +
          `  closing invitation: ${closing.invitation}\n`,
      );
    }
    process.stdout.write(
      `  next: agora move ${play.id} --by ${by} "<text addressing the invitation>"\n`,
    );
  }
  return 0;
}
