import { MemberName } from '../../domain/member/MemberName.js';

export interface Notification {
  from: string;
  to: MemberName;
  type: string;
  text: string;
  related?: string;
  at?: string;
}

/**
 * One message as seen from inside an inbox. The shape is independent of
 * how the inbox is stored — consumers must not assume YAML or files.
 */
export interface InboxMessage {
  from: string;
  to: string;
  type: string;
  text: string;
  at: string;
  read: boolean;
  /** ISO-8601 timestamp when mark-read was applied. Undefined until read. */
  readAt?: string;
  related?: string;
}

/**
 * Result of a mark-read operation: how many messages had their `read`
 * field flipped to true. Messages already marked read are not counted
 * (idempotent).
 */
export interface MarkReadResult {
  marked: number;
  alreadyRead: number;
  total: number;
}

export interface NotificationPort {
  /** Append a notification to `to`'s inbox. */
  post(notification: Notification): Promise<void>;
  /** Return all messages for `member` in insertion order. */
  listFor(member: MemberName): Promise<InboxMessage[]>;
  /**
   * Mark messages in `member`'s inbox as read. When `index` is given,
   * only that 1-based message is marked; otherwise every unread
   * message is marked. Already-read messages are left alone
   * (idempotent) and counted separately.
   *
   * Throws `DomainError` if `index` is out of range.
   */
  markRead(
    member: MemberName,
    readAt: string,
    index?: number,
  ): Promise<MarkReadResult>;
}
