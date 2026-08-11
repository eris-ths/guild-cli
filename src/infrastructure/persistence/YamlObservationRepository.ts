import YAML from 'yaml';
import { join } from 'node:path';
import { lstatSync, type Stats } from 'node:fs';
import {
  Observation,
  ObservationId,
  ObservationKind,
  hydrateObservationBody,
  parseObservationKind,
} from '../../domain/observation/Observation.js';
import { MemberName } from '../../domain/member/MemberName.js';
import { RequestId } from '../../domain/request/RequestId.js';
import {
  ObservationRepository,
  ObservationIdCollision,
} from '../../application/ports/ObservationRepository.js';
import { UnrecognizedRecordEntry } from '../../application/ports/UnrecognizedRecordEntry.js';
import {
  capDirEntries,
  existsSafe,
  listDirSafe,
  readTextSafe,
  writeTextSafe,
} from './safeFs.js';
import { GuildConfig } from '../config/GuildConfig.js';
import { OnMalformed } from '../../application/ports/OnMalformed.js';
import { parseYamlSafe } from './parseYamlSafe.js';

// Single source of truth for the on-disk filename pattern. listAll
// filters by it; listUnrecognizedFiles surfaces any .yaml that does
// NOT match. Defined once so the two paths cannot drift.
const FILE_PATTERN = /^o-\d{4}-\d{2}-\d{2}-\d{3,4}\.yaml$/;

function lstatSafe(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

export class YamlObservationRepository implements ObservationRepository {
  constructor(private readonly config: GuildConfig) {}

  private get dir(): string {
    return this.config.paths.observations;
  }

  async findById(id: ObservationId): Promise<Observation | null> {
    const rel = `${id.value}.yaml`;
    if (!existsSafe(this.dir, rel)) return null;
    const raw = readTextSafe(this.dir, rel);
    const absSource = join(this.dir, rel);
    const parsed = parseYamlSafe(raw, absSource, this.config.onMalformed);
    if (parsed === undefined) return null;
    return hydrate(parsed, absSource, this.config.onMalformed);
  }

  async listAll(): Promise<Observation[]> {
    const files = capDirEntries(
      listDirSafe(this.dir, '.').filter((f) => FILE_PATTERN.test(f)),
      'observations',
    );
    const out: Observation[] = [];
    for (const f of files) {
      const raw = readTextSafe(this.dir, f);
      const absSource = join(this.dir, f);
      const parsed = parseYamlSafe(raw, absSource, this.config.onMalformed);
      if (parsed === undefined) continue;
      const obs = hydrate(parsed, absSource, this.config.onMalformed);
      if (obs) out.push(obs);
    }
    // Ids are date+sequence, so lexical order is chronological.
    out.sort((a, b) => a.id.value.localeCompare(b.id.value));
    return out;
  }

  async listBySubject(requestId: string): Promise<Observation[]> {
    const all = await this.listAll();
    return all.filter((o) => o.subject?.value === requestId);
  }

  async listByKind(kind: ObservationKind): Promise<Observation[]> {
    const all = await this.listAll();
    return all.filter((o) => o.kind === kind);
  }

  async countRecordFiles(): Promise<number> {
    // Counts by filename shape only — deliberately the same predicate
    // the list paths use to decide what to *try*, so the difference
    // between this number and a list's length is exactly "attempted
    // and failed", with nothing else folded in.
    let n = 0;
    for (const entry of listDirSafe(this.dir, '.')) {
      if (FILE_PATTERN.test(entry)) n += 1;
    }
    return n;
  }

  async listUnrecognizedFiles(): Promise<UnrecognizedRecordEntry[]> {
    const out: UnrecognizedRecordEntry[] = [];
    for (const entry of listDirSafe(this.dir, '.')) {
      const abs = join(this.dir, entry);
      const st = lstatSafe(abs);
      if (st === null) continue;
      if (st.isDirectory()) {
        out.push({
          path: abs,
          kind: 'directory',
          reason: 'observations is a flat layout; nested directories are not read',
        });
        continue;
      }
      if (!entry.endsWith('.yaml')) continue;
      if (FILE_PATTERN.test(entry)) continue;
      out.push({
        path: abs,
        kind: 'file',
        reason: 'filename does not match o-YYYY-MM-DD-NNNN.yaml; listAll skips it',
      });
    }
    return out;
  }

  async saveNew(observation: Observation): Promise<void> {
    const rel = `${observation.id.value}.yaml`;
    if (existsSafe(this.dir, rel)) {
      throw new ObservationIdCollision(observation.id.value);
    }
    const text = YAML.stringify(observation.toJSON());
    try {
      writeTextSafe(this.dir, rel, text, { createOnly: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new ObservationIdCollision(observation.id.value);
      }
      throw e;
    }
  }

  async nextSequence(dateKey: string): Promise<number> {
    let max = 0;
    for (const f of listDirSafe(this.dir, '.')) {
      const m = f.match(/^o-(\d{4}-\d{2}-\d{2})-(\d{3,4})\.yaml$/);
      if (m && m[1] === dateKey) {
        const n = parseInt(m[2] as string, 10);
        if (n > max) max = n;
      }
    }
    return max + 1;
  }
}

function hydrate(
  data: unknown,
  source: string,
  onMalformed: OnMalformed,
): Observation | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    onMalformed(source, 'top-level YAML is not a mapping; skipping');
    return null;
  }
  const obj = data as Record<string, unknown>;
  try {
    const kind = parseObservationKind(obj['kind']);
    const props: {
      id: ObservationId;
      by: MemberName;
      at: string;
      body: ReturnType<typeof hydrateObservationBody>;
      subject?: RequestId;
      source?: string;
    } = {
      id: ObservationId.of(obj['id']),
      by: MemberName.of(obj['by']),
      at: String(obj['at'] ?? ''),
      // Re-validated on read: a record hand-edited into an
      // inconsistent state must fail now, not be trusted because it
      // passed validation once on write.
      body: hydrateObservationBody(kind, obj['envelope']),
    };
    if (typeof obj['subject'] === 'string') {
      props.subject = RequestId.of(obj['subject']);
    }
    if (typeof obj['source'] === 'string') {
      props.source = obj['source'];
    }
    return Observation.restore(props);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const idHint = typeof obj['id'] === 'string' ? ` (id=${obj['id']})` : '';
    onMalformed(source, `hydrate failed${idHint}, skipping record: ${msg}`);
    return null;
  }
}
