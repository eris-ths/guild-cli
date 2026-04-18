import YAML from 'yaml';
import {
  InboxMessage,
  MarkReadResult,
  Notification,
  NotificationPort,
} from '../../application/ports/NotificationPort.js';
import { MemberName } from '../../domain/member/MemberName.js';
import { DomainError } from '../../domain/shared/DomainError.js';
import {
  existsSafe,
  readTextSafe,
  writeTextSafe,
} from './safeFs.js';
import { GuildConfig } from '../config/GuildConfig.js';

const MAX_INBOX_SIZE = 500;

interface InboxFile {
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
    const file: InboxFile = existsSafe(this.config.paths.inbox, rel)
      ? (YAML.parse(readTextSafe(this.config.paths.inbox, rel)) ?? {
          messages: [],
        })
      : { messages: [] };
    if (!Array.isArray(file.messages)) file.messages = [];
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
    writeTextSafe(this.config.paths.inbox, rel, YAML.stringify(file));
  }

  async listFor(member: MemberName): Promise<InboxMessage[]> {
    const rel = `${member.value}.yaml`;
    if (!existsSafe(this.config.paths.inbox, rel)) return [];
    const parsed = YAML.parse(readTextSafe(this.config.paths.inbox, rel)) as
      | InboxFile
      | null;
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
    const parsed = YAML.parse(readTextSafe(this.config.paths.inbox, rel)) as
      | InboxFile
      | null;
    const raw =
      parsed && Array.isArray(parsed.messages) ? parsed.messages : [];
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
      const file: InboxFile = { messages: raw };
      writeTextSafe(this.config.paths.inbox, rel, YAML.stringify(file));
    }
    return { marked, alreadyRead, total };
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
