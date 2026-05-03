import { Play, GameNotFoundForPlay } from '../../domain/Play.js';
import { GameRepository } from '../../application/GameRepository.js';
import { PlayRepository } from '../../application/PlayRepository.js';
import {
  ParsedArgs,
  optionalOption,
  requireOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';

const PLAY_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'slug',
  'by',
  'format',
]);

/**
 * agora play — start a new play session against an existing Game.
 *
 * Usage:
 *   agora play --slug <game-slug> [--by <m>] [--format json|text]
 *
 * Produces: <content_root>/agora/plays/<game-slug>/<play-id>.yaml
 *
 * Allocates a fresh play id (YYYY-MM-DD-NNN) per the runtime clock
 * and sequences within the game's plays/<slug>/ directory. Initial
 * state is `playing`, with empty moves[]; subsequent verbs (move,
 * suspend, resume, conclude — landing in later commits) drive the
 * state machine forward.
 *
 * Fails closed if the game slug doesn't exist (`GameNotFoundForPlay`):
 * agora doesn't auto-create a game definition from a play start, the
 * design must come first.
 */
export interface PlayDeps {
  readonly games: GameRepository;
  readonly plays: PlayRepository;
  readonly config: GuildConfig;
}

export async function startPlay(deps: PlayDeps, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, PLAY_KNOWN_FLAGS, 'play');

  const slug = requireOption(args, 'slug', '--slug required (game to play)');
  const by = optionalOption(args, 'by', 'GUILD_ACTOR');
  if (!by) {
    process.stderr.write(
      'error: --by required (or set GUILD_ACTOR). agora play attributes the start to an actor.\n',
    );
    return 1;
  }
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    process.stderr.write(`error: --format must be 'json' or 'text', got: ${format}\n`);
    return 1;
  }

  const game = await deps.games.findBySlug(slug);
  if (!game) {
    throw new GameNotFoundForPlay(slug);
  }

  // Allocate sequence: YYYY-MM-DD + 3-digit counter within this
  // game's day. The runtime clock is the single source — same
  // pattern gate's request id allocator uses.
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const seq = await deps.plays.nextSequence(game.slug, today);
  const playId = `${today}-${String(seq).padStart(3, '0')}`;

  const play = Play.start({
    id: playId,
    game: game.slug,
    started_by: by,
  });

  const where_written = deps.plays.pathFor(game.slug, play.id);
  await deps.plays.saveNew(play);

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          play_id: play.id,
          game: play.game,
          state: play.state,
          where_written,
          config_file: deps.config.configFile,
          suggested_next: {
            // args.by intentionally omitted (issue #122) — agora doesn't
            // recommend who acts next; the orchestrator (or human + AI
            // pair) decides per their alternation model. Sandbox plays
            // shouldn't be biased toward same-actor continuation.
            verb: 'move',
            args: { play_id: play.id },
            reason:
              'Play started. Append a move to advance, leave a cliff with `agora suspend`, or close with `agora conclude`.',
          },
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(
      `✓ play started: ${play.id} [${play.state}] on game=${play.game}\n` +
        `  next: agora move ${play.id} --by ${by} "<text>"\n` +
        `        or agora suspend ${play.id} --cliff "..." --invitation "..."  (leave a cliff)\n`,
    );
  }
  const configSegment =
    deps.config.configFile === null
      ? 'config: none — cwd used as fallback root'
      : `config: ${deps.config.configFile}`;
  process.stderr.write(`notice: wrote ${where_written} (${configSegment})\n`);
  return 0;
}
