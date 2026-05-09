import YAML from 'yaml';
import { join } from 'node:path';
import {
  SessionEvent,
  parseSessionKind,
} from '../../domain/session/SessionEvent.js';
import { MemberName } from '../../domain/member/MemberName.js';
import { SessionEventRepository } from '../../application/session/SessionEventRepository.js';
import { GuildConfig } from '../config/GuildConfig.js';
import {
  MAX_DIR_ENTRIES,
  existsSafe,
  listDirSafe,
  readTextSafe,
  writeTextSafe,
} from './safeFs.js';
import { parseYamlSafe } from './parseYamlSafe.js';

// Session-event filename pattern. Same shape as request / issue
// per-day sequence ids minus the entity prefix.
const FILE_PATTERN = /^\d{4}-\d{2}-\d{2}-\d{3,4}\.yaml$/;
const SEQ_PATTERN = /^(\d{4}-\d{2}-\d{2})-(\d{3,4})\.yaml$/;

export class YamlSessionEventRepository implements SessionEventRepository {
  constructor(private readonly config: GuildConfig) {}

  async nextSequence(dateKey: string): Promise<number> {
    let max = 0;
    for (const f of listDirSafe(this.config.paths.sessions, '.')) {
      const m = f.match(SEQ_PATTERN);
      if (m && m[1] === dateKey) {
        const n = parseInt(m[2] as string, 10);
        if (n > max) max = n;
      }
    }
    return max + 1;
  }

  async save(event: SessionEvent): Promise<void> {
    const rel = `${event.id}.yaml`;
    if (existsSafe(this.config.paths.sessions, rel)) {
      // ID collision is structural: nextSequence picks the smallest
      // available number, so a collision means a concurrent writer
      // wrote one between the allocation and this save. Surface the
      // race as a domain-shaped error rather than silently
      // overwriting — the caller can re-allocate and retry.
      throw new Error(
        `session event id collision: ${event.id} already exists. ` +
          `A concurrent writer may have allocated the same sequence; retry.`,
      );
    }
    const text = YAML.stringify(event.toJSON());
    try {
      writeTextSafe(this.config.paths.sessions, rel, text, {
        createOnly: true,
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(
          `session event id collision: ${event.id} already exists.`,
        );
      }
      throw e;
    }
  }

  async listAll(): Promise<readonly SessionEvent[]> {
    const files = listDirSafe(this.config.paths.sessions, '.')
      .filter((f) => FILE_PATTERN.test(f))
      .slice(0, MAX_DIR_ENTRIES);
    const out: SessionEvent[] = [];
    for (const f of files) {
      const raw = readTextSafe(this.config.paths.sessions, f);
      const absSource = join(this.config.paths.sessions, f);
      const parsed = parseYamlSafe(raw, absSource, this.config.onMalformed);
      if (parsed === undefined) continue;
      const event = hydrate(parsed, absSource, this.config.onMalformed);
      if (event) out.push(event);
    }
    return out;
  }
}

function hydrate(
  data: unknown,
  source: string,
  onMalformed: (source: string, msg: string) => void,
): SessionEvent | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    onMalformed(source, 'top-level YAML is not a mapping; skipping');
    return null;
  }
  const obj = data as Record<string, unknown>;
  try {
    const id = String(obj['id'] ?? '');
    const kind = parseSessionKind(String(obj['kind'] ?? ''));
    const by = MemberName.of(obj['by']);
    const at = String(obj['at'] ?? '');
    const noteRaw = obj['note'];
    return SessionEvent.restore({
      id,
      kind,
      by,
      at,
      ...(typeof noteRaw === 'string' && noteRaw.length > 0
        ? { note: noteRaw }
        : {}),
    });
  } catch (e) {
    onMalformed(
      source,
      `failed to hydrate session event: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}
