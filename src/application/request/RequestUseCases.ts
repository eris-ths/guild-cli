import { Request } from '../../domain/request/Request.js';
import { RequestId } from '../../domain/request/RequestId.js';
import {
  RequestState,
  REQUEST_STATES,
} from '../../domain/request/RequestState.js';
import { Review } from '../../domain/request/Review.js';
import { DomainError } from '../../domain/shared/DomainError.js';
import { compareSequenceIds } from '../../domain/shared/compareSequenceIds.js';
import {
  RequestRepository,
  RequestIdCollision,
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
    executor?: string;
    target?: string;
    autoReview?: string;
    with?: readonly string[];
    invokedBy?: string;
    /** Issue id this request was promoted from (via `gate issues
     *  promote`). Tool-generated structured link surviving any
     *  --action / --reason overrides. */
    promotedFrom?: string;
  }): Promise<Request> {
    const { requests, members, clock } = this.deps;
    const from = await assertActor(input.from, '--from', members);
    if (input.executor !== undefined) {
      await assertActor(input.executor, '--executor', members);
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
    if (input.executor !== undefined) createArgs.executor = input.executor;
    if (input.target !== undefined) createArgs.target = input.target;
    if (input.autoReview !== undefined)
      createArgs.autoReview = input.autoReview;
    if (input.with !== undefined && input.with.length > 0)
      createArgs.with = input.with;
    if (input.invokedBy !== undefined) createArgs.invokedBy = input.invokedBy;
    if (input.promotedFrom !== undefined)
      createArgs.promotedFrom = input.promotedFrom;

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
  ): Promise<Request> {
    const req = await this.loadOrThrow(id);
    const actor = await assertActor(by, '--by', this.deps.members);
    req.approve(actor, note, invokedBy);
    await this.deps.requests.save(req);
    return req;
  }

  async deny(
    id: string,
    by: string,
    reason: string,
    invokedBy?: string,
  ): Promise<Request> {
    const req = await this.loadOrThrow(id);
    const actor = await assertActor(by, '--by', this.deps.members);
    req.deny(actor, reason, invokedBy);
    await this.deps.requests.save(req);
    return req;
  }

  async execute(
    id: string,
    by: string,
    note?: string,
    invokedBy?: string,
  ): Promise<Request> {
    const req = await this.loadOrThrow(id);
    const actor = await assertActor(by, '--by', this.deps.members);
    req.execute(actor, note, invokedBy);
    await this.deps.requests.save(req);
    return req;
  }

  async complete(
    id: string,
    by: string,
    note?: string,
    invokedBy?: string,
  ): Promise<Request> {
    const req = await this.loadOrThrow(id);
    const actor = await assertActor(by, '--by', this.deps.members);
    req.complete(actor, note, invokedBy);
    await this.deps.requests.save(req);
    return req;
  }

  async fail(
    id: string,
    by: string,
    reason: string,
    invokedBy?: string,
  ): Promise<Request> {
    const req = await this.loadOrThrow(id);
    const actor = await assertActor(by, '--by', this.deps.members);
    req.fail(actor, reason, invokedBy);
    await this.deps.requests.save(req);
    return req;
  }

  async review(input: {
    id: string;
    by: string;
    lense: string;
    verdict: string;
    comment: string;
    invokedBy?: string;
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
    await this.deps.requests.save(req);
    return req;
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
