import {
  PlayAlreadyConcluded,
  PlayNotFound,
} from '../../domain/Play.js';
import { PlayRepository } from '../../application/PlayRepository.js';
import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';
import { resolvePlayForVerb } from './resolvePlay.js';

const CONCLUDE_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'note',
  'by',
  'format',
  'game',
]);

/**
 * agora conclude — terminal state transition for a play.
 *
 * Usage:
 *   agora conclude <play-id> [--note "<final note>"] [--by <m>] [--format json|text]
 *
 * State transition:
 *   playing  ─▶ concluded
 *   suspended ─▶ concluded   (a suspended play that's never picked
 *                             back up is a valid outcome — "the
 *                             conversation drifted away")
 *
 * concluded is **terminal** — no further moves / suspensions /
 * resumes accepted. Calling conclude on an already-concluded play
 * fails with PlayAlreadyConcluded.
 *
 * `--note` is optional prose: the closing reflection. The cliff/
 * invitation history of any prior suspensions stays in the record
 * (append-only) regardless of the conclude path.
 */
export interface ConcludeDeps {
  readonly plays: PlayRepository;
  readonly config: GuildConfig;
}

export async function concludePlay(
  deps: ConcludeDeps,
  args: ParsedArgs,
): Promise<number> {
  rejectUnknownFlags(args, CONCLUDE_KNOWN_FLAGS, 'conclude');

  const playId = args.positional[0];
  if (!playId) {
    process.stderr.write(
      'error: positional <play-id> required.\n  Usage: agora conclude <play-id> [--note "..."] [--by <m>]\n',
    );
    return 1;
  }
  const note = optionalOption(args, 'note');
  const by = optionalOption(args, 'by', 'GUILD_ACTOR');
  if (!by) {
    process.stderr.write(
      'error: --by required (or set GUILD_ACTOR). agora conclude attributes the conclusion to an actor.\n',
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
  if (play.state === 'concluded') {
    throw new PlayAlreadyConcluded(playId);
  }
  // play.state is now narrowed to 'playing' | 'suspended' — both
  // valid sources for the concluded transition.
  const expectedState = play.state;
  const concluded_at = new Date().toISOString();

  await deps.plays.saveConclusion(play, expectedState, concluded_at, by, note);

  const where_written = deps.plays.pathFor(play.game, play.id);

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          play_id: play.id,
          state: 'concluded',
          from_state: expectedState,
          concluded_at,
          concluded_by: by,
          ...(note !== undefined ? { concluded_note: note } : {}),
          where_written,
          config_file: deps.config.configFile,
          // No suggested_next: concluded is terminal. Agents
          // should branch to other plays / games / verbs.
          suggested_next: null,
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(
      `✓ play concluded: ${play.id} [${expectedState} → concluded] by ${by}\n`,
    );
    if (note) {
      process.stdout.write(`  note: ${note}\n`);
    }
    process.stdout.write(
      `  this play is now terminal — no further moves, suspensions, or resumes.\n`,
    );
  }
  return 0;
}
