import { Request } from '../../domain/request/Request.js';
import { RequestId } from '../../domain/request/RequestId.js';
import {
  RequestState,
  REQUEST_STATES,
} from '../../domain/request/RequestState.js';
import { Review } from '../../domain/request/Review.js';
import { Thank } from '../../domain/request/Thank.js';
import { DomainError } from '../../domain/shared/DomainError.js';
import { compareSequenceIds } from '../../domain/shared/compareSequenceIds.js';
import {
  RequestRepository,
  RequestIdCollision,
  RequestVersionConflict,
} from '../ports/RequestRepository.js';
import { MemberRepository } from '../ports/MemberRepository.js';
import { NotificationPort } from '../ports/NotificationPort.js';
// NotificationPort is kept in deps for future targeted notifications
// (e.g. request_completed → suggested reviewer). Request creation itself
// no longer self-notifies the creator.
import { Clock } from '../ports/Clock.js';
import { assertActor } from '../shared/assertActor.js';

export interface RequestUseCasesDeps {
  requests: RequestRepository;
  members: MemberRepository;
  notifier: NotificationPort;
  clock: Clock;
  allowedLenses?: readonly string[];
}

function dateKey(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export class RequestUseCases {
  constructor(private readonly deps: RequestUseCasesDeps) {}

  async create(input: {
    from: string;
    action: string;
    reason: string;
    /** Executors (issue #230). Array-only form as of v0.6 (#239 cut
     *  removed the singular `executor` convenience field). */
    executors?: readonly string[];
    target?: string;
    /** Reviewer-depth advisory ('shallow' | 'standard' | 'deep').
     *  Validated at the domain boundary in Request.create. See
     *  RequestProps.depth and issue #221. */
    depth?: string;
    autoReview?: string;
    with?: readonly string[];
    invokedBy?: string;
    /** Issue id this request was promoted from (via `gate issues
     *  promote`). Tool-generated structured link surviving any
     *  --action / --reason overrides. */
    promotedFrom?: string;
    /** Worktree-isolation flag (#231). Set by the interface layer
     *  when profile=swarm + executors.length > 1. Persisted only
     *  when true; absence reads as false. */
    requiresWorktreeIsolation?: boolean;
    /** Source agora play id (#232). Set by the `--from-agora` bridge
     *  in the interface layer when the request action/reason were
     *  derived from an agora play's invitation/cliff. Persisted only
     *  when set (absence is the common case). */
    sourceAgoraPlay?: string;
    /** Wave-brief template stamp (#235). Threads through from the
     *  interface layer's `--template` flag. The trio (template name,
     *  version, gate_required acknowledgement) moves together; if the
     *  caller supplies `template`, the version defaults to 1 and
     *  acknowledgement to true. Mutually exclusive with
     *  `sourceAgoraPlay` at the interface layer (both supply
     *  action/reason defaults). */
    template?: string;
    templateVersion?: number;
    gateRequiredAcknowledged?: boolean;
    /** Boot-context session_id (#249 slice 2). Passed through verbatim
     *  to `Request.create`, which validates against `SESSION_ID_RE`.
     *  Empty / undefined skips persistence. */
    openedBySession?: string;
  }): Promise<Request> {
    const { requests, members, clock } = this.deps;
    const from = await assertActor(input.from, '--from', members);
    if (input.executors !== undefined) {
      for (const e of input.executors) {
        await assertActor(e, '--executors', members);
      }
    }
    if (input.autoReview !== undefined) {
      await assertActor(input.autoReview, '--auto-review', members);
    }
    if (input.with !== undefined) {
      // Every `with` entry must resolve to a member or host — pair
      // partners are actors on the record, not free-form strings.
      for (const partner of input.with) {
        await assertActor(partner, '--with', members);
      }
    }

    // Sequence allocation + create is TOCTOU: two concurrent calls may
    // race to the same number. saveNew uses an O_EXCL create under the
    // hood; on RequestIdCollision we bump the sequence and retry.
    const now = clock.now();
    const key = dateKey(now);
    let seq = await requests.nextSequence(key);
    const createArgs: Parameters<typeof Request.create>[0] = {
      from: from.value,
      action: input.action,
      reason: input.reason,
      createdAt: now.toISOString(),
      id: RequestId.generate(now, seq),
    };
    if (input.executors !== undefined && input.executors.length > 0) {
      createArgs.executors = input.executors;
    }
    if (input.target !== undefined) createArgs.target = input.target;
    if (input.depth !== undefined) createArgs.depth = input.depth;
    if (input.autoReview !== undefined)
      createArgs.autoReview = input.autoReview;
    if (input.with !== undefined && input.with.length > 0)
      createArgs.with = input.with;
    if (input.invokedBy !== undefined) createArgs.invokedBy = input.invokedBy;
    if (input.promotedFrom !== undefined)
      createArgs.promotedFrom = input.promotedFrom;
    if (input.requiresWorktreeIsolation === true)
      createArgs.requiresWorktreeIsolation = true;
    if (input.sourceAgoraPlay !== undefined)
      createArgs.sourceAgoraPlay = input.sourceAgoraPlay;
    if (input.template !== undefined) {
      createArgs.template = input.template;
      if (input.templateVersion !== undefined)
        createArgs.templateVersion = input.templateVersion;
      if (input.gateRequiredAcknowledged !== undefined)
        createArgs.gateRequiredAcknowledged = input.gateRequiredAcknowledged;
    }
    if (input.openedBySession !== undefined && input.openedBySession.length > 0) {
      createArgs.openedBySession = input.openedBySession;
    }

    for (let attempt = 0; attempt < 10; attempt++) {
      createArgs.id = RequestId.generate(now, seq);
      const request = Request.create(createArgs);
      try {
        await requests.saveNew(request);
        return request;
      } catch (e) {
        if (e instanceof RequestIdCollision) {
          seq += 1;
          continue;
        }
        throw e;
      }
    }
    throw new Error('Failed to allocate request id after 10 attempts');
  }

  async listPending(): Promise<Request[]> {
    return this.deps.requests.listByState('pending');
  }

  async listByState(state: string): Promise<Request[]> {
    if (!(REQUEST_STATES as readonly string[]).includes(state)) {
      throw new DomainError(`Invalid state: ${state}`, 'state');
    }
    const items = await this.deps.requests.listByState(state as RequestState);
    return sortRequests(items);
  }

  /**
   * Return every request across all states, deduplicated by id.
   * Delegates to the repository. Used by cross-cutting read commands
   * (voices / tail / whoami / chain) that do not care about lifecycle.
   */
  async listAll(): Promise<Request[]> {
    return sortRequests(await this.deps.requests.listAll());
  }

  async show(id: string): Promise<Request | null> {
    return this.deps.requests.findById(RequestId.of(id));
  }

  async approve(
    id: string,
    by: string,
    note?: string,
    invokedBy?: string,
    opts?: { dryRun?: boolean },
  ): Promise<Request> {
    const req = await this.loadOrThrow(id);
    const actor = await assertActor(by, '--by', this.deps.members);
    req.approve(actor, note, invokedBy);
    if (!opts?.dryRun) await this.deps.requests.save(req);
    return req;
  }

  async deny(
    id: string,
    by: string,
    reason: string,
    invokedBy?: string,
    opts?: { dryRun?: boolean },
  ): Promise<Request> {
    const req = await this.loadOrThrow(id);
    const actor = await assertActor(by, '--by', this.deps.members);
    req.deny(actor, reason, invokedBy);
    if (!opts?.dryRun) await this.deps.requests.save(req);
    return req;
  }

  async execute(
    id: string,
    by: string,
    note?: string,
    invokedBy?: string,
    opts?: { dryRun?: boolean; cwd?: string },
  ): Promise<Request> {
    const req = await this.loadOrThrow(id);
    const actor = await assertActor(by, '--by', this.deps.members);
    // cwd lands on the status_log entry only when supplied. The
    // worktree-isolation collision check (#231) lives in the
    // interface layer (it needs to read peer requests across
    // states); the use case is the persistence path for the cwd
    // stamp itself.
    req.execute(actor, note, invokedBy, opts?.cwd);
    if (!opts?.dryRun) await this.deps.requests.save(req);
    return req;
  }

  async complete(
    id: string,
    by: string,
    note?: string,
    invokedBy?: string,
    opts?: { dryRun?: boolean; cliff?: string },
  ): Promise<Request> {
    // Per-executor slice closure (#294) makes `complete` the canonical
    // parallel-friendly verb: two executors closing their own slices on
    // the same wave is the normal mode, not the exception. Wrap in
    // version-conflict retry so commutative parallel closes don't error
    // out on RequestVersionConflict — same pattern as claim/witness/
    // unwitness. Refusal cases (terminal-wave reject, double-close
    // refusal, member-check) throw DomainError, NOT VersionConflict,
    // so retry never loops on a genuine refusal.
    //
    // Cliff (#37x): forward-pointing close note travels through here on
    // `opts.cliff`. Threaded through to the domain layer where it
    // attaches to the terminal status_log entry (direct path) or the
    // wave-terminal entry on slice closure of the final slice.
    return retryOnVersionConflict('complete', id, async () => {
      const req = await this.loadOrThrow(id);
      const actor = await assertActor(by, '--by', this.deps.members);
      req.complete(actor, note, invokedBy, opts?.cliff);
      if (!opts?.dryRun) await this.deps.requests.save(req);
      return req;
    });
  }

  async fail(
    id: string,
    by: string,
    reason: string,
    invokedBy?: string,
    opts?: { dryRun?: boolean },
  ): Promise<Request> {
    // Mirror of `complete` — `fail` also routes through `failSlice` for
    // multi-executor waves and races commutatively with sibling closes.
    // Same retry rationale; same safety property (DomainError throws
    // refusal; VersionConflict throws contention).
    return retryOnVersionConflict('fail', id, async () => {
      const req = await this.loadOrThrow(id);
      const actor = await assertActor(by, '--by', this.deps.members);
      req.fail(actor, reason, invokedBy);
      if (!opts?.dryRun) await this.deps.requests.save(req);
      return req;
    });
  }

  async review(input: {
    id: string;
    by: string;
    lense: string;
    verdict: string;
    comment: string;
    invokedBy?: string;
    dryRun?: boolean;
  }): Promise<Request> {
    const req = await this.loadOrThrow(input.id);
    await assertActor(input.by, '--by', this.deps.members);
    const review = Review.create({
      by: input.by,
      lense: input.lense,
      verdict: input.verdict,
      comment: input.comment,
      at: this.deps.clock.now().toISOString(),
      ...(input.invokedBy !== undefined ? { invokedBy: input.invokedBy } : {}),
      ...(this.deps.allowedLenses ? { allowedLenses: this.deps.allowedLenses } : {}),
    });
    req.addReview(review);
    if (!input.dryRun) await this.deps.requests.save(req);
    return req;
  }

  /**
   * Record a cross-actor thank against a request. Mirrors `review` in
   * shape but with different semantics: no verdict, no state change,
   * doesn't feed voice calibration. The `by` and `to` actors are
   * both asserted against the member/host directory.
   */
  async thank(input: {
    id: string;
    by: string;
    to: string;
    reason?: string;
    invokedBy?: string;
    dryRun?: boolean;
  }): Promise<Request> {
    const req = await this.loadOrThrow(input.id);
    await assertActor(input.by, '--by', this.deps.members);
    await assertActor(input.to, '--to', this.deps.members);
    const thankInput: Parameters<typeof Thank.create>[0] = {
      by: input.by,
      to: input.to,
      at: this.deps.clock.now().toISOString(),
    };
    if (input.reason !== undefined) thankInput.reason = input.reason;
    if (input.invokedBy !== undefined) thankInput.invokedBy = input.invokedBy;
    const thank = Thank.create(thankInput);
    req.addThank(thank);
    if (!input.dryRun) await this.deps.requests.save(req);
    return req;
  }

  /**
   * Stake a cross-session claim on a request (issue #226 phase 1).
   * Thin wrapper over the domain `Request.claim`: validates `by`
   * against the member directory, then delegates the idempotency /
   * conflict / state-guard logic to the aggregate. Save is skipped
   * when the claim is a no-op (same-actor re-claim) — the aggregate
   * doesn't mutate, so persisting would only churn the file's
   * version-lock without changing content.
   */
  async claim(input: {
    id: string;
    by: string;
    note?: string;
    /** Boot-context session_id (#249 slice 2). When set, paired with
     *  the claim as `claimed_by_session` for cross-session
     *  attribution. Validated against `SESSION_ID_RE` at the domain
     *  boundary. */
    bySession?: string;
    dryRun?: boolean;
  }): Promise<{ request: Request; mutated: boolean }> {
    const actor = await assertActor(input.by, '--by', this.deps.members);
    // Retry on RequestVersionConflict: claim/witness/unwitness mediate
    // a live cross-session race window (#244 root cause), so a
    // concurrent claim/witness landing between our load and save is
    // expected, not exceptional. Re-load and re-apply — the domain
    // verb is idempotent on no-op (same-actor re-claim) and refuses
    // on conflict (different-actor claim already held), so retry is
    // safe and bounded.
    return retryOnVersionConflict('claim', input.id, async () => {
      const req = await this.loadOrThrow(input.id);
      // mutationSeq is the canonical "real change happened" witness —
      // covers the (#246) case where a same-actor re-claim with a
      // divergent --note is a real mutation even though claimedBy
      // didn't change. Pre-#246 the claimedBy delta sufficed; under
      // notes, it doesn't.
      const before = req.mutationSeq;
      req.claim(
        actor,
        this.deps.clock.now().toISOString(),
        input.note,
        input.bySession,
      );
      const mutated = req.mutationSeq !== before;
      if (mutated && !input.dryRun) await this.deps.requests.save(req);
      return { request: req, mutated };
    });
  }

  /**
   * Register a non-exclusive observer (issue #244). Thin wrapper over
   * `Request.witness`: validates `by` against the member directory,
   * delegates the idempotency / state-guard logic to the aggregate.
   * Save is skipped when the witness already exists (re-witness no-op)
   * since the aggregate stays unchanged and persisting would only
   * churn the file's version-lock.
   */
  async witness(input: {
    id: string;
    by: string;
    note?: string;
    /** Boot-context session_id (#249 slice 2). When set, stamped into
     *  `witness_sessions[<actor>]` so a parallel-session run shows
     *  per-witness attribution. Validated at the domain boundary. */
    bySession?: string;
    dryRun?: boolean;
  }): Promise<{ request: Request; mutated: boolean }> {
    const actor = await assertActor(input.by, '--by', this.deps.members);
    return retryOnVersionConflict('witness', input.id, async () => {
      const req = await this.loadOrThrow(input.id);
      // mutationSeq tracks both first-time witness and same-actor
      // re-witness with a divergent note (#246) — the latter doesn't
      // change witnesses.length but is a real mutation.
      const before = req.mutationSeq;
      req.witness(
        actor,
        input.note,
        input.bySession,
        this.deps.clock.now().toISOString(),
      );
      const mutated = req.mutationSeq !== before;
      if (mutated && !input.dryRun) await this.deps.requests.save(req);
      return { request: req, mutated };
    });
  }

  /**
   * Remove the caller's witness (issue #244). Sibling of `witness`:
   * domain throws when the actor is not a current witness, so the
   * use case stays a thin pass-through. Always saves on success
   * because unwitness is always a real mutation (length decreases).
   */
  async unwitness(input: {
    id: string;
    by: string;
    dryRun?: boolean;
  }): Promise<Request> {
    const actor = await assertActor(input.by, '--by', this.deps.members);
    return retryOnVersionConflict('unwitness', input.id, async () => {
      const req = await this.loadOrThrow(input.id);
      req.unwitness(actor);
      if (!input.dryRun) await this.deps.requests.save(req);
      return req;
    });
  }

  private async loadOrThrow(id: string): Promise<Request> {
    const req = await this.deps.requests.findById(RequestId.of(id));
    if (!req) throw new DomainError(`Request not found: ${id}`, 'id');
    return req;
  }
}

function sortRequests(items: Request[]): Request[] {
  return [...items].sort((a, b) =>
    compareSequenceIds(a.id.value, b.id.value),
  );
}

/**
 * Re-run a load → mutate → save pipeline up to N times on
 * `RequestVersionConflict`, with a small staggered backoff to avoid
 * livelock when many actors race on the same id.
 *
 * Why retry lives at the use case (not the repository): the
 * repository's optimistic-lock check is the *signal*; deciding what
 * to retry and how is a use-case-level policy. claim / witness /
 * unwitness mediate a live cross-session race window (#244 Devil
 * REJECT root cause: two concurrent witnesses both passing the lock
 * because length-based version was non-monotonic, then last-writer-
 * wins atomic rename silently dropping one). The mutation_seq fix
 * makes the conflict observable; this helper makes it recoverable.
 *
 * Bounds: 8 attempts is generous for the realistic cases (4 parallel
 * witnesses on the same id) while still terminating on a pathological
 * thrash. The domain verbs are idempotent on no-op and refuse on
 * genuine conflict (different-actor claim while one is held), so
 * "retry until success" is safe semantically — it doesn't paper over
 * legitimate refusals.
 *
 * Last attempt re-throws so the caller still sees the error if the
 * race window genuinely never closes.
 */
async function retryOnVersionConflict<T>(
  verb: string,
  id: string,
  fn: () => Promise<T>,
): Promise<T> {
  const maxAttempts = 8;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof RequestVersionConflict)) throw e;
      lastErr = e;
      // Tiny staggered backoff — multiplicative on attempt to spread
      // out hot-spot contention. The numbers are deliberately small:
      // we're racing on a local file, not a remote service, and the
      // contention window is sub-millisecond.
      const delayMs = Math.min(2 * (attempt + 1), 16);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  // Out of attempts — annotate the error so the operator can tell a
  // genuine pile-up from a single conflict, then re-throw the last
  // one so the existing error envelope still surfaces.
  if (lastErr instanceof Error) {
    lastErr.message = `${verb}(${id}): ${lastErr.message} [exhausted ${maxAttempts} retries]`;
  }
  throw lastErr;
}
