import YAML from 'yaml';
import {
  Issue,
  IssueId,
  IssueState,
  parseIssueSeverity,
  parseIssueState,
} from '../../domain/issue/Issue.js';
import { MemberName } from '../../domain/member/MemberName.js';
import { IssueRepository } from '../../application/ports/IssueRepository.js';
import {
  existsSafe,
  listDirSafe,
  readTextSafe,
  writeTextSafe,
} from './safeFs.js';
import { GuildConfig } from '../config/GuildConfig.js';

const FILE_PATTERN = /^i-\d{4}-\d{2}-\d{2}-\d{3}\.yaml$/;

export class YamlIssueRepository implements IssueRepository {
  constructor(private readonly config: GuildConfig) {}

  async findById(id: IssueId): Promise<Issue | null> {
    const rel = `${id.value}.yaml`;
    if (!existsSafe(this.config.paths.issues, rel)) return null;
    const raw = readTextSafe(this.config.paths.issues, rel);
    return hydrate(YAML.parse(raw));
  }

  async listByState(state: IssueState): Promise<Issue[]> {
    const files = listDirSafe(this.config.paths.issues, '.')
      .filter((f) => FILE_PATTERN.test(f))
      .slice(0, 1000);
    const out: Issue[] = [];
    for (const f of files) {
      const raw = readTextSafe(this.config.paths.issues, f);
      const issue = hydrate(YAML.parse(raw));
      if (issue && issue.state === state) out.push(issue);
    }
    return out;
  }

  async save(issue: Issue): Promise<void> {
    const rel = `${issue.id.value}.yaml`;
    const text = YAML.stringify(issue.toJSON());
    writeTextSafe(this.config.paths.issues, rel, text);
  }

  async nextSequence(dateKey: string): Promise<number> {
    let max = 0;
    for (const f of listDirSafe(this.config.paths.issues, '.')) {
      const m = f.match(/^i-(\d{4}-\d{2}-\d{2})-(\d{3})\.yaml$/);
      if (m && m[1] === dateKey) {
        const n = parseInt(m[2] as string, 10);
        if (n > max) max = n;
      }
    }
    return max + 1;
  }
}

function hydrate(data: unknown): Issue | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }
  const obj = data as Record<string, unknown>;
  try {
    const id = IssueId.of(obj['id']);
    const issue = Issue.restore({
      id,
      from: MemberName.of(obj['from']),
      severity: parseIssueSeverity(String(obj['severity'])),
      area: String(obj['area']),
      text: String(obj['text']),
      state: parseIssueState(String(obj['state'] ?? 'open')),
      createdAt: String(obj['created_at'] ?? new Date().toISOString()),
    });
    return issue;
  } catch {
    return null;
  }
}
