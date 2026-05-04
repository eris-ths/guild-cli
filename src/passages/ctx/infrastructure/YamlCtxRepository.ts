import YAML from 'yaml';
import { join } from 'node:path';
import { Ctx, CtxIdCollision, parseCtxId } from '../domain/Ctx.js';
import { CtxRepository } from '../application/CtxRepository.js';
import { GuildConfig } from '../../../infrastructure/config/GuildConfig.js';
import {
  existsSafe,
  listDirSafe,
  readTextSafe,
  writeTextSafe,
} from '../../../infrastructure/persistence/safeFs.js';
import { parseYamlSafe } from '../../../infrastructure/persistence/parseYamlSafe.js';

/**
 * ctx's first storage adapter — same substrate primitives as agora /
 * devil (safeFs / parseYamlSafe / GuildConfig). The shared IO core
 * is the implicit cross-passage invariant that lore principle 12
 * names; this adapter participates in it without re-implementing.
 *
 * Layout: <content_root>/ctx/<id>.yaml  (flat, no sub-directory in
 * phase 1 — sub_of and chain_after fields arrive in phase 2 and
 * may motivate a layout change at that point).
 */
export class YamlCtxRepository implements CtxRepository {
  private readonly base: string;

  constructor(private readonly config: GuildConfig) {
    this.base = join(this.config.contentRoot, 'ctx');
  }

  async listAllIds(): Promise<readonly string[]> {
    const files = listDirSafe(this.base, '.');
    const out: string[] = [];
    for (const f of files) {
      if (!f.endsWith('.yaml')) continue;
      const id = f.replace(/\.yaml$/, '');
      try {
        parseCtxId(id);
        out.push(id);
      } catch {
        // off-pattern filenames in ctx/ are surfaced via diagnostic
        // eventually; listAllIds skips them so id allocation does
        // not crash on a typo file (same discipline as agora).
      }
    }
    return out;
  }

  async saveNew(ctx: Ctx): Promise<void> {
    const rel = `${ctx.id}.yaml`;
    if (existsSafe(this.base, rel)) {
      throw new CtxIdCollision(ctx.id);
    }
    const text = YAML.stringify(ctx.toJSON());
    try {
      writeTextSafe(this.base, rel, text, { createOnly: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new CtxIdCollision(ctx.id);
      }
      throw e;
    }
  }

  async findById(id: string): Promise<Ctx | null> {
    parseCtxId(id);
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
      return Ctx.restore({
        id: typeof obj['id'] === 'string' ? (obj['id'] as string) : id,
        created_at:
          typeof obj['created_at'] === 'string'
            ? (obj['created_at'] as string)
            : new Date().toISOString(),
        created_by:
          typeof obj['created_by'] === 'string' ? (obj['created_by'] as string) : 'unknown',
        fact: typeof obj['fact'] === 'string' ? (obj['fact'] as string) : '',
        tags: Array.isArray(obj['tags'])
          ? (obj['tags'] as unknown[]).filter((t): t is string => typeof t === 'string')
          : [],
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.config.onMalformed(absSource, `hydrate failed (id=${id}), skipping: ${msg}`);
      return null;
    }
  }
}
