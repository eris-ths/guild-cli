import { Play } from '../../domain/Play.js';
import { PlayRepository } from '../../application/PlayRepository.js';
import { DomainError } from '../../../../domain/shared/DomainError.js';

/**
 * Raised by {@link resolvePlayForVerb} when a `<play-id>` matches
 * plays in more than one game and no `--game <slug>` qualifier is
 * provided. Carries `field='play_id'` and the candidate game slugs
 * in the message body so an AI tool layer reading `--format json`
 * envelopes can extract the disambiguation choices without parsing
 * prose.
 *
 * Per #205 / Noir v3: the resolver was previously side-effecting
 * (writing stderr + returning `'ambiguous'` sentinel), which JSON
 * consumers could not intercept. Throwing surfaces the failure
 * through the entry-point's `emitErrorEnvelope` outer-catch and
 * yields a structured envelope for free.
 */
export class PlayIdAmbiguous extends DomainError {
  readonly play_id: string;
  readonly candidates: readonly string[];
  constructor(playId: string, candidates: readonly string[]) {
    super(
      `multiple games have a play with id "${playId}" (each game has its own sequence). ` +
        `Disambiguate with --game <slug>. Candidates: ${candidates.join(', ')}`,
      'play_id',
    );
    this.name = 'PlayIdAmbiguous';
    this.play_id = playId;
    this.candidates = candidates;
  }
}

/**
 * Resolve a `<play-id>` positional that may collide across games.
 *
 * Plays are sequenced **per-game-per-day**, so two games each opened
 * on the same day both produce a `YYYY-MM-DD-001`. The repository's
 * `findById` walks game subdirectories and returns the first match
 * (alphabetically by game slug) — which silently mis-resolves the
 * caller's intent when the collision is real. `agora show` already
 * disambiguates with this pattern; this helper extracts it so
 * `agora move` / `suspend` / `resume` / `conclude` / `cliff` honor
 * the same contract (6 callers total — move / suspend / resume /
 * conclude / cliff + show.ts inline duplicate folded in).
 *
 * Resolution rules:
 *   - explicit `gameFilter` → walk all matches, return the one whose
 *     `game` slug matches; null if none.
 *   - no `gameFilter` + 0 matches → null.
 *   - no `gameFilter` + 1 match → that match.
 *   - no `gameFilter` + >1 matches → throw {@link PlayIdAmbiguous}
 *     listing candidate game slugs (#205: previously wrote stderr +
 *     returned `'ambiguous'`; that bypassed `--format json` envelopes).
 *
 * Pure resolver: no I/O beyond the repository call. Caller's outer-
 * catch (entry-point envelope) handles the throw uniformly.
 *
 * Surfaced by issue i-2026-05-03-0002 (develop-branch dogfood,
 * "going-inside-harness" experiment): the same-day same-id collision
 * blocked all moves on a 2nd play of the day.
 */
export async function resolvePlayForVerb(
  plays: PlayRepository,
  playId: string,
  gameFilter: string | undefined,
): Promise<Play | null> {
  if (gameFilter) {
    const matches = await plays.findAllById(playId);
    return matches.find((p) => p.game === gameFilter) ?? null;
  }
  const matches = await plays.findAllById(playId);
  if (matches.length > 1) {
    throw new PlayIdAmbiguous(
      playId,
      matches.map((p) => p.game),
    );
  }
  return matches[0] ?? null;
}
