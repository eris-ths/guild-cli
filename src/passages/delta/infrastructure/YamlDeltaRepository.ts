import YAML from 'yaml';
import { join } from 'node:path';
import { Delta, DeltaIdCollision, parseDeltaId } from '../domain/Delta.js';
import { DeltaRepository } from '../application/DeltaRepository.js';
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
 * delta's storage adapter — same substrate primitives as agora / devil /
 * ctx (safeFs / parseYamlSafe / GuildConfig), participating in the shared
 * IO core that lore principle 12 names rather than re-implementing it.
 *
 * Layout: <content_root>/delta/<id>.yaml (flat).
 *
 * State lives in a *field* (`delivered` present or absent), not in a
 * directory. gate moves request files between state directories, and
 * that is right for gate — a request's state is a queue position other
 * actors poll. A deposit has no queue: it is either outstanding or it
 * has landed, and encoding that as a path would make `deliver` a
 * cross-directory rename, i.e. a second failure mode (half-moved
 * records) for no read-side gain. It would also repeat the mistake the
 * hook made with `issues_v2/open/`, where a directory that stopped
 * carrying state kept looking authoritative.
 */
export class YamlDeltaRepository implements DeltaRepository {
  private readonly base: string;

  constructor(private readonly config: GuildConfig) {
    this.base = join(this.config.contentRoot, 'delta');
  }

  async listAllIds(): Promise<readonly string[]> {
    const files = listDirSafe(this.base, '.');
    const out: string[] = [];
    for (const f of files) {
      if (!f.endsWith('.yaml')) continue;
      const id = f.replace(/\.yaml$/, '');
      try {
        parseDeltaId(id);
        out.push(id);
      } catch {
        // off-pattern filenames are skipped so id allocation does not
        // crash on a stray file (same discipline as agora / ctx).
      }
    }
    return out;
  }

  async listAll(): Promise<readonly Delta[]> {
    const ids = await this.listAllIds();
    const out: Delta[] = [];
    for (const id of ids) {
      const d = await this.findById(id);
      if (d !== null) out.push(d); // malformed records skip via findById
    }
    return out;
  }

  async saveNew(delta: Delta): Promise<void> {
    const rel = `${delta.id}.yaml`;
    if (existsSafe(this.base, rel)) {
      throw new DeltaIdCollision(delta.id);
    }
    const text = YAML.stringify(delta.toJSON());
    try {
      writeTextSafe(this.base, rel, text, { createOnly: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new DeltaIdCollision(delta.id);
      }
      throw e;
    }
  }

  /**
   * Overwrite an existing record (delivery only).
   *
   * Atomic write-then-rename rather than a plain overwrite: a delivery
   * lands while other sessions may be listing the same directory, and a
   * torn file would be *read as malformed and skipped*, i.e. the deposit
   * would silently vanish from `list` instead of failing loudly.
   */
  async save(delta: Delta): Promise<void> {
    const rel = `${delta.id}.yaml`;
    const text = YAML.stringify(delta.toJSON());
    writeTextSafeAtomic(this.base, rel, text);
  }

  async findById(id: string): Promise<Delta | null> {
    parseDeltaId(id);
    const rel = `${id}.yaml`;
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
      return Delta.restore({
        id: typeof obj['id'] === 'string' ? (obj['id'] as string) : id,
        created_at:
          typeof obj['created_at'] === 'string'
            ? (obj['created_at'] as string)
            : new Date().toISOString(),
        created_by:
          typeof obj['created_by'] === 'string' ? (obj['created_by'] as string) : 'unknown',
        text: typeof obj['text'] === 'string' ? (obj['text'] as string) : '',
        source: typeof obj['source'] === 'string' ? (obj['source'] as string) : undefined,
        candidate:
          typeof obj['candidate'] === 'string' ? (obj['candidate'] as string) : undefined,
        delivered: hydrateDelivery(obj['delivered']),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.config.onMalformed(absSource, `hydrate failed (id=${id}), skipping: ${msg}`);
      return null;
    }
  }
}

/**
 * Shape the on-disk `delivered` mapping into the domain's input.
 *
 * Field-level validation stays in the domain (restore fails closed);
 * this only decides "is there a delivery mapping here at all", so a
 * record with a tampered delivery raises rather than being silently
 * read as an outstanding deposit — which would resurrect work that was
 * already filed.
 */
function hydrateDelivery(raw: unknown): Delta['delivered'] {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    // Not a mapping: let the domain reject it via restore.
    return raw as never;
  }
  const o = raw as Record<string, unknown>;
  return {
    to: typeof o['to'] === 'string' ? (o['to'] as string) : '',
    at: typeof o['at'] === 'string' ? (o['at'] as string) : '',
    by: typeof o['by'] === 'string' ? (o['by'] as string) : '',
    note: typeof o['note'] === 'string' ? (o['note'] as string) : undefined,
  };
}
