import { Play } from '../../domain/Play.js';
import { PlayRepository } from '../../application/PlayRepository.js';

/**
 * Resolve a `<play-id>` positional that may collide across games.
 *
 * Plays are sequenced **per-game-per-day**, so two games each opened
 * on the same day both produce a `YYYY-MM-DD-001`. The repository's
 * `findById` walks game subdirectories and returns the first match
 * (alphabetically by game slug) — which silently mis-resolves the
 * caller's intent when the collision is real. `agora show` already
 * disambiguates with this pattern; this helper extracts it so
 * `agora move` / `suspend` / `resume` / `conclude` honor the same
 * contract.
 *
 * Resolution rules:
 *   - explicit `gameFilter` → walk all matches, return the one whose
 *     `game` slug matches; null if none.
 *   - no `gameFilter` + 0 matches → null.
 *   - no `gameFilter` + 1 match → that match.
 *   - no `gameFilter` + >1 matches → write an ambiguity error to stderr
 *     listing candidate game slugs and the `--game <slug>` escape valve;
 *     return `'ambiguous'` so the caller exits with status 1.
 *
 * The ambiguity error names every candidate so the caller can pick
 * without a separate `agora list` round-trip. Phrasing matches
 * `agora show`'s existing message verbatim.
 *
 * Surfaced by issue i-2026-05-03-0002 (develop-branch dogfood,
 * "going-inside-harness" experiment): the same-day same-id collision
 * blocked all moves on a 2nd play of the day.
 */
export async function resolvePlayForVerb(
  plays: PlayRepository,
  playId: string,
  gameFilter: string | undefined,
): Promise<Play | null | 'ambiguous'> {
  if (gameFilter) {
    const matches = await plays.findAllById(playId);
    return matches.find((p) => p.game === gameFilter) ?? null;
  }
  const matches = await plays.findAllById(playId);
  if (matches.length > 1) {
    const games = matches.map((p) => p.game).join(', ');
    process.stderr.write(
      `error: multiple games have a play with id "${playId}" (each game has its own sequence). ` +
        `Disambiguate with --game <slug>. Candidates: ${games}\n`,
    );
    return 'ambiguous';
  }
  return matches[0] ?? null;
}
