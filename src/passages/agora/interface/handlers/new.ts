import { Game, GameSlugCollision } from '../../domain/Game.js';
import { GameRepository } from '../../application/GameRepository.js';
import { ParsedArgs, optionalOption, requireOption, rejectUnknownFlags } from '../../../../interface/shared/parseArgs.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';
import { sanitizeError } from '../../../../interface/shared/sanitizeError.js';
import { emitErrorEnvelope } from '../../../../interface/shared/errorEnvelope.js';

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

  const slug = requireOption(args, 'slug', '<slug>');
  // `--kind` and `--title` defaulted post-dogfood (#173 reviewer
  // observation): four required flags at the entry verb fight agora's
  // "exploration" character — a fresh agent with "ちょっと遊んでみるか"
  // tension hits friction at the door. Defaults pick the playful
  // shape (sandbox over quest) and reuse the slug as title so
  // `agora new --slug today` is a one-flag entry. Full-spec form
  // still works for callers who want to be explicit.
  const kind = optionalOption(args, 'kind') ?? 'sandbox';
  const title = optionalOption(args, 'title') ?? slug;
  const description = optionalOption(args, 'description');
  const by = requireOption(args, 'by', '<m>', 'GUILD_ACTOR');
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
    // Game.create throws DomainError with field='slug'|'kind'|'title'.
    // emitErrorEnvelope preserves field/code derivation; in JSON mode
    // consumers get a structured envelope instead of plain text (#205).
    emitErrorEnvelope(e, format, deps.config.contentRoot);
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
      // GameSlugCollision now extends DomainError (#205): emitErrorEnvelope
      // surfaces field='slug', code='already_in_state'. The hint lines
      // (At: <path> + remediation) are text-only by design — JSON
      // consumers get the structured envelope and don't need prose
      // hints. sanitizeError on the path keeps #153's contract.
      emitErrorEnvelope(e, format, deps.config.contentRoot);
      if (format !== 'json') {
        const at = sanitizeError(where_written, deps.config.contentRoot);
        process.stderr.write(
          `  At: ${at}\n` +
            `  Pick a different --slug, or edit the existing file directly.\n`,
        );
      }
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
            verb: 'play',
            args: { slug: game.slug },
            reason:
              'New game definition saved. `agora play --slug ' +
              `${game.slug}\` starts a session against this ` +
              'definition; `agora list` shows every game and play if ' +
              'you want to confirm before playing.',
          },
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(
      `✓ created game: ${game.slug} [${game.kind}] — ${game.title}\n` +
        `  next: agora play --slug ${game.slug}  (or agora list to see all games)\n`,
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
