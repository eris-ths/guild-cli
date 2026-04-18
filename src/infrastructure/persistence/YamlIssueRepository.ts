import YAML from 'yaml';
import {
  Issue,
  IssueId,
  IssueNote,
  IssueState,
  parseIssueSeverity,
  parseIssueState,
} from '../../domain/issue/Issue.js';
import { MemberName } from '../../domain/member/MemberName.js';
import {
  IssueRepository,
  IssueIdCollision,
} from '../../application/ports/IssueRepository.js';
import {
  existsSafe,
  listDirSafe,
  readTextSafe,
  writeTextSafe,
} from './safeFs.js';
import { join } from 'node:path';
import { GuildConfig } from '../config/GuildConfig.js';
import { OnMalformed } from '../../application/ports/OnMalformed.js';
import { parseYamlSafe } from './parseYamlSafe.js';

const FILE_PATTERN = /^i-\d{4}-\d{2}-\d{2}-\d{3,4}\.yaml$/;

export class YamlIssueRepository implements IssueRepository {
  constructor(private readonly config: GuildConfig) {}

  async findById(id: IssueId): Promise<Issue | null> {
    const rel = `${id.value}.yaml`;
    if (!existsSafe(this.config.paths.issues, rel)) return null;
    const raw = readTextSafe(this.config.paths.issues, rel);
    const absSource = join(this.config.paths.issues, rel);
    const parsed = parseYamlSafe(raw, absSource, this.config.onMalformed);
    if (parsed === undefined) return null;
    return hydrate(parsed, absSource, this.config.onMalformed);
  }

  async listByState(state: IssueState): Promise<Issue[]> {
    const all = await this.listAll();
    return all.filter((issue) => issue.state === state);
  }

  async listAll(): Promise<Issue[]> {
    const files = listDirSafe(this.config.paths.issues, '.')
      .filter((f) => FILE_PATTERN.test(f))
      .slice(0, 1000);
    const out: Issue[] = [];
    for (const f of files) {
      const raw = readTextSafe(this.config.paths.issues, f);
      const absSource = join(this.config.paths.issues, f);
      const parsed = parseYamlSafe(raw, absSource, this.config.onMalformed);
      if (parsed === undefined) continue;
      const issue = hydrate(parsed, absSource, this.config.onMalformed);
      if (issue) out.push(issue);
    }
    return out;
  }

  async save(issue: Issue): Promise<void> {
    const rel = `${issue.id.value}.yaml`;
    const text = YAML.stringify(issue.toJSON());
    writeTextSafe(this.config.paths.issues, rel, text);
  }

  async saveNew(issue: Issue): Promise<void> {
    const rel = `${issue.id.value}.yaml`;
    if (existsSafe(this.config.paths.issues, rel)) {
      throw new IssueIdCollision(issue.id.value);
    }
    const text = YAML.stringify(issue.toJSON());
    try {
      writeTextSafe(this.config.paths.issues, rel, text, {
        createOnly: true,
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new IssueIdCollision(issue.id.value);
      }
      throw e;
    }
  }

  async nextSequence(dateKey: string): Promise<number> {
    let max = 0;
    for (const f of listDirSafe(this.config.paths.issues, '.')) {
      const m = f.match(/^i-(\d{4}-\d{2}-\d{2})-(\d{3,4})\.yaml$/);
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
): Issue | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    onMalformed(source, 'top-level YAML is not a mapping; skipping');
    return null;
  }
  const obj = data as Record<string, unknown>;
  try {
    const id = IssueId.of(obj['id']);
    const restoreInput: Parameters<typeof Issue.restore>[0] = {
      id,
      from: MemberName.of(obj['from']),
      severity: parseIssueSeverity(String(obj['severity'])),
      area: String(obj['area']),
      text: String(obj['text']),
      state: parseIssueState(String(obj['state'] ?? 'open')),
      createdAt: String(obj['created_at'] ?? new Date().toISOString()),
      notes: hydrateNotes(obj['notes'], source, onMalformed),
    };
    if (typeof obj['invoked_by'] === 'string') {
      restoreInput.invokedBy = obj['invoked_by'];
    }
    const issue = Issue.restore(restoreInput);
    return issue;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const idHint = typeof obj['id'] === 'string' ? ` (id=${obj['id']})` : '';
    onMalformed(
      source,
      `hydrate failed${idHint}, skipping record: ${msg}`,
    );
    return null;
  }
}

function hydrateNotes(
  raw: unknown,
  source: string,
  onMalformed: OnMalformed,
): IssueNote[] {
  if (!Array.isArray(raw)) return [];
  const out: IssueNote[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!entry || typeof entry !== 'object') {
      onMalformed(source, `notes[${i}] is not a mapping; skipping`);
      continue;
    }
    const r = entry as Record<string, unknown>;
    const by = typeof r['by'] === 'string' ? r['by'] : '';
    const text = typeof r['text'] === 'string' ? r['text'] : '';
    const at = typeof r['at'] === 'string' ? r['at'] : '';
    if (!by || !text || !at) {
      onMalformed(
        source,
        `notes[${i}] missing required fields (by/text/at); skipping`,
      );
      continue;
    }
    const note: IssueNote = { by, text, at };
    if (typeof r['invoked_by'] === 'string') note.invokedBy = r['invoked_by'];
    out.push(note);
  }
  return out;
}
