import YAML from 'yaml';
import { join } from 'node:path';
import {
  Play,
  PlayIdCollision,
  PlayMove,
  PlayVersionConflict,
  parsePlayId,
} from '../domain/Play.js';
import { PlayRepository } from '../application/PlayRepository.js';
import { parseGameSlug } from '../domain/Game.js';
import { GuildConfig } from '../../../infrastructure/config/GuildConfig.js';
import {
  existsSafe,
  listDirSafe,
  readTextSafe,
  writeTextSafe,
  writeTextSafeAtomic,
} from '../../../infrastructure/persistence/safeFs.js';
import { parseYamlSafe } from '../../../infrastructure/persistence/parseYamlSafe.js';

/**
 * agora play storage adapter.
 *
 * Layout: <content_root>/agora/plays/<game-slug>/<play-id>.yaml
 *
 * One subdirectory per game keeps plays scoped to their definition,
 * which (a) makes `agora list --game <slug>` cheap and (b) prevents
 * id collision pressure across games (each game has its own counter).
 */
export class YamlPlayRepository implements PlayRepository {
  private readonly base: string;

  constructor(private readonly config: GuildConfig) {
    this.base = join(this.config.contentRoot, 'agora');
  }

  pathFor(gameSlug: string, playId: string): string {
    parseGameSlug(gameSlug);
    parsePlayId(playId);
    return join(this.base, 'plays', gameSlug, `${playId}.yaml`);
  }

  async findById(id: string): Promise<Play | null> {
    parsePlayId(id);
    // Find which game subdirectory this play lives under. Plays
    // are unique by id within a game, but not necessarily across
    // games (different games can have a 2026-05-02-001 each). We
    // walk plays/ subdirectories to find a match. A future
    // optimization would index id→game; v0 doesn't need it.
    const playsRoot = 'plays';
    const gameDirs = listDirSafe(this.base, playsRoot);
    for (const gameSlug of gameDirs) {
      const rel = join(playsRoot, gameSlug, `${id}.yaml`);
      if (!existsSafe(this.base, rel)) continue;
      const raw = readTextSafe(this.base, rel);
      const absSource = join(this.base, rel);
      const parsed = parseYamlSafe(raw, absSource, this.config.onMalformed);
      if (parsed === undefined) continue;
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.config.onMalformed(
          absSource,
          'top-level YAML is not a mapping; skipping',
        );
        continue;
      }
      const obj = parsed as Record<string, unknown>;
      try {
        return Play.restore({
          id: typeof obj['id'] === 'string' ? (obj['id'] as string) : id,
          game: typeof obj['game'] === 'string' ? (obj['game'] as string) : gameSlug,
          state:
            typeof obj['state'] === 'string'
              ? ((obj['state'] as string) as never)
              : 'playing',
          started_at:
            typeof obj['started_at'] === 'string'
              ? (obj['started_at'] as string)
              : new Date().toISOString(),
          started_by:
            typeof obj['started_by'] === 'string'
              ? (obj['started_by'] as string)
              : 'unknown',
          moves: hydrateMoves(obj['moves']),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.config.onMalformed(absSource, `hydrate failed (id=${id}), skipping: ${msg}`);
        return null;
      }
    }
    return null;
  }

  async saveNew(play: Play): Promise<void> {
    parseGameSlug(play.game);
    const rel = join('plays', play.game, `${play.id}.yaml`);
    if (existsSafe(this.base, rel)) {
      throw new PlayIdCollision(play.id);
    }
    const text = YAML.stringify(play.toJSON());
    try {
      writeTextSafe(this.base, rel, text, { createOnly: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new PlayIdCollision(play.id);
      }
      throw e;
    }
  }

  async appendMove(
    play: Play,
    expectedMovesCount: number,
    move: PlayMove,
  ): Promise<void> {
    parseGameSlug(play.game);
    parsePlayId(play.id);
    const rel = join('plays', play.game, `${play.id}.yaml`);
    if (!existsSafe(this.base, rel)) {
      // Caller is supposed to load before appending; if the file
      // disappeared between load and write, surface the version
      // conflict (the on-disk state is "no file" → equivalent to
      // moves.length 0 mismatch with expected).
      throw new PlayVersionConflict(play.id, expectedMovesCount, 0);
    }
    // CAS: re-read on-disk moves.length, compare against expected.
    const raw = readTextSafe(this.base, rel);
    const parsed = parseYamlSafe(raw, join(this.base, rel), this.config.onMalformed);
    if (parsed === undefined || parsed === null || typeof parsed !== 'object') {
      throw new PlayVersionConflict(play.id, expectedMovesCount, 0);
    }
    const obj = parsed as Record<string, unknown>;
    const onDiskMoves = Array.isArray(obj['moves']) ? obj['moves'].length : 0;
    if (onDiskMoves !== expectedMovesCount) {
      throw new PlayVersionConflict(play.id, expectedMovesCount, onDiskMoves);
    }

    // Compose the new on-disk shape: existing fields preserved,
    // moves[] replaced with appended copy.
    const updated: Record<string, unknown> = {
      ...obj,
      moves: [
        ...(Array.isArray(obj['moves']) ? obj['moves'] : []),
        { ...move },
      ],
    };
    writeTextSafeAtomic(this.base, rel, YAML.stringify(updated));
  }

  async nextSequence(gameSlug: string, dateKey: string): Promise<number> {
    parseGameSlug(gameSlug);
    let max = 0;
    const dir = join('plays', gameSlug);
    for (const f of listDirSafe(this.base, dir)) {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})-(\d{3,4})\.yaml$/);
      if (m && m[1] === dateKey) {
        const n = parseInt(m[2] as string, 10);
        if (n > max) max = n;
      }
    }
    return max + 1;
  }
}

function hydrateMoves(raw: unknown): PlayMove[] {
  if (!Array.isArray(raw)) return [];
  const out: PlayMove[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    if (
      typeof r['id'] !== 'string' ||
      typeof r['at'] !== 'string' ||
      typeof r['by'] !== 'string' ||
      typeof r['text'] !== 'string'
    ) {
      continue;
    }
    out.push({
      id: r['id'] as string,
      at: r['at'] as string,
      by: r['by'] as string,
      text: r['text'] as string,
    });
  }
  return out;
}
