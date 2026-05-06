import { PlayRepository } from '../../application/PlayRepository.js';
import {
  ParsedArgs,
  optionalOption,
  rejectUnknownFlags,
} from '../../../../interface/shared/parseArgs.js';
import { GuildConfig } from '../../../../infrastructure/config/GuildConfig.js';
import { resolvePlayForVerb } from './resolvePlay.js';
import { parsePlayId } from '../../domain/Play.js';
import { DomainError } from '../../../../domain/shared/DomainError.js';

const CLIFF_KNOWN_FLAGS: ReadonlySet<string> = new Set(['game', 'format']);

/**
 * agora cliff <play-id> — peek the closing cliff/invitation
 * without transitioning state.
 *
 * Usage:
 *   agora cliff <play-id> [--game <slug>] [--format json|text]
 *
 * Answers the daily-use question "what was I about to do here?"
 * without committing to `agora resume` (which transitions
 * suspended → playing). Useful when:
 *   - the actor is deciding whether this play is the right one
 *     to re-enter
 *   - a different actor wants to read the substrate-side context
 *     before opening the play themselves
 *   - the play has already been resumed and the actor wants to
 *     re-read the most recent historical cliff
 *
 * Cross-state behaviour:
 *   - suspended: the closing cliff is "active" (the next resume
 *     will close this very pair). Marked accordingly.
 *   - playing with prior suspensions: the most recent cliff has
 *     already been resumed; output names the resume time so the
 *     reader doesn't mistake it for an active cliff.
 *   - playing with no suspensions: returns nothing meaningful;
 *     exit 1 with a helpful message ("never suspended").
 *   - concluded with prior suspensions: the cliff is historical;
 *     marked as part of a closed thread.
 *
 * Read-only verb. Output shape per principle 11.
 */
export interface CliffDeps {
  readonly plays: PlayRepository;
  readonly config: GuildConfig;
}

export async function cliffOf(deps: CliffDeps, args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, CLIFF_KNOWN_FLAGS, 'cliff');

  const positional = args.positional[0];
  if (!positional) {
    process.stderr.write(
      `error: agora cliff requires a play-id positional. e.g. agora cliff 2026-05-05-001\n`,
    );
    return 1;
  }
  // parsePlayId throws DomainError on bad shape — caller's main()
  // catch sanitizes & exits 1. Same contract as agora show.
  const playId = parsePlayId(positional);

  const gameFilter = optionalOption(args, 'game');
  const format = optionalOption(args, 'format') ?? 'text';
  if (format !== 'json' && format !== 'text') {
    process.stderr.write(`error: --format must be 'json' or 'text', got: ${format}\n`);
    return 1;
  }

  // resolvePlayForVerb throws PlayIdAmbiguous on cross-game collision
  // (#205); the entry-point's outer catch surfaces it through
  // emitErrorEnvelope. Only the not-found path is local-handled here.
  const play = await resolvePlayForVerb(deps.plays, playId, gameFilter);
  if (play === null) {
    throw new DomainError(
      `play ${playId} not found${gameFilter ? ` in game=${gameFilter}` : ''}.`,
      'play_id',
    );
  }

  const lastSuspension = play.suspensions[play.suspensions.length - 1];

  if (!lastSuspension) {
    // No suspension has ever happened on this play — nothing to peek.
    if (format === 'json') {
      process.stdout.write(
        JSON.stringify(
          {
            ok: true,
            play_id: play.id,
            game: play.game,
            state: play.state,
            cliff: null,
            invitation: null,
            note: 'play has never been suspended; no cliff to peek',
          },
          null,
          2,
        ) + '\n',
      );
      return 0;
    }
    process.stdout.write(
      `play ${play.id}  [${play.state}]  game=${play.game}\n` +
        `  (never suspended — no cliff to peek)\n`,
    );
    return 0;
  }

  // The most recent suspension may be active (still pending a
  // resume) or historical (already resumed since). The
  // state-derivation invariant from Play.ts:
  //   suspensions.length === resumes.length + 1 → suspended (active cliff)
  //   suspensions.length === resumes.length     → playing/concluded (historical)
  const active = play.suspensions.length === play.resumes.length + 1;
  const correspondingResume = active
    ? null
    : play.resumes[play.resumes.length - 1] ?? null;

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          play_id: play.id,
          game: play.game,
          state: play.state,
          cliff: lastSuspension.cliff,
          invitation: lastSuspension.invitation,
          suspended_at: lastSuspension.at,
          suspended_by: lastSuspension.by,
          active,
          ...(correspondingResume
            ? {
                resumed_at: correspondingResume.at,
                resumed_by: correspondingResume.by,
              }
            : {}),
        },
        null,
        2,
      ) + '\n',
    );
    return 0;
  }

  // text rendering
  const stateTag =
    play.state === 'suspended'
      ? `[${play.state} ↺]`
      : play.state === 'concluded'
        ? `[${play.state} ✓]`
        : `[${play.state}]`;
  process.stdout.write(
    `play ${play.id}  ${stateTag}  game=${play.game}\n`,
  );
  if (active) {
    process.stdout.write(
      `last suspension: ${lastSuspension.at} by ${lastSuspension.by} (active — not yet resumed)\n`,
    );
  } else {
    const r = correspondingResume!;
    process.stdout.write(
      `last suspension: ${lastSuspension.at} by ${lastSuspension.by} (resumed at ${r.at} by ${r.by})\n`,
    );
  }
  process.stdout.write(
    `cliff:      ${lastSuspension.cliff}\n` +
      `invitation: ${lastSuspension.invitation}\n`,
  );
  return 0;
}
