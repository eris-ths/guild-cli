import { Game, GameSlugCollision } from '../../domain/Game.js';
import { GameRepository } from '../../application/GameRepository.js';
import { ParsedArgs, optionalOption, requireOption, rejectUnknownFlags } from '../../../../interface/shared/parseArgs.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';

const NEW_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'slug',
  'kind',
  'title',
  'description',
  'by',
  'format',
]);

/**
 * agora new — create a new Game definition.
 *
 * Usage:
 *   agora new --slug <s> --kind <quest|sandbox> --title "<t>" [--by <m>] [--description "<d>"] [--format json|text]
 *
 * Produces: <content_root>/agora/games/<slug>.yaml
 *
 * AI-first (principle 11):
 *   - JSON output is the agent contract: {ok, slug, kind, where_written, config_file, suggested_next}
 *   - text output exists for humans-using-the-CLI-directly, with the same `notice:` stderr
 *     line shape as gate register (principle 09 orientation disclosure)
 *   - --by defaults from GUILD_ACTOR; agora is created by the same actor model as gate
 */
export interface NewGameDeps {
  readonly repo: GameRepository;
  readonly config: GuildConfig;
}

export async function newGame(deps: NewGameDeps, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, NEW_KNOWN_FLAGS, 'new');

  const slug = requireOption(args, 'slug', '--slug required');
  const kind = requireOption(args, 'kind', '--kind required (quest|sandbox)');
  const title = requireOption(args, 'title', '--title required');
  const description = optionalOption(args, 'description');
  const by = optionalOption(args, 'by') ?? process.env['GUILD_ACTOR'];
  if (!by) {
    process.stderr.write(
      'error: --by required (or set GUILD_ACTOR). agora new attributes the creation to an actor.\n',
    );
    return 1;
  }
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    process.stderr.write(`error: --format must be 'json' or 'text', got: ${format}\n`);
    return 1;
  }

  let game: Game;
  try {
    game = Game.create({
      slug,
      kind,
      title,
      created_by: by,
      ...(description !== undefined ? { description } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`error: ${msg}\n`);
    return 1;
  }

  // Resolve the would-write path BEFORE saving so we can surface it
  // in the same shape regardless of save outcome (and so the dry-run
  // path, when it lands later, can use the same projection).
  const where_written = deps.repo.pathFor(game.slug);

  try {
    await deps.repo.saveNew(game);
  } catch (e) {
    if (e instanceof GameSlugCollision) {
      process.stderr.write(
        `error: Game slug "${game.slug}" already exists.\n` +
          `  At: ${where_written}\n` +
          `  Pick a different --slug, or edit the existing file directly.\n`,
      );
      return 1;
    }
    throw e;
  }

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          slug: game.slug,
          kind: game.kind,
          where_written,
          config_file: deps.config.configFile,
          suggested_next: {
            verb: 'list',
            args: {},
            reason:
              'New game definition saved. `agora list` shows every game and play in the content root; `agora play --slug <slug>` starts a session against this definition.',
          },
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(
      `✓ created game: ${game.slug} [${game.kind}] — ${game.title}\n` +
        `  next: agora list  (or agora play --slug ${game.slug} to start a session)\n`,
    );
  }
  // Stderr notice mirrors gate register's path-disclosure line shape
  // (principle 09): one canonical line surface across all create-style
  // verbs in any passage.
  const configSegment =
    deps.config.configFile === null
      ? 'config: none — cwd used as fallback root'
      : `config: ${deps.config.configFile}`;
  process.stderr.write(`notice: wrote ${where_written} (${configSegment})\n`);
  return 0;
}
