import YAML from 'yaml';
import {
  Issue,
  IssueId,
  IssueNote,
  IssueState,
  IssueStateLogEntry,
  computeIssueVersion,
  parseIssueSeverity,
  parseIssueState,
} from '../../domain/issue/Issue.js';
import { MemberName } from '../../domain/member/MemberName.js';
import {
  IssueRepository,
  IssueIdCollision,
  IssueVersionConflict,
} from '../../application/ports/IssueRepository.js';
import { UnrecognizedRecordEntry } from '../../application/ports/UnrecognizedRecordEntry.js';
import {
  MAX_DIR_ENTRIES,
  existsSafe,
  listDirSafe,
  readTextSafe,
  writeTextSafe,
  writeTextSafeAtomic,
} from './safeFs.js';
import { join } from 'node:path';
import { lstatSync, type Stats } from 'node:fs';
import { GuildConfig } from '../config/GuildConfig.js';
import { OnMalformed } from '../../application/ports/OnMalformed.js';
import { parseYamlSafe } from './parseYamlSafe.js';

// Single source of truth for the on-disk issue filename pattern.
// listAll filters by it; listUnrecognizedFiles surfaces any .yaml
// that does NOT match. Defined once so the two paths cannot drift.
const FILE_PATTERN = /^i-\d{4}-\d{2}-\d{2}-\d{3,4}\.yaml$/;

// Best-effort lstat — returns null for entries that disappear between
// the listing and the stat call. Diagnostic shouldn't crash on races,
// so a missing entry just gets dropped from the finding set. Mirrors
// the helper in YamlRequestRepository.
function lstatSafe(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

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
      .slice(0, MAX_DIR_ENTRIES);
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

  async listUnrecognizedFiles(): Promise<UnrecognizedRecordEntry[]> {
    // Scope: .yaml files only — repo authors may legitimately leave
    // notes.txt / README.md / .gitkeep here. Subdirectories ARE
    // surfaced (issues is a flat layout; nested dirs have no
    // legitimate place). The diagnostic targets *attempted records*,
    // not arbitrary repo artifacts.
    const out: UnrecognizedRecordEntry[] = [];
    const entries = listDirSafe(this.config.paths.issues, '.');
    for (const name of entries) {
      const abs = join(this.config.paths.issues, name);
      const stat = lstatSafe(abs);
      if (stat === null) continue;
      if (stat.isDirectory()) {
        out.push({
          path: abs,
          kind: 'directory',
          reason: `subdirectory under issues/ — no legitimate place for nested directories in the issue layout`,
        });
        continue;
      }
      if (!name.endsWith('.yaml')) continue;
      if (FILE_PATTERN.test(name)) continue;
      out.push({
        path: abs,
        kind: 'file',
        reason: `.yaml filename does not match i-YYYY-MM-DD-NNNN.yaml — likely typo or hand-edited`,
      });
    }
    return out;
  }

  async save(issue: Issue): Promise<void> {
    const rel = `${issue.id.value}.yaml`;
    // Optimistic-lock CAS: right before the atomic write, re-read the
    // on-disk state_log + notes lengths and compare against the value
    // we loaded. Concurrent writers detect each other this way. The
    // window between re-read and rename is small but non-zero — same
    // trade-off as Request / Inbox repositories.
    //
    // Unlike YamlRequestRepository, there is no loadedVersion===0
    // guard here: Request uses that sentinel for "fresh vs loaded"
    // because its mutation count (status_log.length) starts at 1 on
    // create. Issue's starts at 0 (empty state_log AND empty notes),
    // so 0 is a legitimate load result for a just-saved issue that
    // has never been mutated. saveNew's EEXIST check is the actual
    // collision gate for the create path.
    if (existsSafe(this.config.paths.issues, rel)) {
      const rawCheck = readTextSafe(this.config.paths.issues, rel);
      const absCheck = join(this.config.paths.issues, rel);
      const parsedCheck = parseYamlSafe(
        rawCheck,
        absCheck,
        this.config.onMalformed,
      );
      const onDiskVersion = readIssueVersion(parsedCheck);
      if (onDiskVersion !== issue.loadedVersion) {
        throw new IssueVersionConflict(
          issue.id.value,
          issue.loadedVersion,
          onDiskVersion,
        );
      }
    }
    const text = YAML.stringify(issue.toJSON());
    writeTextSafeAtomic(this.config.paths.issues, rel, text);
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
      stateLog: hydrateStateLog(obj['state_log'], source, onMalformed),
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

function hydrateStateLog(
  raw: unknown,
  source: string,
  onMalformed: OnMalformed,
): IssueStateLogEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: IssueStateLogEntry[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!entry || typeof entry !== 'object') {
      onMalformed(source, `state_log[${i}] is not a mapping; skipping`);
      continue;
    }
    const r = entry as Record<string, unknown>;
    const stateRaw = typeof r['state'] === 'string' ? r['state'] : '';
    const by = typeof r['by'] === 'string' ? r['by'] : '';
    const at = typeof r['at'] === 'string' ? r['at'] : '';
    if (!stateRaw || !by || !at) {
      onMalformed(
        source,
        `state_log[${i}] missing required fields (state/by/at); skipping`,
      );
      continue;
    }
    let state: IssueState;
    try {
      state = parseIssueState(stateRaw);
    } catch {
      onMalformed(
        source,
        `state_log[${i}] has unknown state "${stateRaw}"; skipping`,
      );
      continue;
    }
    const logEntry: IssueStateLogEntry = { state, by, at };
    if (typeof r['invoked_by'] === 'string') logEntry.invokedBy = r['invoked_by'];
    out.push(logEntry);
  }
  return out;
}

/**
 * Read the total mutation count from raw parsed YAML using the same
 * `computeIssueVersion` invariant the domain uses. Defined here (not
 * just on Issue) so the repository can compare on-disk state without
 * hydrating a full Issue — a malformed or torn file returns 0, forcing
 * the caller to reload rather than proceed on incomplete data.
 *
 * Mirrors `readVersion` in YamlRequestRepository.ts.
 */
function readIssueVersion(parsed: unknown): number {
  if (!parsed || typeof parsed !== 'object') return 0;
  const obj = parsed as Record<string, unknown>;
  const stateLogLen = Array.isArray(obj['state_log'])
    ? obj['state_log'].length
    : 0;
  const notesLen = Array.isArray(obj['notes']) ? obj['notes'].length : 0;
  return computeIssueVersion(stateLogLen, notesLen);
}
