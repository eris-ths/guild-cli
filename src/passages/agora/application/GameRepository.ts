import { Game } from '../domain/Game.js';

/**
 * Port for game definition storage. Like every passage repository
 * port, the boundary is at the substrate (filesystem layout); the
 * application layer holds the contract, the infrastructure layer
 * provides the implementation.
 */
export interface GameRepository {
  /** Find a game by slug, or null if absent. */
  findBySlug(slug: string): Promise<Game | null>;
  /** Create a brand-new game; throws GameSlugCollision on duplicate. */
  saveNew(game: Game): Promise<void>;
  /**
   * Absolute path of the file the given slug would land at. Exposed so
   * the handler layer can disclose `where_written` honestly (principle
   * 09 orientation disclosure) — the path is computed once at the
   * repo boundary and surfaced to the user. The file may or may not
   * exist; this is a path projection, not an existence check.
   */
  pathFor(slug: string): string;
}
