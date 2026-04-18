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
  /**
   * Actual invoker when different from `by`. Mirrors inbox.read_by:
   * `by` is to whom the act is attributed (the member on record);
   * `invoked_by` is who actually ran the CLI command. Typically this
   * is the AI agent proxying for a human operator — without the
   * field, "eris approved" and "an AI approved on eris's behalf"
   * are indistinguishable in YAML. Undefined when the two agree
   * (the common case, so existing records stay byte-identical).
   */
  invokedBy?: string;
}

export interface RequestProps {
  id: RequestId;
  from: MemberName;
  action: string;
  reason: string;
  executor?: MemberName;
  target?: string;
  autoReview?: MemberName;
  /**
   * Dialogue partners during the formation of this request — who was
   * WITH the author when the decision was shaped. Empty/undefined =
   * solo. Order is meaningful: listed as given, no reordering, so a
   * reader can see "primary partner" first.
   *
   * This is pair-mode Layer 1 (fact, transient). Layer 2 (durable
   * kinship on Member) and Layer 3 (content-root policy in config)
   * are deferred until the need surfaces in actual use.
   */
  with?: MemberName[];
  /**
   * Tool-generated structured link to the issue this request was
   * promoted from (via `gate issues promote`). Populated by the
   * promote orchestration; undefined for plain `gate request`.
   * Distinct from text mentions in action/reason: chain uses this
   * as a separate-from-text-scan reference path so the link
   * survives full overrides of --action AND --reason. Same shape as
   * other tool-generated relationship fields (executor, autoReview).
   */
  promotedFrom?: string;
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
    with?: readonly string[];
    createdAt?: string;
    /**
     * Actual CLI invoker when different from `from`. Same invariant
     * as status_log transitions: stamped only when the two diverge
     * (typical case = an AI agent filing on a human's behalf), so
     * same-actor creation leaves the initial status_log entry
     * byte-identical to pre-invariant YAML.
     */
    invokedBy?: string;
    /** See RequestProps.promotedFrom — issue id this request was
     *  promoted from. Populated by `gate issues promote` only. */
    promotedFrom?: string;
  }): Request {
    const from = MemberName.of(input.from);
    const action = sanitizeText(input.action, 'action');
    const reason = sanitizeText(input.reason, 'reason');
    const createdAt = input.createdAt ?? new Date().toISOString();
    const initialEntry: StatusLogEntry = {
      state: 'pending',
      by: from.value,
      at: createdAt,
      note: 'created',
    };
    if (
      input.invokedBy !== undefined &&
      input.invokedBy !== from.value
    ) {
      initialEntry.invokedBy = input.invokedBy;
    }
    const props: RequestProps = {
      id: input.id,
      from,
      action,
      reason,
      state: 'pending',
      createdAt,
      reviews: [],
      statusLog: [initialEntry],
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
    if (input.with !== undefined && input.with.length > 0) {
      // Deduplicate while preserving first-mention order — avoids
      // "with eris, eris" if callers normalize casing differently.
      // Self is rejected: "with self" is noise, not signal.
      const fromLower = from.value;
      const seen = new Set<string>();
      const list: MemberName[] = [];
      for (const raw of input.with) {
        const m = MemberName.of(raw);
        if (m.value === fromLower) continue;
        if (seen.has(m.value)) continue;
        seen.add(m.value);
        list.push(m);
      }
      if (list.length > 0) props.with = list;
    }
    if (input.promotedFrom !== undefined) {
      props.promotedFrom = input.promotedFrom;
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
  get promotedFrom(): string | undefined {
    return this.props.promotedFrom;
  }
  get with(): readonly MemberName[] {
    return this.props.with ?? [];
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

  approve(by: MemberName, note?: string, invokedBy?: string): void {
    this.transition('approved', by, note, invokedBy);
  }

  deny(by: MemberName, reason: string, invokedBy?: string): void {
    this.transition('denied', by, reason, invokedBy);
  }

  execute(by: MemberName, note?: string, invokedBy?: string): void {
    this.transition('executing', by, note, invokedBy);
  }

  complete(by: MemberName, note?: string, invokedBy?: string): void {
    this.transition('completed', by, note, invokedBy);
  }

  fail(by: MemberName, reason: string, invokedBy?: string): void {
    this.transition('failed', by, reason, invokedBy);
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
    invokedBy?: string,
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
    // Only stamp `invoked_by` when it genuinely differs from `by` —
    // a same-actor invocation is the common case and would just clutter
    // YAML with redundant fields.
    if (invokedBy !== undefined && invokedBy !== by.value) {
      entry.invokedBy = invokedBy;
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
      status_log: this.props.statusLog.map((e) => statusLogEntryToJSON(e)),
      reviews: this.props.reviews.map((r) => r.toJSON()),
    };
    if (this.props.executor) out['executor'] = this.props.executor.value;
    if (this.props.autoReview)
      out['auto_review'] = this.props.autoReview.value;
    if (this.props.target !== undefined) out['target'] = this.props.target;
    if (this.props.with && this.props.with.length > 0)
      out['with'] = this.props.with.map((m) => m.value);
    if (this.props.promotedFrom !== undefined)
      out['promoted_from'] = this.props.promotedFrom;
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

// Serialize a status_log entry with the wire-level field names
// (snake_case). The camelCase `invokedBy` lives in memory only so
// consumers reading YAML / JSON see `invoked_by` consistently with
// `read_by` on inbox entries.
function statusLogEntryToJSON(e: StatusLogEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {
    state: e.state,
    by: e.by,
    at: e.at,
  };
  if (e.note !== undefined) out['note'] = e.note;
  if (e.invokedBy !== undefined) out['invoked_by'] = e.invokedBy;
  return out;
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
