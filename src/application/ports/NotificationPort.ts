import { MemberName } from '../../domain/member/MemberName.js';

export interface Notification {
  from: string;
  to: MemberName;
  type: string;
  text: string;
  related?: string;
  at?: string;
  /**
   * Actual CLI invoker when different from `from`. Mirrors the
   * `read_by` pattern on the receive side: `from` is who the
   * message is attributed to (the member on record); `invokedBy`
   * is who actually ran `gate message` / `gate broadcast`. Only
   * stamped when they disagree.
   */
  invokedBy?: string;
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
  /**
   * Actor who ran `mark-read`. Usually equals the inbox owner, but may
   * differ when someone else uses `--for <other>` (e.g. a human
   * operator acknowledging on an AI's behalf). Recorded so that
   * "sentinel acknowledged this" vs "eris marked it read for sentinel"
   * stays distinguishable in audits. Undefined for messages read
   * before this field was introduced.
   */
  readBy?: string;
  /**
   * Actor who ran `gate message` / `gate broadcast` when different
   * from `from`. Same invariant as the rest: stamped only when they
   * disagree. Receivers can see which messages were ghost-sent
   * without having to chase the sender's status log.
   */
  invokedBy?: string;
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

/**
 * Thrown when a concurrent writer modified the inbox file between the
 * moment we loaded it and the moment we tried to write it back. Pairs
 * with `RequestVersionConflict` — the mechanism is the same:
 * optimistic lock via a monotonic version counter stored in the file.
 *
 * The inbox is a read-modify-write surface (post appends, markRead
 * mutates), and without this guard two concurrent writers would
 * last-writer-wins, dropping the earlier message or read flag
 * silently. Throwing forces the caller to retry on a fresh read.
 */
export class InboxVersionConflict extends Error {
  readonly code = 'INBOX_VERSION_CONFLICT' as const;
  constructor(
    readonly member: string,
    readonly expected: number,
    readonly found: number,
  ) {
    super(
      `inbox for ${member} was modified concurrently ` +
        `(expected version ${expected}, found ${found}). ` +
        `Re-run the command to retry.`,
    );
    this.name = 'InboxVersionConflict';
  }
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
   * `readBy` is the actor that issued the mark — usually equal to
   * `member`, but may differ when one actor acknowledges on another's
   * behalf via `--for`. Persisted alongside `readAt` so the trace
   * stays honest about who did the reading.
   *
   * Throws `DomainError` if `index` is out of range.
   */
  markRead(
    member: MemberName,
    readAt: string,
    readBy: string,
    index?: number,
  ): Promise<MarkReadResult>;
}
