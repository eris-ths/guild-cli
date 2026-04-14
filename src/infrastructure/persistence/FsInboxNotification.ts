import YAML from 'yaml';
import { join } from 'node:path';
import {
  Notification,
  NotificationPort,
} from '../../application/ports/NotificationPort.js';
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
}

// silence unused
void join;
