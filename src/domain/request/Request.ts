import { RequestId } from './RequestId.js';
import {
  RequestState,
  assertTransition,
  parseRequestState,
} from './RequestState.js';
import { Review } from './Review.js';
import { MemberName } from '../member/MemberName.js';
import { DomainError } from '../shared/DomainError.js';

const MAX_TEXT = 4096;
const MAX_REVIEWS = 50;
const MAX_STATUS_LOG = 100;

export interface StatusLogEntry {
  state: RequestState;
  by: string;
  at: string;
  note?: string;
}

export interface RequestProps {
  id: RequestId;
  from: MemberName;
  action: string;
  reason: string;
  executor?: MemberName;
  target?: string;
  autoReview?: MemberName;
  state: RequestState;
  createdAt: string;
  reviews: Review[];
  statusLog: StatusLogEntry[];
  completionNote?: string;
  denyReason?: string;
  failureReason?: string;
}

export class Request {
  private constructor(private props: RequestProps) {}

  static create(input: {
    id: RequestId;
    from: string;
    action: string;
    reason: string;
    executor?: string;
    target?: string;
    autoReview?: string;
    createdAt?: string;
  }): Request {
    const from = MemberName.of(input.from);
    const action = sanitizeText(input.action, 'action');
    const reason = sanitizeText(input.reason, 'reason');
    const createdAt = input.createdAt ?? new Date().toISOString();
    const props: RequestProps = {
      id: input.id,
      from,
      action,
      reason,
      state: 'pending',
      createdAt,
      reviews: [],
      statusLog: [
        { state: 'pending', by: from.value, at: createdAt, note: 'created' },
      ],
    };
    if (input.executor !== undefined) {
      props.executor = MemberName.of(input.executor);
    }
    if (input.autoReview !== undefined) {
      props.autoReview = MemberName.of(input.autoReview);
    }
    if (input.target !== undefined) {
      props.target = sanitizeText(input.target, 'target');
    }
    return new Request(props);
  }

  static restore(props: RequestProps): Request {
    return new Request({ ...props });
  }

  get id(): RequestId {
    return this.props.id;
  }
  get from(): MemberName {
    return this.props.from;
  }
  get state(): RequestState {
    return this.props.state;
  }
  get executor(): MemberName | undefined {
    return this.props.executor;
  }
  get autoReview(): MemberName | undefined {
    return this.props.autoReview;
  }
  get action(): string {
    return this.props.action;
  }
  get reason(): string {
    return this.props.reason;
  }
  get reviews(): readonly Review[] {
    return this.props.reviews;
  }
  get statusLog(): readonly StatusLogEntry[] {
    return this.props.statusLog;
  }

  approve(by: MemberName, note?: string): void {
    this.transition('approved', by, note);
  }

  deny(by: MemberName, reason: string): void {
    this.transition('denied', by, reason);
    this.props.denyReason = sanitizeText(reason, 'reason');
  }

  execute(by: MemberName, note?: string): void {
    this.transition('executing', by, note);
  }

  complete(by: MemberName, note?: string): void {
    this.transition('completed', by, note);
    if (note !== undefined) {
      this.props.completionNote = sanitizeText(note, 'note');
    }
  }

  fail(by: MemberName, reason: string): void {
    this.transition('failed', by, reason);
    this.props.failureReason = sanitizeText(reason, 'reason');
  }

  addReview(review: Review): void {
    if (this.props.reviews.length >= MAX_REVIEWS) {
      throw new DomainError(`Too many reviews (max ${MAX_REVIEWS})`, 'reviews');
    }
    this.props.reviews.push(review);
  }

  private transition(
    to: RequestState,
    by: MemberName,
    note?: string,
  ): void {
    assertTransition(this.props.state, to);
    this.props.state = to;
    if (this.props.statusLog.length >= MAX_STATUS_LOG) {
      throw new DomainError(
        `Status log overflow (max ${MAX_STATUS_LOG})`,
        'statusLog',
      );
    }
    const entry: StatusLogEntry = {
      state: to,
      by: by.value,
      at: new Date().toISOString(),
    };
    if (note !== undefined) {
      entry.note = sanitizeText(note, 'note');
    }
    this.props.statusLog.push(entry);
  }

  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      id: this.props.id.value,
      from: this.props.from.value,
      action: this.props.action,
      reason: this.props.reason,
      state: this.props.state,
      created_at: this.props.createdAt,
      status_log: this.props.statusLog,
      reviews: this.props.reviews.map((r) => r.toJSON()),
    };
    if (this.props.executor) out['executor'] = this.props.executor.value;
    if (this.props.autoReview)
      out['auto_review'] = this.props.autoReview.value;
    if (this.props.target !== undefined) out['target'] = this.props.target;
    if (this.props.completionNote !== undefined)
      out['completion_note'] = this.props.completionNote;
    if (this.props.denyReason !== undefined)
      out['deny_reason'] = this.props.denyReason;
    if (this.props.failureReason !== undefined)
      out['failure_reason'] = this.props.failureReason;
    return out;
  }
}

function sanitizeText(raw: unknown, field: string): string {
  if (typeof raw !== 'string') {
    throw new DomainError(`${field} must be a string`, field);
  }
  const cleaned = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
  if (!cleaned) {
    throw new DomainError(`${field} required`, field);
  }
  if (cleaned.length > MAX_TEXT) {
    throw new DomainError(
      `${field} too long (max ${MAX_TEXT} chars)`,
      field,
    );
  }
  return cleaned;
}

// Re-export for persistence layer
export { parseRequestState };
