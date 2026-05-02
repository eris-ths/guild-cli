import { Play } from '../domain/Play.js';

/**
 * Port for play session storage.
 *
 * Plays live under `<content_root>/agora/plays/<game-slug>/<play-id>.yaml`.
 * The game subdirectory keeps plays scoped to their definition —
 * a Quest game's plays don't mingle with a Sandbox game's plays in
 * the same flat directory.
 */
export interface PlayRepository {
  /** Find a play by its id (sequence is unique enough to scan). */
  findById(id: string): Promise<Play | null>;
  /** Create a brand-new play; throws PlayIdCollision on duplicate. */
  saveNew(play: Play): Promise<void>;
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
