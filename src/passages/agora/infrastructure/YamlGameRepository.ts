import YAML from 'yaml';
import { join } from 'node:path';
import { Game, GameSlugCollision, parseGameSlug } from '../domain/Game.js';
import { GameRepository } from '../application/GameRepository.js';
import { GuildConfig } from '../../../infrastructure/config/GuildConfig.js';
import {
  existsSafe,
  readTextSafe,
  writeTextSafe,
} from '../../../infrastructure/persistence/safeFs.js';
import { parseYamlSafe } from '../../../infrastructure/persistence/parseYamlSafe.js';

/**
 * agora's first storage adapter — reuses gate's substrate (safeFs,
 * parseYamlSafe, GuildConfig) per the container/passage architecture
 * (principles 04, 11). The substrate doesn't change for agora; only
 * the directory layout under content_root differs.
 *
 * Layout: <content_root>/agora/games/<slug>.yaml
 *
 * The base directory passed to safeFs is `<content_root>/agora`,
 * making `games/<slug>.yaml` the relative path. Path-traversal
 * containment (per principle 04) is enforced by safeFs against this
 * base; `parseGameSlug` already rejects path-unsafe characters at
 * the domain boundary.
 */
export class YamlGameRepository implements GameRepository {
  private readonly base: string;

  constructor(private readonly config: GuildConfig) {
    this.base = join(this.config.contentRoot, 'agora');
  }

  pathFor(slug: string): string {
    parseGameSlug(slug); // throws if invalid; caller gets a domain error
    return join(this.base, 'games', `${slug}.yaml`);
  }

  async findBySlug(slug: string): Promise<Game | null> {
    parseGameSlug(slug);
    const rel = join('games', `${slug}.yaml`);
    if (!existsSafe(this.base, rel)) return null;
    const raw = readTextSafe(this.base, rel);
    const absSource = join(this.base, rel);
    const parsed = parseYamlSafe(raw, absSource, this.config.onMalformed);
    if (parsed === undefined) return null;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.config.onMalformed(absSource, 'top-level YAML is not a mapping; skipping');
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    try {
      return Game.restore({
        slug: typeof obj['slug'] === 'string' ? (obj['slug'] as string) : slug,
        kind: typeof obj['kind'] === 'string' ? (obj['kind'] as string) as never : 'quest',
        title: typeof obj['title'] === 'string' ? (obj['title'] as string) : '',
        created_at:
          typeof obj['created_at'] === 'string'
            ? (obj['created_at'] as string)
            : new Date().toISOString(),
        created_by:
          typeof obj['created_by'] === 'string' ? (obj['created_by'] as string) : 'unknown',
        ...(typeof obj['description'] === 'string'
          ? { description: obj['description'] as string }
          : {}),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.config.onMalformed(absSource, `hydrate failed (slug=${slug}), skipping: ${msg}`);
      return null;
    }
  }

  async saveNew(game: Game): Promise<void> {
    const rel = join('games', `${game.slug}.yaml`);
    if (existsSafe(this.base, rel)) {
      throw new GameSlugCollision(game.slug);
    }
    const text = YAML.stringify(game.toJSON());
    try {
      writeTextSafe(this.base, rel, text, { createOnly: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new GameSlugCollision(game.slug);
      }
      throw e;
    }
  }
}
