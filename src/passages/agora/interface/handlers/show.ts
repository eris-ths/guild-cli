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

const SHOW_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'game',
  'format',
]);

/**
 * agora show — detail view of one game or one play.
 *
 * Usage:
 *   agora show <slug-or-play-id> [--game <slug>] [--format json|text]
 *
 * Argument disambiguation:
 *   - argument matches play-id pattern (YYYY-MM-DD-NNN) → resolve as play
 *   - otherwise → resolve as game slug
 *
 * Patterns don't overlap (game slugs can't start with a digit, play
 * ids must), so the discrimination is unambiguous in isolation.
 *
 * Cross-game id collision (each game has its own sequence) is
 * disambiguated via `--game <slug>`. Without `--game`, if multiple
 * games have a play with the same id, the handler errors with a
 * candidate list and tells the user how to pick.
 *
 * AI-natural per principle 11: text rendering surfaces the full
 * suspension/resume history (cliff/invitation prose preserved); JSON
 * envelope is the agent contract.
 */
export interface ShowDeps {
  readonly games: GameRepository;
  readonly plays: PlayRepository;
  readonly config: GuildConfig;
}

const PLAY_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-\d{3,4}$/;

export async function showAgora(deps: ShowDeps, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, SHOW_KNOWN_FLAGS, 'show');

  const arg = args.positional[0];
  if (!arg) {
    process.stderr.write(
      'error: positional <slug-or-play-id> required.\n  Usage: agora show <slug-or-play-id> [--game <slug>] [--format json|text]\n',
    );
    return 1;
  }
  const gameFilter = optionalOption(args, 'game');
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    process.stderr.write(`error: --format must be 'json' or 'text', got: ${format}\n`);
    return 1;
  }

  if (PLAY_ID_PATTERN.test(arg)) {
    return await showPlay(deps, arg, gameFilter, format);
  }
  // Else: treat as game slug
  if (gameFilter !== undefined) {
    process.stderr.write(
      `error: --game is for disambiguating play ids; "${arg}" looks like a game slug already (use just \`agora show ${arg}\`).\n`,
    );
    return 1;
  }
  return await showGame(deps, arg, format);
}

async function showGame(
  deps: ShowDeps,
  slug: string,
  format: string,
): Promise<number> {
  const game = await deps.games.findBySlug(slug);
  if (!game) {
    process.stderr.write(
      `error: game "${slug}" not found.\n  List available games: agora list\n  Or create one: agora new --slug ${slug} --kind <quest|sandbox> --title "..."\n`,
    );
    return 1;
  }
  if (format === 'json') {
    process.stdout.write(JSON.stringify(game.toJSON(), null, 2) + '\n');
    return 0;
  }
  // text rendering — game definition
  process.stdout.write(`game: ${game.slug}  [${game.kind}]\n`);
  process.stdout.write(`  title:      ${game.title}\n`);
  if (game.description) {
    process.stdout.write(`  description: ${game.description}\n`);
  }
  process.stdout.write(`  created_at: ${game.created_at}\n`);
  process.stdout.write(`  created_by: ${game.created_by}\n`);
  return 0;
}

async function showPlay(
  deps: ShowDeps,
  playId: string,
  gameFilter: string | undefined,
  format: string,
): Promise<number> {
  let play: Play | null = null;
  if (gameFilter) {
    // Targeted lookup — explicit game means findById can resolve
    // unambiguously by walking only that game's directory. We use
    // findAllById and filter, since findById's first-match across
    // games could pick the wrong one.
    const matches = await deps.plays.findAllById(playId);
    play = matches.find((p) => p.game === gameFilter) ?? null;
  } else {
    const matches = await deps.plays.findAllById(playId);
    if (matches.length > 1) {
      const games = matches.map((p) => p.game).join(', ');
      process.stderr.write(
        `error: multiple games have a play with id "${playId}" (each game has its own sequence). ` +
          `Disambiguate with --game <slug>. Candidates: ${games}\n`,
      );
      return 1;
    }
    play = matches[0] ?? null;
  }
  if (!play) {
    process.stderr.write(`error: play "${playId}" not found.\n`);
    return 1;
  }
  if (format === 'json') {
    process.stdout.write(JSON.stringify(play.toJSON(), null, 2) + '\n');
    return 0;
  }
  // text rendering — play with full history
  const stateTag =
    play.state === 'suspended'
      ? '[suspended ↺]'
      : play.state === 'concluded'
        ? '[concluded ✓]'
        : '[playing]';
  process.stdout.write(`play: ${play.id}  ${stateTag}\n`);
  process.stdout.write(`  game:       ${play.game}\n`);
  process.stdout.write(`  started_at: ${play.started_at}\n`);
  process.stdout.write(`  started_by: ${play.started_by}\n`);
  if (play.moves.length > 0) {
    process.stdout.write(`\n  moves (${play.moves.length}):\n`);
    for (const m of play.moves) {
      process.stdout.write(`    [${m.id}] ${m.at} by ${m.by}\n`);
      for (const line of m.text.split('\n')) {
        process.stdout.write(`        ${line}\n`);
      }
    }
  }
  // Render suspension/resume history paired by index. Per the
  // state-derivation invariant, suspensions[i] is closed by
  // resumes[i] when present; the last suspension may be open.
  if (play.suspensions.length > 0) {
    process.stdout.write(`\n  suspensions (${play.suspensions.length}):\n`);
    for (let i = 0; i < play.suspensions.length; i++) {
      const s = play.suspensions[i]!;
      const r = play.resumes[i];
      process.stdout.write(`    [${i + 1}] ${s.at} by ${s.by}\n`);
      process.stdout.write(`        cliff:      ${s.cliff}\n`);
      process.stdout.write(`        invitation: ${s.invitation}\n`);
      if (r) {
        process.stdout.write(`        ↺ resumed at ${r.at} by ${r.by}\n`);
        if (r.note) process.stdout.write(`            note: ${r.note}\n`);
      } else {
        process.stdout.write(`        (still open — agora resume ${play.id})\n`);
      }
    }
  }
  return 0;
}
