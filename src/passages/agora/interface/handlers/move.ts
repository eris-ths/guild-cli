import {
  PlayMove,
  PlayNotFound,
  PlayNotPlayable,
} from '../../domain/Play.js';
import { PlayRepository } from '../../application/PlayRepository.js';
import {
  ParsedArgs,
  optionalOption,
  requireOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';
import { resolvePlayForVerb } from './resolvePlay.js';

const MOVE_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'by',
  'text',
  'format',
  'game',
]);

/**
 * agora move — append a move to a `playing` play.
 *
 * Usage:
 *   agora move <play-id> [--by <m>] --text "<move text>" [--format json|text]
 *
 * State-machine boundary: only `playing` plays accept moves.
 * Suspended plays must be resumed first; concluded plays are
 * terminal (PlayNotPlayable).
 *
 * AI-natural per principle 11: optimistic CAS on moves.length so
 * concurrent appenders detect each other (PlayVersionConflict).
 * No silent overwrite.
 */
export interface MoveDeps {
  readonly plays: PlayRepository;
  readonly config: GuildConfig;
}

export async function moveOnPlay(deps: MoveDeps, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, MOVE_KNOWN_FLAGS, 'move');

  const playId = args.positional[0];
  if (!playId) {
    process.stderr.write(
      'error: positional <play-id> required.\n  Usage: agora move <play-id> --text "<move text>" [--by <m>]\n',
    );
    return 1;
  }
  const text = requireOption(args, 'text', '--text required');
  const by = optionalOption(args, 'by', 'GUILD_ACTOR');
  if (!by) {
    process.stderr.write(
      'error: --by required (or set GUILD_ACTOR). agora move attributes the move to an actor.\n',
    );
    return 1;
  }
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    process.stderr.write(`error: --format must be 'json' or 'text', got: ${format}\n`);
    return 1;
  }

  const gameFilter = optionalOption(args, 'game');
  const resolved = await resolvePlayForVerb(deps.plays, playId, gameFilter);
  if (resolved === 'ambiguous') return 1;
  const play = resolved;
  if (!play) {
    throw new PlayNotFound(playId);
  }
  if (play.state !== 'playing') {
    throw new PlayNotPlayable(playId, play.state);
  }

  // Move id: 3-digit sequence within the play's moves[]. The next
  // move is moves.length + 1, so the first move is "001".
  const moveId = String(play.moves.length + 1).padStart(3, '0');
  const move: PlayMove = {
    id: moveId,
    at: new Date().toISOString(),
    by,
    text,
  };

  await deps.plays.appendMove(play, play.moves.length, move);

  const where_written = deps.plays.pathFor(play.game, play.id);

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          play_id: play.id,
          move_id: move.id,
          state: play.state,
          where_written,
          config_file: deps.config.configFile,
          suggested_next: {
            // args.by intentionally omitted (issue #122) — see play.ts
            // for the rationale. Multi-actor Sandbox plays alternate;
            // agora doesn't bias toward same-actor continuation.
            verb: 'move',
            args: { play_id: play.id },
            reason:
              'Move appended. Continue with another `agora move`, leave a cliff with `agora suspend`, or close the session with `agora conclude`.',
          },
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(
      `✓ move ${move.id} appended to ${play.id} on game=${play.game} by ${by}\n` +
        `  next: agora move ${play.id} --by ${by} "<text>"  (continue)\n` +
        `        or agora suspend ${play.id} --cliff "..." --invitation "..."  (leave a cliff)\n`,
    );
  }
  return 0;
}
