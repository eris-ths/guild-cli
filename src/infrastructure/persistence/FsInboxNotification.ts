import YAML from 'yaml';
import {
  InboxMessage,
  InboxVersionConflict,
  MarkReadResult,
  Notification,
  NotificationPort,
} from '../../application/ports/NotificationPort.js';
import { MemberName } from '../../domain/member/MemberName.js';
import { DomainError } from '../../domain/shared/DomainError.js';
import {
  existsSafe,
  readTextSafe,
  writeTextSafeAtomic,
} from './safeFs.js';
import { join } from 'node:path';
import { GuildConfig } from '../config/GuildConfig.js';
import { parseYamlSafe } from './parseYamlSafe.js';

const MAX_INBOX_SIZE = 500;

/**
 * On-disk shape of an inbox file.
 *
 * `version` is an optimistic-lock counter: every successful write (post
 * or markRead that actually changed something) increments it by 1.
 * Concurrent writers detect each other by comparing the loaded version
 * against what's on disk right before the atomic rename.
 *
 * Legacy files (pre-version field) hydrate as `version: 0` so the very
 * first save-after-upgrade proceeds without a false conflict.
 */
interface InboxFile {
  version?: number;
  messages: Array<Record<string, unknown>>;
}

/**
 * Inbox file: <paths.inbox>/<to>.yaml → { messages: [...] }
 * Capped at MAX_INBOX_SIZE (FIFO — oldest dropped).
 */
export class FsInboxNotification implements NotificationPort {
  constructor(private readonly config: GuildConfig) {}

  async post(n: Notification): Promise<void> {
    const rel = `${n.to.value}.yaml`;
    const { file, version: loadedVersion } = this.readWithVersion(rel);
    const entry: Record<string, unknown> = {
      from: n.from,
      to: n.to.value,
      type: n.type,
      text: n.text,
      at: n.at ?? new Date().toISOString(),
      read: false,
    };
    if (n.related !== undefined) entry['related'] = n.related;
    if (n.invokedBy !== undefined) entry['invoked_by'] = n.invokedBy;
    file.messages.push(entry);
    if (file.messages.length > MAX_INBOX_SIZE) {
      file.messages = file.messages.slice(-MAX_INBOX_SIZE);
    }
    file.version = loadedVersion + 1;
    this.writeWithCas(n.to.value, rel, file, loadedVersion);
  }

  async listFor(member: MemberName): Promise<InboxMessage[]> {
    const rel = `${member.value}.yaml`;
    if (!existsSafe(this.config.paths.inbox, rel)) return [];
    const raw = readTextSafe(this.config.paths.inbox, rel);
    const absSource = join(this.config.paths.inbox, rel);
    const data = parseYamlSafe(raw, absSource, this.config.onMalformed);
    const parsed = data as InboxFile | undefined;
    if (!parsed || !Array.isArray(parsed.messages)) return [];
    return parsed.messages.map((m) => normalizeMessage(m));
  }

  async markRead(
    member: MemberName,
    readAt: string,
    readBy: string,
    index?: number,
  ): Promise<MarkReadResult> {
    const rel = `${member.value}.yaml`;
    if (!existsSafe(this.config.paths.inbox, rel)) {
      return { marked: 0, alreadyRead: 0, total: 0 };
    }
    const { file, version: loadedVersion } = this.readWithVersion(rel);
    const raw = file.messages;
    const total = raw.length;

    // Validate index bounds before mutating anything so callers see
    // a DomainError rather than a partially-applied write.
    if (index !== undefined) {
      if (!Number.isInteger(index) || index < 1 || index > total) {
        throw new DomainError(
          `inbox index out of range: ${index} (inbox has ${total} message(s))`,
          'index',
        );
      }
    }

    let marked = 0;
    let alreadyRead = 0;
    for (let i = 0; i < raw.length; i++) {
      if (index !== undefined && i + 1 !== index) continue;
      const entry = raw[i];
      if (!entry || typeof entry !== 'object') continue;
      if (entry['read'] === true) {
        alreadyRead++;
        continue;
      }
      entry['read'] = true;
      // read_at lets future audits distinguish "read 10 seconds after
      // receipt" from "read three days later". The post timestamp
      // (at) is preserved untouched.
      entry['read_at'] = readAt;
      // read_by records who actually ran the mark — usually the inbox
      // owner, but may differ when `--for <other>` is used. Without
      // this, an eris-as-sentinel mark-read is indistinguishable from
      // a real sentinel acknowledgment.
      entry['read_by'] = readBy;
      marked++;
    }

    if (marked > 0) {
      file.version = loadedVersion + 1;
      this.writeWithCas(member.value, rel, file, loadedVersion);
    }
    return { marked, alreadyRead, total };
  }

  /**
   * Read an inbox file and its optimistic-lock version. A missing file
   * is treated as `{ version: 0, messages: [] }` so the first post can
   * proceed; a malformed YAML body is also coerced to that empty state
   * via the shared onMalformed handler (same fallback policy as the
   * request repository).
   */
  private readWithVersion(rel: string): {
    file: InboxFile;
    version: number;
  } {
    if (!existsSafe(this.config.paths.inbox, rel)) {
      return { file: { messages: [], version: 0 }, version: 0 };
    }
    const raw = readTextSafe(this.config.paths.inbox, rel);
    const absSource = join(this.config.paths.inbox, rel);
    const data = parseYamlSafe(raw, absSource, this.config.onMalformed);
    const parsed = (data as InboxFile | undefined) ?? {
      messages: [],
      version: 0,
    };
    if (!Array.isArray(parsed.messages)) parsed.messages = [];
    const version =
      typeof parsed.version === 'number' && parsed.version >= 0
        ? parsed.version
        : 0;
    return { file: parsed, version };
  }

  /**
   * Atomic write with compare-and-swap on the version counter. Right
   * before the rename, re-read the on-disk version; if it's grown
   * since the caller loaded, a concurrent writer beat us — throw so
   * the caller can retry on fresh data.
   *
   * The CAS window (between re-read and rename) is small but non-zero.
   * This matches the YamlRequestRepository pattern and is acceptable
   * for single-host, single-user-at-a-time usage. For multi-process
   * hardening, a lock file would close the window further; out of
   * scope for this PR.
   */
  private writeWithCas(
    member: string,
    rel: string,
    file: InboxFile,
    loadedVersion: number,
  ): void {
    if (existsSafe(this.config.paths.inbox, rel)) {
      const { version: currentVersion } = this.readWithVersion(rel);
      if (currentVersion !== loadedVersion) {
        throw new InboxVersionConflict(member, loadedVersion, currentVersion);
      }
    }
    writeTextSafeAtomic(
      this.config.paths.inbox,
      rel,
      YAML.stringify(file),
    );
  }
}

function normalizeMessage(raw: Record<string, unknown>): InboxMessage {
  const msg: InboxMessage = {
    from: String(raw['from'] ?? ''),
    to: String(raw['to'] ?? ''),
    type: String(raw['type'] ?? ''),
    text: String(raw['text'] ?? ''),
    at: String(raw['at'] ?? ''),
    read: raw['read'] === true,
  };
  if (typeof raw['read_at'] === 'string') msg.readAt = raw['read_at'];
  if (typeof raw['read_by'] === 'string') msg.readBy = raw['read_by'];
  if (typeof raw['invoked_by'] === 'string') msg.invokedBy = raw['invoked_by'];
  if (typeof raw['related'] === 'string') msg.related = raw['related'];
  return msg;
}
