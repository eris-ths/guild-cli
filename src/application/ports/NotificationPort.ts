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
  related?: string;
}

export interface NotificationPort {
  /** Append a notification to `to`'s inbox. */
  post(notification: Notification): Promise<void>;
  /** Return all messages for `member` in insertion order. */
  listFor(member: MemberName): Promise<InboxMessage[]>;
}
