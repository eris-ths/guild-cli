import { Game } from '../../domain/Game.js';
import { Play } from '../../domain/Play.js';
import { GameRepository } from '../../application/GameRepository.js';
import { PlayRepository } from '../../application/PlayRepository.js';
import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';

const LIST_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'game',
  'state',
  'format',
]);

/**
 * agora list — enumerate games and plays.
 *
 * Usage:
 *   agora list [--game <slug>] [--state playing|suspended|concluded] [--format json|text]
 *
 * Default: lists every game and every play in the content root.
 * Filters narrow the scope:
 *   --game <slug>  : only plays for the given game (games list dropped)
 *   --state <s>    : only plays in the given state
 *
 * Read-only verb. Output shape per principle 11: JSON envelope is
 * the agent contract; text is the projection.
 */
export interface ListDeps {
  readonly games: GameRepository;
  readonly plays: PlayRepository;
  readonly config: GuildConfig;
}

export async function listAgora(deps: ListDeps, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, LIST_KNOWN_FLAGS, 'list');

  const gameFilter = optionalOption(args, 'game');
  const stateFilter = optionalOption(args, 'state');
  if (
    stateFilter !== undefined &&
    stateFilter !== 'playing' &&
    stateFilter !== 'suspended' &&
    stateFilter !== 'concluded'
  ) {
    process.stderr.write(
      `error: --state must be one of playing|suspended|concluded, got: ${stateFilter}\n`,
    );
    return 1;
  }
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    process.stderr.write(`error: --format must be 'json' or 'text', got: ${format}\n`);
    return 1;
  }

  // Games: omitted when --game is set (narrowed to a single game's
  // plays; the games list would be one row, not useful).
  const games: Game[] = gameFilter ? [] : await deps.games.listAll();

  let plays: Play[] = await deps.plays.listAll(
    gameFilter ? { gameSlug: gameFilter } : {},
  );
  if (stateFilter) {
    plays = plays.filter((p) => p.state === stateFilter);
  }

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          games: games.map((g) => ({
            slug: g.slug,
            kind: g.kind,
            title: g.title,
            created_at: g.created_at,
            created_by: g.created_by,
          })),
          plays: plays.map((p) => ({
            id: p.id,
            game: p.game,
            state: p.state,
            started_at: p.started_at,
            started_by: p.started_by,
            move_count: p.moves.length,
            suspension_count: p.suspensions.length,
            resume_count: p.resumes.length,
          })),
        },
        null,
        2,
      ) + '\n',
    );
    return 0;
  }

  // text rendering
  if (gameFilter) {
    process.stdout.write(`plays for game=${gameFilter}`);
    if (stateFilter) process.stdout.write(` state=${stateFilter}`);
    process.stdout.write(` (${plays.length}):\n`);
  } else {
    process.stdout.write(`games (${games.length}):\n`);
    if (games.length === 0) {
      process.stdout.write('  (none — create with `agora new`)\n');
    } else {
      for (const g of games) {
        process.stdout.write(
          `  ${g.slug.padEnd(24)} [${g.kind}]  — ${g.title}\n`,
        );
      }
    }
    process.stdout.write(`\nplays`);
    if (stateFilter) process.stdout.write(` state=${stateFilter}`);
    process.stdout.write(` (${plays.length}):\n`);
  }
  if (plays.length === 0) {
    process.stdout.write('  (none — start one with `agora play --slug <game-slug>`)\n');
  } else {
    for (const p of plays) {
      const moves = p.moves.length;
      const tag =
        p.state === 'suspended'
          ? `[${p.state} ↺]`
          : p.state === 'concluded'
            ? `[${p.state} ✓]`
            : `[${p.state}]`;
      process.stdout.write(
        `  ${p.id}  ${tag.padEnd(15)} game=${p.game.padEnd(20)} moves=${moves} by ${p.started_by}\n`,
      );
    }
  }
  return 0;
}
