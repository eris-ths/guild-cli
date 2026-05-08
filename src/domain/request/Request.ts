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
   * Tool-generated structured link to the agora play this request was
   * derived from (via `gate request --from-agora <play_id>`). Populated
   * by the `--from-agora` bridge orchestration in the interface layer;
   * undefined for plain `gate request` calls. Distinct from text mentions
   * of a play id in action/reason: `--from-agora` lifts the play's
   * cliff/invitation prose into the action+reason fields, AND records
   * the play id structurally here so `gate chain`-style walks can
   * traverse the agora→gate edge without scanning free-form text.
   *
   * Same shape as `promotedFrom` (the issue→request equivalent). Issue
   * #232 — surfaces "this request came out of <play>" without forcing
   * the operator to remember to mention the id in prose.
   */
  sourceAgoraPlay?: string;
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
  /**
   * Wave-brief template registry (#235). When the request was created
   * via `gate request --template <name>`, the chosen template name is
   * stamped here so downstream consumers can recover "which brief did
   * this wave start from?" without re-parsing free-text fields.
   *
   * Persistence: `template` / `template_version` / `gate_required_acknowledged`
   * are emitted only when `template` is set (the trio moves together —
   * if you stamped a template, the version and gate-acknowledgement
   * round-trip with it). Pre-#235 records lack all three fields and
   * hydrate as undefined (template-less). Byte-stable round-trip for
   * non-template records. */
  template?: string;
  /** Template version (#235). Currently always 1; bumps if a template's
   *  intended_use or skeleton meaningfully changes. Paired with
   *  `template`; if `template` is set, this is set too. */
  templateVersion?: number;
  /** Acknowledgement that the template's `gate_required: true` contract
   *  was honoured at request-creation time (#235). Always recorded as
   *  true on a templated request — phase-1 is "we shipped via the
   *  template path". A future release may surface a `--no-gate` opt-out
   *  for stub experiments; until then the field's presence is a
   *  positive assertion, not a toggle. */
  gateRequiredAcknowledged?: boolean;
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
  /**
   * Cross-session stake claim (issue #226 phase 1). When set, names the
   * actor who has claimed responsibility for this request. Independent
   * of `executors`: claim is a *session-level* "I'm working on this
   * right now, do not double-stake" signal that another concurrent
   * session can read before independently picking up the same id. The
   * full witness/release flow is deferred to a follow-up issue —
   * phase 1 ships claim only, with auto-release on terminal transitions
   * (completed/failed/denied) so the field can never be left hanging
   * on a closed record.
   *
   * Persistence: omitted from YAML when null (byte-stable round-trip
   * with pre-#226 records). Old records hydrate as null.
   */
  claimedBy?: MemberName;
  /** ISO 8601 timestamp of the claim, paired with `claimedBy`. Both
   *  fields move together — set together, cleared together. */
  claimedAt?: string;
  /**
   * Cross-session non-exclusive observers (issue #226 phase 2 / #244).
   * Sibling primitive to `claimedBy`: where claim is "I'm working on
   * this right now, do not double-stake" (exclusive, refuses on
   * conflict), `witnesses` is "I'm watching this" (non-exclusive,
   * multiple actors can witness simultaneously, never refuses on
   * conflict with claim or with another witness). Order is meaningful
   * — registration order — so a reader can see "first observer" first.
   *
   * Persistence: omitted from YAML when empty (byte-stable round-trip
   * with pre-#244 records). Old records hydrate as []. Auto-resets
   * to [] on terminal transitions for the same reason claim does:
   * the verb mediates the live cross-session race window, and a
   * terminal record carries no further race signal.
   */
  witnesses?: MemberName[];
  /**
   * Monotonic mutation counter for cross-session-mutating verbs that
   * are NOT append-only on a recorded array (issue #244 follow-up;
   * Devil REJECT root cause). `claim` / `witness` / `unwitness` and
   * the terminal auto-reset of both can each remove entries from
   * `claimed_by` / `witnesses[]`, so length-based version tokens
   * (`status_log + reviews + thanks`) are non-monotonic across these
   * verbs and let the optimistic-lock check pass concurrent writers
   * that would silently drop one another's mutation under last-
   * writer-wins atomic rename.
   *
   * Bumped exactly once per real mutation:
   *   - `claim()` — first-time claim by an actor (idempotent re-claim
   *     by same actor does NOT bump, matching its no-op save path).
   *   - `witness()` — first-time witness by an actor (re-witness no-op
   *     does NOT bump).
   *   - `unwitness()` — every successful removal.
   *   - `transition()` terminal auto-reset — `+1` per cleared actor
   *     (one for the claim if held, one per witness in the list) so
   *     a single terminal frontier collapsing "claim + 3 witnesses"
   *     bumps `+4` total. Per-actor accounting keeps the version
   *     observable from outside: a reader can see "exactly 4 actors
   *     were mediating at terminal time" via the seq delta.
   *
   * Persistence: `mutation_seq` is omitted from YAML when 0 (the
   * common case for never-mediated records — pre-#244 records load
   * as 0 and round-trip clean). Hydrate accepts the field when
   * present and a finite non-negative number; anything else is
   * treated as 0 with an `onMalformed` warn so the migration is
   * visible. Surfaced through `computeVersion` so the repository's
   * optimistic-lock check is monotonic across every legal mutation.
   */
  mutationSeq?: number;
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
    /** See RequestProps.sourceAgoraPlay — agora play id this request
     *  was bridged from (via `gate request --from-agora <play_id>`).
     *  Populated by the --from-agora orchestration only. Issue #232. */
    sourceAgoraPlay?: string;
    /** See RequestProps.requiresWorktreeIsolation — set by the
     *  interface layer when profile=swarm + executors.length > 1.
     *  Persisted as `requires_worktree_isolation: true` only when
     *  truthy; older / single-executor / standard-profile records
     *  carry no field at all (false-by-absence). Issue #231. */
    requiresWorktreeIsolation?: boolean;
    /** Template stamp (#235). If `template` is set, `templateVersion`
     *  must be a positive integer and `gateRequiredAcknowledged` is
     *  recorded as true. The interface layer is the only legitimate
     *  caller that supplies these; non-CLI callers may pass them too
     *  if they're enforcing the same contract. */
    template?: string;
    templateVersion?: number;
    gateRequiredAcknowledged?: boolean;
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
    if (input.sourceAgoraPlay !== undefined) {
      // sanitizeText guards length/charset the same way action/reason
      // are guarded — a malformed play id smuggled into the field at
      // a non-CLI entry point still gets normalized. The interface
      // layer pre-validates with parsePlayId, so this is the second
      // line of defence.
      props.sourceAgoraPlay = sanitizeText(input.sourceAgoraPlay, 'sourceAgoraPlay');
    }
    // Worktree-isolation: persist only when explicitly true. The
    // false case is represented by field absence on disk so the YAML
    // surface stays minimal (matches `depth`, `with`, `target` etc).
    // Issue #231.
    if (input.requiresWorktreeIsolation === true) {
      props.requiresWorktreeIsolation = true;
    }
    // Template stamp (#235). Persist all three fields together when a
    // template was chosen — version and gate-required acknowledgement
    // are meaningless without the template name. Validation: name must
    // be a non-empty string (the interface layer also pre-checks
    // against the registry); version must be a positive integer.
    if (input.template !== undefined) {
      const name = String(input.template).trim();
      if (name.length === 0) {
        throw new DomainError(
          'template name must be a non-empty string',
          'template',
        );
      }
      const version = input.templateVersion ?? 1;
      if (!Number.isInteger(version) || version < 1) {
        throw new DomainError(
          `template_version must be a positive integer, got ${version}`,
          'templateVersion',
        );
      }
      props.template = name;
      props.templateVersion = version;
      // Phase 1: presence of `template` implies the gate-required
      // contract was honoured — there is no opt-out yet. Record as
      // true unconditionally so a hydrate-then-resave round-trip
      // produces byte-stable YAML even if the input arg was omitted.
      props.gateRequiredAcknowledged = input.gateRequiredAcknowledged ?? true;
    }
    // New requests have no on-disk predecessor; loadedVersion=0 marks
    // "never seen" for the optimistic-lock check in save().
    return new Request(props, 0);
  }

  static restore(props: RequestProps): Request {
    // loadedVersion snapshots the TOTAL mutation count at load time —
    // status_log entries + reviews + thanks + mutation_seq. The first
    // three are append-only array lengths (concurrent addReview races
    // would silently drop a review under last-writer-wins if the
    // counter ignored reviews). mutation_seq closes the equivalent
    // hole for claim / witness / unwitness, which mutate state without
    // appending to any of those arrays. See `computeVersion` below
    // for the single place that defines the invariant.
    return new Request(
      { ...props },
      computeVersion(
        props.statusLog.length,
        props.reviews.length,
        (props.thanks ?? []).length,
        props.mutationSeq ?? 0,
      ),
    );
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
  /** Issue #232 — agora play id this request was bridged from via
   *  `gate request --from-agora <play_id>`. Undefined for plain
   *  requests (the common case). Read surface used by `formatRequestText`
   *  to render the source-play line and by JSON consumers reading
   *  `source_agora_play` directly. */
  get sourceAgoraPlay(): string | undefined {
    return this.props.sourceAgoraPlay;
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
  /** Template registry stamp (#235). Undefined when the request was
   *  created without `--template`; pre-#235 records always undefined. */
  get template(): string | undefined {
    return this.props.template;
  }
  get templateVersion(): number | undefined {
    return this.props.templateVersion;
  }
  get gateRequiredAcknowledged(): boolean | undefined {
    return this.props.gateRequiredAcknowledged;
  }
  /** Most recent `executing` status_log entry's cwd, or undefined
   *  when the request has never been executed (or when the on-disk
   *  record predates #231). Returns the freshest entry so a request
   *  that re-entered `executing` (rare but possible after a `fail`-
   *  retry edit path) reflects the latest filesystem. Read by the
   *  gate execute cwd-collision check.
   *
   *  TODO (Devil follow-up #231): same shape as the executor scalar
   *  leak Devil flagged on #230 — a "latest-only" getter silently
   *  drops history. Promote to `hasExecutingFromCwd(cwd)` predicate
   *  in a follow-up issue once we settle whether older `executing`
   *  entries should ever count for collision detection. */
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
   * `status_log.length + reviews.length + thanks.length + mutation_seq`
   * — the first three are append-only arrays, the fourth is an
   * explicit monotonic counter for non-array mutations (claim /
   * witness / unwitness; see `RequestProps.mutationSeq`). The
   * repository uses the sum as an optimistic-lock token: if the on-
   * disk total has grown since, another writer won the race and our
   * save is rejected (`RequestVersionConflict`).
   */
  get loadedVersion(): number {
    return this._loadedVersion;
  }

  /**
   * Current total mutation count. Equivalent to the version the
   * repository will write with, so `loadedVersion` + delta = `currentVersion`.
   */
  get currentVersion(): number {
    return computeVersion(
      this.props.statusLog.length,
      this.props.reviews.length,
      (this.props.thanks ?? []).length,
      this.props.mutationSeq ?? 0,
    );
  }

  /** Current mutation-sequence counter (0 when never mediated by
   *  claim / witness / unwitness or their terminal auto-reset). See
   *  `RequestProps.mutationSeq` for the full contract. */
  get mutationSeq(): number {
    return this.props.mutationSeq ?? 0;
  }

  /** Bump the mutation counter by one. Private — only the verbs that
   *  contractually count as a "mutation" (claim/witness/unwitness and
   *  the terminal auto-reset, per-cleared-actor) call this. Defined
   *  centrally so the invariant lives in one place. */
  private bumpMutationSeq(): void {
    this.props.mutationSeq = (this.props.mutationSeq ?? 0) + 1;
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

  /** Current claimant, or undefined if unclaimed. Issue #226. */
  get claimedBy(): MemberName | undefined {
    return this.props.claimedBy;
  }
  /** ISO timestamp matched with `claimedBy`. Undefined when unclaimed. */
  get claimedAt(): string | undefined {
    return this.props.claimedAt;
  }

  /**
   * Stake a cross-session claim (issue #226). Three outcomes:
   *
   *   1. Unclaimed → record `(by, at)` (the normal case).
   *   2. Claimed by the same actor → no-op. Idempotent re-claim is
   *      legal because a session that lost track of its own state
   *      should be able to re-assert without surprise. We deliberately
   *      do NOT bump `claimedAt` on re-claim — the field is a "since
   *      when" stamp, not a heartbeat, and rewriting it would make
   *      "this claim has been held for N minutes" unobservable from
   *      outside. The YAML stays byte-identical on a re-claim, which
   *      also keeps the version-lock from incrementing on a no-op.
   *   3. Claimed by a different actor → throw. State must be
   *      `pending` or `approved` for any claim to land — a request
   *      already executing/completed/failed/denied has moved past the
   *      cross-session race that claim exists to mediate.
   *
   * State guard is checked here (domain invariant) rather than only at
   * the use case so non-CLI callers can't bypass it.
   */
  claim(by: MemberName, at: string): void {
    if (this.props.state !== 'pending' && this.props.state !== 'approved') {
      throw new DomainError(
        `Cannot claim a request in state "${this.props.state}"; ` +
          `claim only applies while pending or approved (the cross-session ` +
          `race window).`,
        'state',
      );
    }
    const existing = this.props.claimedBy;
    if (existing !== undefined) {
      if (existing.value === by.value) {
        // Idempotent re-claim — see method doc. No mutation, no log.
        return;
      }
      throw new DomainError(
        `Request ${this.props.id.value} is already claimed by ${existing.value}; ` +
          `cannot claim as ${by.value}. The first claimant must release ` +
          `(or transition the request to a terminal state) before a different ` +
          `actor can stake.`,
        'claimed_by',
      );
    }
    this.props.claimedBy = by;
    this.props.claimedAt = at;
    // Real mutation — bump so the optimistic-lock token moves and a
    // concurrent claim by another actor (which would race past the
    // status_log+reviews+thanks length check, since claim doesn't
    // touch any of those) is detected at save time.
    this.bumpMutationSeq();
  }

  /**
   * Clear the claim. Phase 1 of #226 calls this only from `transition`
   * on terminal states — there is no public release verb yet. Kept as
   * a method (rather than inlined) because the future explicit-release
   * verb will land here unchanged.
   */
  private releaseClaim(): void {
    if (this.props.claimedBy === undefined) return;
    delete this.props.claimedBy;
    delete this.props.claimedAt;
    // Per-actor accounting: a terminal frontier that clears one claim
    // counts as one mutation. See `RequestProps.mutationSeq` for the
    // rationale (observability of how many actors were mediating at
    // the time the request closed).
    this.bumpMutationSeq();
  }

  /** Current witnesses in registration order. Empty when no observers. Issue #244. */
  get witnesses(): readonly MemberName[] {
    return this.props.witnesses ?? [];
  }

  /**
   * Register a non-exclusive observer (issue #244). Witness is the
   * companion verb to claim:
   *
   *   - claim     : "I'm working on this" — exclusive; refuses on conflict.
   *   - witness   : "I'm watching this" — non-exclusive; never refuses.
   *
   * Multiple actors may witness in parallel; a witness coexists with
   * any claim (by the same actor or a different one). Re-witness by
   * the same actor is a no-op — duplicates are not appended, so the
   * array doubles as a set ordered by first registration. The state
   * guard mirrors claim: only `pending` / `approved` / `executing`
   * accept new witnesses, since terminal records have moved past the
   * live race window the verb exists to surface.
   *
   * Unlike claim, witness is permitted on `executing` because passive
   * observation of work-in-progress is a legitimate "I'm following
   * this" signal, whereas claim on `executing` would be too late to
   * mediate the cross-session race claim is designed for.
   */
  witness(by: MemberName): void {
    if (
      this.props.state !== 'pending' &&
      this.props.state !== 'approved' &&
      this.props.state !== 'executing'
    ) {
      throw new DomainError(
        `Cannot witness a request in state "${this.props.state}"; ` +
          `witness only applies while pending, approved, or executing ` +
          `(the live race window).`,
        'state',
      );
    }
    const list = this.props.witnesses ?? [];
    if (list.some((m) => m.value === by.value)) {
      // Idempotent re-witness — already observing, no mutation.
      return;
    }
    list.push(by);
    this.props.witnesses = list;
    // Real mutation — bump for the same reason claim does. See
    // `bumpMutationSeq` doc and `RequestProps.mutationSeq`.
    this.bumpMutationSeq();
  }

  /**
   * Remove the caller's witness (issue #244). Three outcomes:
   *
   *   1. Caller is in the list → remove (the normal case).
   *   2. Caller is not in the list → throw. Quietly no-op'ing would
   *      make a typo (`gate unwitness <id> --by mki`) indistinguishable
   *      from success, and the intent of `unwitness` is to assert
   *      "I want my name OFF this" — a missing entry is meaningful.
   *   3. Foreign actor on someone else's witness → throw. The verb is
   *      reflexive: each actor may only release their own witness,
   *      never another's. (No "kick" semantics in this primitive; if
   *      that ever lands, it gets its own verb name.)
   *
   * State guard intentionally absent: unwitness must work in any
   * state so an observer who joined a request which then progressed
   * to a terminal state can still clean up. In practice the auto-
   * reset on terminal transition does the cleanup first, so a manual
   * unwitness on a closed record finds an empty list — we surface a
   * terminal-aware "no action needed" message instead of the typo
   * error, so an actor running a defensive cleanup pass can tell the
   * benign case from a real misnamed --by.
   */
  unwitness(by: MemberName): void {
    const list = this.props.witnesses ?? [];
    const idx = list.findIndex((m) => m.value === by.value);
    if (idx < 0) {
      const state = this.props.state;
      const isTerminal =
        state === 'completed' || state === 'failed' || state === 'denied';
      const msg = isTerminal
        ? `${by.value} is not currently a witness of request ${this.props.id.value} ` +
          `(state=${state}; witnesses are auto-released on terminal transitions, ` +
          `so any prior witness has already been cleared. No action needed.)`
        : `${by.value} is not a witness of request ${this.props.id.value}; ` +
          `unwitness only removes the caller's own witness (use witness ` +
          `to register first, or check the actor name).`;
      throw new DomainError(msg, 'witnesses');
    }
    list.splice(idx, 1);
    if (list.length === 0) {
      // Drop the prop entirely so toJSON's "omit when empty" branch
      // emits the same byte-stable YAML as a never-witnessed record.
      delete this.props.witnesses;
    } else {
      this.props.witnesses = list;
    }
    // Real mutation — bump so two concurrent unwitness calls by
    // different actors don't both pass the optimistic-lock check
    // (which sees identical pre-mutation length on both sides) and
    // last-writer-wins one of them off the record.
    this.bumpMutationSeq();
  }

  /**
   * Clear all witnesses. Called from `transition` on terminal states
   * for the same reason claim auto-releases — once the request is
   * completed/failed/denied, the live observation channel is moot,
   * and leaving stale witness names on a closed record is just noise.
   */
  private resetWitnesses(): void {
    const list = this.props.witnesses;
    if (list === undefined || list.length === 0) return;
    const cleared = list.length;
    delete this.props.witnesses;
    // Per-actor accounting: bump once per cleared witness so a
    // terminal frontier collapsing N witnesses contributes +N to the
    // version token. Keeps "how many actors were observing at close"
    // recoverable from the seq delta around the terminal entry.
    for (let i = 0; i < cleared; i++) this.bumpMutationSeq();
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
    // Auto-release the cross-session claim (issue #226) when the
    // request reaches a terminal state. Rationale: claim mediates the
    // pending/approved race window; once the work is recorded as
    // completed/failed/denied, holding the claim adds no signal and
    // would only block a future re-open or follow-up flow. We do NOT
    // release on the executing transition because the same session
    // typically does approve→execute and benefits from the claim
    // surviving across that boundary as a "still mine" marker.
    if (to === 'completed' || to === 'failed' || to === 'denied') {
      this.releaseClaim();
      // Witnesses (issue #244) auto-reset on the same terminal frontier
      // as claim. Same rationale: the verb mediates the live race
      // window, and a terminal record carries no further race signal.
      this.resetWitnesses();
    }
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
    // source_agora_play (#232). Surface only when set — the field
    // is absent on every plain `gate request` and on every pre-#232
    // record. Byte-stable round-trip: omit-when-undefined matches the
    // hydrate "absent ⇒ undefined" branch below.
    if (this.props.sourceAgoraPlay !== undefined)
      out['source_agora_play'] = this.props.sourceAgoraPlay;
    // Worktree isolation requirement (#231). Surface only when true —
    // the YAML stays minimal and pre-#231 records remain byte-stable
    // on round-trip (false-by-absence is the load tolerance).
    if (this.props.requiresWorktreeIsolation === true) {
      out['requires_worktree_isolation'] = true;
    }
    // Template registry stamp (#235). The trio (template,
    // template_version, gate_required_acknowledged) moves together —
    // all-set or all-absent. Pre-#235 records and template-less post-
    // #235 records both emit byte-identical YAML on round-trip.
    if (this.props.template !== undefined) {
      out['template'] = this.props.template;
      out['template_version'] = this.props.templateVersion ?? 1;
      if (this.props.gateRequiredAcknowledged !== undefined) {
        out['gate_required_acknowledged'] = this.props.gateRequiredAcknowledged;
      }
    }
    // Cross-session claim (issue #226). Both fields move together —
    // present-when-set, omitted-when-clear — so YAML stays byte-stable
    // for unclaimed records (the common case) and round-trips cleanly
    // when set. The pair invariant is enforced at write (claim/release
    // touch both) and on hydrate (we only restore when both are
    // present-and-typed); a record with only one of the two is
    // structurally inconsistent and dropped.
    if (this.props.claimedBy !== undefined && this.props.claimedAt !== undefined) {
      out['claimed_by'] = this.props.claimedBy.value;
      out['claimed_at'] = this.props.claimedAt;
    }
    // Witnesses (issue #244). Surface only when non-empty — empty
    // witnesses is the common case and an empty array would clutter
    // every YAML record. Order is preserved (registration order, not
    // sorted) so a reader sees "first observer first". Pre-#244
    // records lack the field entirely and round-trip clean.
    const witnessList = this.props.witnesses ?? [];
    if (witnessList.length > 0) {
      out['witnesses'] = witnessList.map((m) => m.value);
    }
    // mutation_seq (issue #244 follow-up). Surface only when > 0 so
    // pre-#244 records and never-mediated post-#244 records both emit
    // byte-identical YAML — the field appears on disk only after the
    // first claim/witness/unwitness mutation. See
    // `RequestProps.mutationSeq` for the optimistic-lock contract.
    const seq = this.props.mutationSeq ?? 0;
    if (seq > 0) {
      out['mutation_seq'] = seq;
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
 * Total mutation count: status_log entries + reviews + thanks +
 * mutation_seq. The first three are append-only array lengths
 * (monotonic by construction — entries are only ever pushed, never
 * removed during a mutation). The fourth is the explicit counter for
 * verbs that DON'T touch any of those arrays but still mutate state
 * (`claim`, `witness`, `unwitness`, terminal auto-reset of either) —
 * see `RequestProps.mutationSeq` for the full rationale.
 *
 * Thanks are included despite being orthogonal to the analytical
 * memory (principle 06): they are still records that outlive writers
 * (principle 04), and a concurrent addThank that silently loses to
 * last-writer-wins would violate append-only. mutation_seq closes the
 * symmetric hole for non-array mutations (Devil REJECT root cause on
 * #244): without it, two concurrent witnesses both saw `{statusLog,
 * reviews, thanks}` length unchanged and both passed the optimistic-
 * lock check, letting last-writer-wins atomic rename silently drop
 * one of them.
 *
 * Kept as a module-private helper so the invariant is defined in one
 * place and the repository can reuse it when reading raw YAML.
 */
export function computeVersion(
  statusLogLen: number,
  reviewsLen: number,
  thanksLen: number = 0,
  mutationSeq: number = 0,
): number {
  return statusLogLen + reviewsLen + thanksLen + mutationSeq;
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
