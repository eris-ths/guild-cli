import YAML from 'yaml';
import { join } from 'node:path';
import {
  Play,
  PlayIdCollision,
  PlayMove,
  PlayVersionConflict,
  ResumeEntry,
  SuspensionEntry,
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
    // Walk plays/<game>/ subdirectories looking for a file matching
    // this id. Plays are unique-by-id within a game, but not across
    // games — different games can have their own `2026-05-02-001`.
    // findById returns the FIRST match found while walking, so it
    // is unsuitable for cross-game disambiguation; listAll reads
    // each game's directory directly via loadFromRel. For
    // disambiguation, callers should use findAllById.
    const playsRoot = 'plays';
    const gameDirs = listDirSafe(this.base, playsRoot);
    for (const gameSlug of gameDirs) {
      const rel = join(playsRoot, gameSlug, `${id}.yaml`);
      if (!existsSafe(this.base, rel)) continue;
      const play = this.loadFromRel(rel, gameSlug);
      if (play) return play;
    }
    return null;
  }

  async findAllById(id: string): Promise<Play[]> {
    parsePlayId(id);
    const out: Play[] = [];
    const playsRoot = 'plays';
    const gameDirs = listDirSafe(this.base, playsRoot);
    for (const gameSlug of gameDirs) {
      const rel = join(playsRoot, gameSlug, `${id}.yaml`);
      if (!existsSafe(this.base, rel)) continue;
      const play = this.loadFromRel(rel, gameSlug);
      if (play) out.push(play);
    }
    out.sort((a, b) => a.game.localeCompare(b.game));
    return out;
  }

  /**
   * Read and hydrate a single play YAML at the given relative path
   * (relative to `this.base`). Returns null if missing, malformed,
   * or hydrate fails. Used by findById (walks all game subdirs) and
   * listAll (walks per-game directly without id→game ambiguity).
   */
  private loadFromRel(rel: string, gameSlugHint: string): Play | null {
    const raw = readTextSafe(this.base, rel);
    const absSource = join(this.base, rel);
    const parsed = parseYamlSafe(raw, absSource, this.config.onMalformed);
    if (parsed === undefined) return null;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.config.onMalformed(
        absSource,
        'top-level YAML is not a mapping; skipping',
      );
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    try {
      return Play.restore({
        id: typeof obj['id'] === 'string' ? (obj['id'] as string) : '',
        game: typeof obj['game'] === 'string' ? (obj['game'] as string) : gameSlugHint,
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
        suspensions: hydrateSuspensions(obj['suspensions']),
        resumes: hydrateResumes(obj['resumes']),
        ...(typeof obj['concluded_at'] === 'string'
          ? { concluded_at: obj['concluded_at'] as string }
          : {}),
        ...(typeof obj['concluded_by'] === 'string'
          ? { concluded_by: obj['concluded_by'] as string }
          : {}),
        ...(typeof obj['concluded_note'] === 'string'
          ? { concluded_note: obj['concluded_note'] as string }
          : {}),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.config.onMalformed(absSource, `hydrate failed, skipping: ${msg}`);
      return null;
    }
  }

  async listAll(opts: { gameSlug?: string } = {}): Promise<Play[]> {
    const playsRoot = 'plays';
    const out: Play[] = [];
    const games = opts.gameSlug
      ? [opts.gameSlug]
      : listDirSafe(this.base, playsRoot);
    for (const gameSlug of games) {
      try {
        parseGameSlug(gameSlug);
      } catch {
        // unrecognized directory under plays/ — skip silently;
        // a future doctor scan would surface it.
        continue;
      }
      const dir = join(playsRoot, gameSlug);
      const files = listDirSafe(this.base, dir);
      for (const f of files) {
        if (!/^\d{4}-\d{2}-\d{2}-\d{3,4}\.yaml$/.test(f)) continue;
        // Read each game's plays directly via loadFromRel — we
        // already know the game subdir. Going through findById
        // would mis-resolve cross-game id collisions (e.g. two
        // games each with their own `2026-05-02-001`).
        const rel = join(playsRoot, gameSlug, f);
        const play = this.loadFromRel(rel, gameSlug);
        if (play) out.push(play);
      }
    }
    // Sort: most recent first (id is YYYY-MM-DD-NNN, lexicographic
    // sort matches chronological for ISO-format dates). Tie-break
    // on game slug so two games with same id sort deterministically.
    out.sort((a, b) => {
      const idCmp = b.id.localeCompare(a.id);
      return idCmp !== 0 ? idCmp : a.game.localeCompare(b.game);
    });
    return out;
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
    await this.appendArrayWithCAS(
      play,
      'moves',
      expectedMovesCount,
      move as unknown as Record<string, unknown>,
      undefined, // no state transition on move
    );
  }

  async appendSuspension(
    play: Play,
    expectedSuspensionsCount: number,
    entry: SuspensionEntry,
  ): Promise<void> {
    await this.appendArrayWithCAS(
      play,
      'suspensions',
      expectedSuspensionsCount,
      entry as unknown as Record<string, unknown>,
      'suspended',
    );
  }

  async appendResume(
    play: Play,
    expectedResumesCount: number,
    entry: ResumeEntry,
  ): Promise<void> {
    await this.appendArrayWithCAS(
      play,
      'resumes',
      expectedResumesCount,
      entry as unknown as Record<string, unknown>,
      'playing',
    );
  }

  async saveConclusion(
    play: Play,
    expectedState: 'playing' | 'suspended',
    concluded_at: string,
    concluded_by: string,
    concluded_note: string | undefined,
  ): Promise<void> {
    parseGameSlug(play.game);
    parsePlayId(play.id);
    const rel = join('plays', play.game, `${play.id}.yaml`);
    if (!existsSafe(this.base, rel)) {
      throw new PlayVersionConflict(play.id, 1, 0);
    }
    const raw = readTextSafe(this.base, rel);
    const parsed = parseYamlSafe(raw, join(this.base, rel), this.config.onMalformed);
    if (parsed === undefined || parsed === null || typeof parsed !== 'object') {
      throw new PlayVersionConflict(play.id, 1, 0);
    }
    const obj = parsed as Record<string, unknown>;
    // CAS on state: if the on-disk state changed since load (e.g.
    // a concurrent suspend or resume slipped in between our load
    // and write), surface the conflict rather than overwriting.
    // We encode the state as a numeric proxy so PlayVersionConflict
    // can carry it: expected=1 (state matched), found=0 (mismatch).
    if (obj['state'] !== expectedState) {
      throw new PlayVersionConflict(play.id, 1, 0);
    }
    const updated: Record<string, unknown> = {
      ...obj,
      state: 'concluded',
      concluded_at,
      concluded_by,
    };
    if (concluded_note !== undefined) {
      updated['concluded_note'] = concluded_note;
    }
    writeTextSafeAtomic(this.base, rel, YAML.stringify(updated));
  }

  /**
   * Shared append-with-CAS helper. Re-reads the on-disk file,
   * checks the named array's length matches `expectedCount`,
   * appends the entry, optionally flips the `state` field,
   * atomic-writes back. Same shape protects every state-changing
   * append — principle 11 (AI-natural): re-entering instances
   * detect concurrent appenders rather than silently overwrite.
   */
  private async appendArrayWithCAS(
    play: Play,
    arrayKey: 'moves' | 'suspensions' | 'resumes',
    expectedCount: number,
    entry: Record<string, unknown>,
    newState: 'playing' | 'suspended' | 'concluded' | undefined,
  ): Promise<void> {
    parseGameSlug(play.game);
    parsePlayId(play.id);
    const rel = join('plays', play.game, `${play.id}.yaml`);
    if (!existsSafe(this.base, rel)) {
      throw new PlayVersionConflict(play.id, expectedCount, 0);
    }
    const raw = readTextSafe(this.base, rel);
    const parsed = parseYamlSafe(raw, join(this.base, rel), this.config.onMalformed);
    if (parsed === undefined || parsed === null || typeof parsed !== 'object') {
      throw new PlayVersionConflict(play.id, expectedCount, 0);
    }
    const obj = parsed as Record<string, unknown>;
    const onDiskCount = Array.isArray(obj[arrayKey])
      ? (obj[arrayKey] as unknown[]).length
      : 0;
    if (onDiskCount !== expectedCount) {
      throw new PlayVersionConflict(play.id, expectedCount, onDiskCount);
    }
    const updated: Record<string, unknown> = {
      ...obj,
      [arrayKey]: [
        ...(Array.isArray(obj[arrayKey]) ? (obj[arrayKey] as unknown[]) : []),
        entry,
      ],
    };
    if (newState !== undefined) {
      updated['state'] = newState;
    }
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

function hydrateSuspensions(raw: unknown): SuspensionEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: SuspensionEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    if (
      typeof r['at'] !== 'string' ||
      typeof r['by'] !== 'string' ||
      typeof r['cliff'] !== 'string' ||
      typeof r['invitation'] !== 'string'
    ) {
      continue;
    }
    out.push({
      at: r['at'] as string,
      by: r['by'] as string,
      cliff: r['cliff'] as string,
      invitation: r['invitation'] as string,
    });
  }
  return out;
}

function hydrateResumes(raw: unknown): ResumeEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ResumeEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    if (typeof r['at'] !== 'string' || typeof r['by'] !== 'string') {
      continue;
    }
    const e: ResumeEntry = {
      at: r['at'] as string,
      by: r['by'] as string,
    };
    if (typeof r['note'] === 'string') {
      (e as { note?: string }).note = r['note'] as string;
    }
    out.push(e);
  }
  return out;
}
