import { Play } from '../../domain/Play.js';
import { PlayRepository } from '../../application/PlayRepository.js';
import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { resolveGuildActor } from '../../../../interface/shared/resolveGuildActor.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';

const LAST_KNOWN_FLAGS: ReadonlySet<string> = new Set([
  'by',
  'state',
  'include-concluded',
  'format',
]);

/**
 * agora last — return the actor's most recent play.
 *
 * Usage:
 *   agora last [--by <m>] [--state playing|suspended|concluded]
 *              [--include-concluded] [--format json|text]
 *
 * Answers the daily-use question "which play am I in?" without
 * making the actor `agora list` and copy a play-id. Defaults:
 *   - actor:  --by, else GUILD_ACTOR
 *   - state:  any of playing|suspended (concluded plays excluded
 *             unless --include-concluded or --state concluded)
 *   - sort:   most recently started_at first
 *
 * The "most recent open play" framing matches the touch-feel use
 * case: an actor returning to work asks "what was I in?" — and
 * concluded plays are by definition closed work, not the answer.
 * --include-concluded surfaces them when the question is "what
 * have I ever done?" instead.
 *
 * Output shape per principle 11: JSON envelope is the agent
 * contract; text is the projection. Empty result is exit 0 with
 * an empty payload (json: `{ ok: true, play: null }`) — orchestrators
 * branch on `play === null`, no error noise required.
 */
export interface LastDeps {
  readonly plays: PlayRepository;
  readonly config: GuildConfig;
}

export async function lastPlay(deps: LastDeps, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, LAST_KNOWN_FLAGS, 'last');

  const by = optionalOption(args, 'by') ?? resolveGuildActor();
  if (!by) {
    process.stderr.write(
      'error: --by required (or set GUILD_ACTOR). agora last is per-actor — it asks "which play am I in?"\n',
    );
    return 1;
  }

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

  const includeConcluded = args.options['include-concluded'] === true;
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    process.stderr.write(`error: --format must be 'json' or 'text', got: ${format}\n`);
    return 1;
  }

  let plays: Play[] = await deps.plays.listAll();
  // started_by is the canonical "whose play is this" field.
  // Future: when an actor's contribution is move-only (didn't start
  // it), a follow-up could expand the filter to "any actor who has
  // moved here". For v1 of this verb, started_by keeps the question
  // crisp.
  plays = plays.filter((p) => p.started_by === by);

  if (stateFilter) {
    plays = plays.filter((p) => p.state === stateFilter);
  } else if (!includeConcluded) {
    plays = plays.filter((p) => p.state !== 'concluded');
  }

  // Most recently started first. Lexicographic sort works because
  // started_at is ISO-8601 with consistent precision.
  plays.sort((a, b) => b.started_at.localeCompare(a.started_at));

  const last = plays[0];

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          play: last
            ? {
                id: last.id,
                game: last.game,
                state: last.state,
                started_at: last.started_at,
                started_by: last.started_by,
                move_count: last.moves.length,
                suspension_count: last.suspensions.length,
                resume_count: last.resumes.length,
                // Surface the closing cliff/invitation when the
                // play is currently suspended — the resume-time
                // peek without committing to resume.
                ...(last.state === 'suspended' && last.suspensions.length > 0
                  ? {
                      closing_cliff:
                        last.suspensions[last.suspensions.length - 1]!.cliff,
                      closing_invitation:
                        last.suspensions[last.suspensions.length - 1]!.invitation,
                    }
                  : {}),
              }
            : null,
        },
        null,
        2,
      ) + '\n',
    );
    return 0;
  }

  // text rendering
  if (!last) {
    const scope = stateFilter
      ? `state=${stateFilter}`
      : includeConcluded
        ? 'any state'
        : 'open (playing|suspended)';
    process.stdout.write(
      `(no ${scope} plays for ${by} — start one with 'agora play --slug <game-slug>')\n`,
    );
    return 0;
  }
  const tag =
    last.state === 'suspended'
      ? `[${last.state} ↺]`
      : last.state === 'concluded'
        ? `[${last.state} ✓]`
        : `[${last.state}]`;
  process.stdout.write(
    `${last.id}  ${tag.padEnd(15)} game=${last.game}  moves=${last.moves.length}  ` +
      `(started ${last.started_at} by ${last.started_by})\n`,
  );
  if (last.state === 'suspended' && last.suspensions.length > 0) {
    const closing = last.suspensions[last.suspensions.length - 1]!;
    process.stdout.write(
      `  closing cliff:      ${closing.cliff}\n` +
        `  closing invitation: ${closing.invitation}\n`,
    );
  }
  // Next-hint: include `--game <slug>` so the id is usable as-is. Play
  // ids are per-game sequences, so a bare id collides across games and
  // every downstream verb (move/suspend/cliff/resume) errors with a
  // "Disambiguate with --game" message. last is an orientation verb
  // — its job isn't done until the next call works.
  //
  // `concluded` is intentionally absent: terminal state, no further
  // moves/suspensions/resumes are valid (mirrors conclude.ts which
  // sets `suggested_next: null`). Surfacing a hint here would invite
  // a call that always errors.
  if (last.state === 'playing') {
    process.stdout.write(
      `  next: agora move ${last.id} --game ${last.game} --text "..."\n` +
        `        or agora suspend ${last.id} --game ${last.game} --cliff "..." --invitation "..."\n`,
    );
  } else if (last.state === 'suspended') {
    process.stdout.write(
      `  next: agora resume ${last.id} --game ${last.game}\n` +
        `        or agora cliff ${last.id} --game ${last.game}  (peek without resuming)\n`,
    );
  }
  return 0;
}
