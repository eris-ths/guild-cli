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
}

/**
 * Closure notes (completed/denied/failed) live in `status_log[-1].note`
 * as the single source of truth. toJSON derives the legacy top-level
 * keys (`completion_note` / `deny_reason` / `failure_reason`) from the
 * log so external readers stay stable while the domain keeps one place
 * to write. Restore may receive the legacy keys from older files; they
 * are used only to backfill a missing log note, never stored separately.
 */
export class Request {
  private constructor(
    private props: RequestProps,
    private readonly _loadedVersion: number,
  ) {}

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
    // New requests have no on-disk predecessor; loadedVersion=0 marks
    // "never seen" for the optimistic-lock check in save().
    return new Request(props, 0);
  }

  static restore(props: RequestProps): Request {
    // loadedVersion snapshots the TOTAL mutation count at load time —
    // status_log entries PLUS reviews. Using status_log alone would
    // miss concurrent addReview races (reviews push into reviews[]
    // without touching status_log), letting two simultaneous reviewers
    // silently lose one review on last-writer-wins. See
    // `computeVersion` below for the single place that defines the
    // invariant.
    return new Request({ ...props }, computeVersion(props.statusLog.length, props.reviews.length));
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
  /**
   * Total mutation count observed when this aggregate was loaded from
   * disk (0 for freshly-created instances). Defined as
   * `status_log.length + reviews.length` — both arrays are append-only,
   * so their combined length is a monotonic version. The repository
   * uses it as an optimistic-lock token: if the on-disk total has
   * grown since, another writer won the race and our save is rejected.
   */
  get loadedVersion(): number {
    return this._loadedVersion;
  }

  /**
   * Current total mutation count. Equivalent to the version the
   * repository will write with, so `loadedVersion` + delta = `currentVersion`.
   */
  get currentVersion(): number {
    return computeVersion(this.props.statusLog.length, this.props.reviews.length);
  }

  approve(by: MemberName, note?: string): void {
    this.transition('approved', by, note);
  }

  deny(by: MemberName, reason: string): void {
    this.transition('denied', by, reason);
  }

  execute(by: MemberName, note?: string): void {
    this.transition('executing', by, note);
  }

  complete(by: MemberName, note?: string): void {
    this.transition('completed', by, note);
  }

  fail(by: MemberName, reason: string): void {
    this.transition('failed', by, reason);
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
    // Derive legacy closure keys from the last status_log entry so
    // external consumers (chain / voices / show --format text) keep
    // working unchanged. Single source of truth: status_log[-1].note.
    const last = this.props.statusLog[this.props.statusLog.length - 1];
    if (last && last.note !== undefined) {
      if (last.state === 'completed') out['completion_note'] = last.note;
      else if (last.state === 'denied') out['deny_reason'] = last.note;
      else if (last.state === 'failed') out['failure_reason'] = last.note;
    }
    return out;
  }
}

/**
 * Total mutation count: status_log entries + reviews. Both arrays are
 * append-only so the sum is monotonic across any legal transition.
 * Kept as a module-private helper so the invariant is defined in one
 * place and the repository can reuse it when reading raw YAML.
 */
export function computeVersion(statusLogLen: number, reviewsLen: number): number {
  return statusLogLen + reviewsLen;
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
