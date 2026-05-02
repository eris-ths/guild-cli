import { Play, PlayMove, ResumeEntry, SuspensionEntry } from '../domain/Play.js';

/**
 * Port for play session storage.
 *
 * Plays live under `<content_root>/agora/plays/<game-slug>/<play-id>.yaml`.
 * The game subdirectory keeps plays scoped to their definition —
 * a Quest game's plays don't mingle with a Sandbox game's plays in
 * the same flat directory.
 */
export interface PlayRepository {
  /**
   * Find every play with the given id, scanning every game's
   * subdirectory. Used by `agora show` when the user passes a
   * play id without `--game` and there could be cross-game
   * collisions (each game has its own sequence). Returns one
   * entry per matching game; empty when no game has the id.
   */
  findAllById(id: string): Promise<Play[]>;
  /** Find a play by its id (sequence is unique enough to scan). */
  findById(id: string): Promise<Play | null>;
  /** Every play in the content_root, optionally scoped to one game. */
  listAll(opts?: { gameSlug?: string }): Promise<Play[]>;
  /** Create a brand-new play; throws PlayIdCollision on duplicate. */
  saveNew(play: Play): Promise<void>;
  /**
   * Append a move to an existing play with optimistic CAS. The
   * caller passes the moves.length they loaded (`expectedMovesCount`);
   * if the on-disk file has a different moves.length, the write
   * fails with PlayVersionConflict. This protects re-entering
   * instances from silently overwriting concurrent moves —
   * AI-natural per principle 11.
   *
   * The new move is appended atomically (.tmp + rename) so readers
   * never see a torn file.
   */
  appendMove(
    play: Play,
    expectedMovesCount: number,
    move: PlayMove,
  ): Promise<void>;
  /**
   * Append a suspension and flip state to `suspended`. CAS on
   * `expectedSuspensionsCount` (the load-time suspensions.length)
   * detects concurrent suspenders.
   */
  appendSuspension(
    play: Play,
    expectedSuspensionsCount: number,
    entry: SuspensionEntry,
  ): Promise<void>;
  /**
   * Append a resume and flip state back to `playing`. CAS on
   * `expectedResumesCount` (the load-time resumes.length).
   */
  appendResume(
    play: Play,
    expectedResumesCount: number,
    entry: ResumeEntry,
  ): Promise<void>;
  /**
   * Allocate a fresh sequence for the given game/date pair. Used by
   * `agora play` when starting a session — the caller computes
   * `today` (YYYY-MM-DD) and asks for the next available sequence
   * for that game/date.
   */
  nextSequence(gameSlug: string, dateKey: string): Promise<number>;
  /** Absolute path the given play would land at. */
  pathFor(gameSlug: string, playId: string): string;
}
