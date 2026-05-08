import { RequestId } from './RequestId.js';
import {
  RequestState,
  assertTransition,
  parseRequestState,
} from './RequestState.js';
import { RequestDepth, parseRequestDepth } from './RequestDepth.js';
import { Review } from './Review.js';
import { Thank } from './Thank.js';
import { MemberName } from '../member/MemberName.js';
import { DomainError } from '../shared/DomainError.js';
import { sanitizeText as sharedSanitizeText } from '../shared/sanitizeText.js';

const MAX_TEXT = 4096;
const MAX_REVIEWS = 50;
const MAX_THANKS = 50;
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
  /**
   * Filesystem cwd at which this transition was issued. Stamped on
   * `executing` entries when a `cwd` is supplied, so the worktree-
   * isolation check (issue #231) can compare two parallel executors'
   * filesystems and refuse the second when they collide. Persisted
   * as `executing_at_cwd` to keep the field name self-documenting in
   * YAML — it's the path that was current at execute time, not a
   * generic "cwd of any actor". Absent on every non-execute entry
   * and on pre-#231 records.
   */
  executingAtCwd?: string;
}

export interface RequestProps {
  id: RequestId;
  from: MemberName;
  action: string;
  reason: string;
  /**
   * Assigned executor(s). Internal representation is always an array
   * (possibly empty); the legacy single-executor read path is exposed
   * via the `executor` getter, which returns the first element. See
   * issue #230 — the multi-executor form structurally resolves the
   * attribution race surfaced in substrate-experiment 6 (parallel-impl
   * waves where two agents both claim authorship of one request).
   *
   * Persistence: `toJSON` always emits `executors: [...]` (new form).
   * Hydrate accepts the legacy `executor: <string>` and normalises it
   * to a single-element array — old records load without migration.
   */
  executors?: MemberName[];
  target?: string;
  /**
   * Reviewer-depth advisory (issue #221). Optional; absence reads
   * as 'standard' to honour the pre-#222 default. The substrate
   * carries the signal — adjusting the reviewer's prompt to act
   * on it lives in operator/agent setup, not here. Per principle
   * 02 (advisory-not-directive), --depth shallow is an invitation
   * to point-check; the reviewer can disagree.
   */
  depth?: RequestDepth;
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
  /**
   * Worktree-isolation requirement (issue #231). When true, parallel
   * `gate execute` invocations on the same target from the SAME
   * filesystem cwd are refused — the second `execute` errors out so
   * the operator can spawn each agent in its own git worktree before
   * retrying. Filesystem-layer guard for the substrate-experiment-6
   * race that sits one layer below the multi-executor record fix
   * (#230). Set at request-creation time when the `swarm` profile
   * sees `executors.length > 1`; absent (= false) on every other
   * record, including all pre-#231 history.
   */
  requiresWorktreeIsolation?: boolean;
  state: RequestState;
  createdAt: string;
  reviews: Review[];
  /**
   * Optional — records written before the thank primitive existed
   * don't carry this field, and the repo hydrates them as undefined
   * rather than breaking. The constructor normalises to [] so the
   * internal invariant is still "always an array".
   */
  thanks?: Thank[];
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
  ) {
    // Normalise optional `thanks` so every downstream reader sees
    // an array. Old records hydrated with the field absent pick up
    // an empty list here; `addThank` and the `thanks` getter both
    // assume the array exists.
    if (this.props.thanks === undefined) this.props.thanks = [];
  }

  static create(input: {
    id: RequestId;
    from: string;
    action: string;
    reason: string;
    /** Single-executor convenience; mutually exclusive with `executors`.
     *  Both forms feed the same internal array — present here so legacy
     *  call sites that build one executor at a time (issues promote,
     *  fast-track default-to-self) keep their existing surface. */
    executor?: string;
    /** Multiple executors (issue #230). Order preserved; duplicates
     *  rejected; empty array allowed (= no executor assigned). When
     *  both `executor` and `executors` are passed, `create` throws —
     *  the interface layer should never let both through. */
    executors?: readonly string[];
    target?: string;
    /** Reviewer-depth advisory; rejected at create time if not in
     *  the RequestDepth enum. Absent = no field persisted ('standard'
     *  default at read time). See RequestProps.depth. */
    depth?: string;
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
    /** See RequestProps.requiresWorktreeIsolation — set by the
     *  interface layer when profile=swarm + executors.length > 1.
     *  Persisted as `requires_worktree_isolation: true` only when
     *  truthy; older / single-executor / standard-profile records
     *  carry no field at all (false-by-absence). Issue #231. */
    requiresWorktreeIsolation?: boolean;
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
      thanks: [],
      statusLog: [initialEntry],
    };
    // Executor(s): single + multiple are mutually exclusive at the
    // domain boundary so a confused caller (interface bug) can't
    // silently land both into the aggregate. The interface layer is
    // expected to reject the combination first — this is the second
    // line of defence.
    if (input.executor !== undefined && input.executors !== undefined) {
      throw new DomainError(
        '--executor and --executors are mutually exclusive',
        'executor',
      );
    }
    if (input.executors !== undefined) {
      const seen = new Set<string>();
      const list: MemberName[] = [];
      for (const raw of input.executors) {
        const m = MemberName.of(raw);
        if (seen.has(m.value)) {
          throw new DomainError(
            `Duplicate executor: ${m.value}`,
            'executors',
          );
        }
        seen.add(m.value);
        list.push(m);
      }
      // Empty array is allowed — same as omitting the field. Persist
      // the field only when non-empty, matching how `with` behaves.
      if (list.length > 0) props.executors = list;
    } else if (input.executor !== undefined) {
      props.executors = [MemberName.of(input.executor)];
    }
    if (input.autoReview !== undefined) {
      props.autoReview = MemberName.of(input.autoReview);
    }
    if (input.target !== undefined) {
      props.target = sanitizeText(input.target, 'target');
    }
    if (input.depth !== undefined) {
      // parseRequestDepth throws DomainError on a non-enum value, so
      // an explicit `--depth bogus` fails closed at the domain
      // boundary (interface layer can also pre-check; both paths
      // point at the same enum).
      props.depth = parseRequestDepth(input.depth);
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
    // Worktree-isolation: persist only when explicitly true. The
    // false case is represented by field absence on disk so the YAML
    // surface stays minimal (matches `depth`, `with`, `target` etc).
    // Issue #231.
    if (input.requiresWorktreeIsolation === true) {
      props.requiresWorktreeIsolation = true;
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
    return new Request({ ...props }, computeVersion(props.statusLog.length, props.reviews.length, (props.thanks ?? []).length));
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
  /** Full executor list (possibly empty). Order preserved as given.
   *  This is the only read surface for executors after #230. The
   *  former `executor` scalar getter was removed in the Devil-review
   *  pass — it returned first-of-list and seven call sites read it as
   *  if "the" executor were a singleton, silently dropping every
   *  later-listed executor (the exact attribution race the multi-
   *  executor schema was meant to resolve). When you need a single
   *  representative — display, default `--by` for execute — pick
   *  intentionally at the call site (e.g. `r.executors[0]?.value`)
   *  with a comment naming why "first" is meaningful there. */
  get executors(): readonly MemberName[] {
    return this.props.executors ?? [];
  }
  /** Membership check — preferred predicate for "is this actor an
   *  assigned executor?". Pushed onto the aggregate so call sites
   *  don't open-code `r.executors.some(m => m.value === x)` and risk
   *  drifting on case / encoding. */
  hasExecutor(name: string): boolean {
    return (this.props.executors ?? []).some((m) => m.value === name);
  }
  get target(): string | undefined {
    return this.props.target;
  }
  get depth(): RequestDepth | undefined {
    return this.props.depth;
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
  /** Issue #231 — true when the request was created under
   *  profile=swarm with multiple executors and so demands per-cwd
   *  isolation at execute time. False (or absent) on every other
   *  record, including all pre-#231 history. Read surface used by
   *  the gate execute handler to gate the cwd-collision check. */
  get requiresWorktreeIsolation(): boolean {
    return this.props.requiresWorktreeIsolation === true;
  }
  /** Most recent `executing` status_log entry's cwd, or undefined
   *  when the request has never been executed (or when the on-disk
   *  record predates #231). Returns the freshest entry so a request
   *  that re-entered `executing` (rare but possible after a `fail`-
   *  retry edit path) reflects the latest filesystem. Read by the
   *  gate execute cwd-collision check. */
  get lastExecutingCwd(): string | undefined {
    for (let i = this.props.statusLog.length - 1; i >= 0; i--) {
      const entry = this.props.statusLog[i]!;
      if (entry.state === 'executing' && entry.executingAtCwd !== undefined) {
        return entry.executingAtCwd;
      }
    }
    return undefined;
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
   * `status_log.length + reviews.length + thanks.length` — all three
   * arrays are append-only, so their combined length is a monotonic
   * version. The repository uses it as an optimistic-lock token: if
   * the on-disk total has grown since, another writer won the race
   * and our save is rejected.
   */
  get loadedVersion(): number {
    return this._loadedVersion;
  }

  /**
   * Current total mutation count. Equivalent to the version the
   * repository will write with, so `loadedVersion` + delta = `currentVersion`.
   */
  get currentVersion(): number {
    return computeVersion(this.props.statusLog.length, this.props.reviews.length, (this.props.thanks ?? []).length);
  }

  approve(by: MemberName, note?: string, invokedBy?: string): void {
    this.transition('approved', by, note, invokedBy);
  }

  deny(by: MemberName, reason: string, invokedBy?: string): void {
    this.transition('denied', by, reason, invokedBy);
  }

  execute(
    by: MemberName,
    note?: string,
    invokedBy?: string,
    cwd?: string,
  ): void {
    // cwd lands on the status_log entry only when supplied; the
    // common (#231-unaware) call path keeps emitting byte-identical
    // YAML.
    this.transition('executing', by, note, invokedBy, cwd);
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

  /**
   * Append a thank to the request. Parallels addReview but for the
   * gratitude primitive — no verdict, no state change, doesn't feed
   * calibration. Cap mirrors reviews (50) so a degenerate caller
   * can't fill disk; in practice this should be generous enough.
   */
  addThank(thank: Thank): void {
    const list = this.props.thanks ?? [];
    if (list.length >= MAX_THANKS) {
      throw new DomainError(`Too many thanks (max ${MAX_THANKS})`, 'thanks');
    }
    list.push(thank);
    this.props.thanks = list;
  }

  get thanks(): readonly Thank[] {
    return this.props.thanks ?? [];
  }

  private transition(
    to: RequestState,
    by: MemberName,
    note?: string,
    invokedBy?: string,
    cwd?: string,
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
    // cwd is meaningful only on `executing` entries: it's what the
    // worktree-isolation check (#231) compares across parallel
    // executors. Stamping cwd on approve/complete/fail would just
    // bloat the log without giving the check anything to read.
    if (to === 'executing' && cwd !== undefined && cwd.length > 0) {
      entry.executingAtCwd = cwd;
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
    // Thanks surface only when present — zero thanks is the common
    // case and an empty array would clutter every show payload.
    // Forward-compatible: consumers reading old records (pre-thanks)
    // see no `thanks` key at all, which is correct.
    const thanks = this.props.thanks ?? [];
    if (thanks.length > 0) {
      out['thanks'] = thanks.map((t) => t.toJSON());
    }
    // Executors (issue #230). Wire form is always the new `executors`
    // array; YAML persistence stays clean (no duplicated keys, per
    // principle 04 — records-outlive-writers — and the spec line
    // "旧形式は read のみ tolerance"). The legacy `executor` JSON key
    // is emitted only by `toRenderJSON()` for the `gate show --format
    // json` agent surface, where dropping it outright would break
    // tool wirings that read it directly (e.g. `jq .executor`). The
    // split lives in two methods rather than one option-flag because
    // YAML.stringify is called from a different code path than
    // process.stdout.write — keeping them as separate functions makes
    // it impossible to accidentally pollute the persistence side with
    // the back-compat alias.
    const execList = this.props.executors ?? [];
    if (execList.length > 0) {
      out['executors'] = execList.map((m) => m.value);
    }
    if (this.props.autoReview)
      out['auto_review'] = this.props.autoReview.value;
    if (this.props.target !== undefined) out['target'] = this.props.target;
    // depth surfaces only when set — absence on read is 'standard'
    // by convention (issue #221). Records pre-#221 have no depth
    // field; toJSON honours that by omitting the key, keeping older
    // YAML byte-stable on round-trip.
    if (this.props.depth !== undefined) out['depth'] = this.props.depth;
    if (this.props.with && this.props.with.length > 0)
      out['with'] = this.props.with.map((m) => m.value);
    if (this.props.promotedFrom !== undefined)
      out['promoted_from'] = this.props.promotedFrom;
    // Worktree isolation requirement (#231). Surface only when true —
    // the YAML stays minimal and pre-#231 records remain byte-stable
    // on round-trip (false-by-absence is the load tolerance).
    if (this.props.requiresWorktreeIsolation === true) {
      out['requires_worktree_isolation'] = true;
    }
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

  /**
   * Render-side JSON projection. Same shape as `toJSON` PLUS the
   * deprecated `executor` (= `executors[0]`) back-compat key for tool
   * wirings that read the singleton directly (e.g. `gate show --format
   * json | jq .executor`). Keeping persistence (`toJSON`, called by
   * the YAML repo) and rendering (this) as separate methods makes it
   * structurally impossible to pollute the on-disk record with the
   * deprecated alias — a single option-flag would have left that mode
   * one wrong default away. See toJSON for the spec rationale.
   *
   * TODO: remove the deprecated `executor` JSON key in v0.7.0 of
   * guild-cli, kept for back-compat per #230 review (Devil verdict
   * blocker 2). Multi-executor consumers should already read from
   * `executors`.
   */
  toRenderJSON(): Record<string, unknown> {
    const base = this.toJSON();
    const execList = this.props.executors ?? [];
    if (execList.length > 0) {
      base['executor'] = execList[0]!.value;
    }
    return base;
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
  if (e.executingAtCwd !== undefined) out['executing_at_cwd'] = e.executingAtCwd;
  return out;
}

/**
 * Total mutation count: status_log entries + reviews + thanks. All
 * three arrays are append-only so the sum is monotonic across any
 * legal mutation. Thanks are included despite being orthogonal to the
 * analytical memory (principle 06): they are still records that
 * outlive writers (principle 04), and a concurrent addThank that
 * silently loses to last-writer-wins would violate append-only.
 * Kept as a module-private helper so the invariant is defined in one
 * place and the repository can reuse it when reading raw YAML.
 */
export function computeVersion(statusLogLen: number, reviewsLen: number, thanksLen: number = 0): number {
  return statusLogLen + reviewsLen + thanksLen;
}

// Local wrapper over the shared sanitizer: every call in this file used
// the request-scoped MAX_TEXT + requireNonEmpty invariants, so keeping
// the local name lets the existing call sites stay byte-identical while
// still consolidating the algorithm in one place.
function sanitizeText(raw: unknown, field: string): string {
  return sharedSanitizeText(raw, field, { maxLen: MAX_TEXT });
}

// Re-export for persistence layer
export { parseRequestState };
