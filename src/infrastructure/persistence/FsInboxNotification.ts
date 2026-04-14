import YAML from 'yaml';
import { join } from 'node:path';
import {
  InboxMessage,
  Notification,
  NotificationPort,
} from '../../application/ports/NotificationPort.js';
import { MemberName } from '../../domain/member/MemberName.js';
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
  if (typeof raw['related'] === 'string') msg.related = raw['related'];
  return msg;
}

// silence unused
void join;
