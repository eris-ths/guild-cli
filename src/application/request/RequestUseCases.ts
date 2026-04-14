import { Request } from '../../domain/request/Request.js';
import { RequestId } from '../../domain/request/RequestId.js';
import {
  RequestState,
  REQUEST_STATES,
} from '../../domain/request/RequestState.js';
import { Review } from '../../domain/request/Review.js';
import { DomainError } from '../../domain/shared/DomainError.js';
import { RequestRepository } from '../ports/RequestRepository.js';
import { MemberRepository } from '../ports/MemberRepository.js';
import { NotificationPort } from '../ports/NotificationPort.js';
import { Clock } from '../ports/Clock.js';
import { assertActor } from '../shared/assertActor.js';

export interface RequestUseCasesDeps {
  requests: RequestRepository;
  members: MemberRepository;
  notifier: NotificationPort;
  clock: Clock;
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
  }): Promise<Request> {
    const { requests, members, notifier, clock } = this.deps;
    const from = await assertActor(input.from, '--from', members);
    if (input.executor !== undefined) {
      await assertActor(input.executor, '--executor', members);
    }
    if (input.autoReview !== undefined) {
      await assertActor(input.autoReview, '--auto-review', members);
    }

    const now = clock.now();
    const key = dateKey(now);
    const seq = await requests.nextSequence(key);
    const id = RequestId.generate(now, seq);

    const createArgs: Parameters<typeof Request.create>[0] = {
      id,
      from: from.value,
      action: input.action,
      reason: input.reason,
      createdAt: now.toISOString(),
    };
    if (input.executor !== undefined) createArgs.executor = input.executor;
    if (input.target !== undefined) createArgs.target = input.target;
    if (input.autoReview !== undefined)
      createArgs.autoReview = input.autoReview;

    const request = Request.create(createArgs);
    await requests.save(request);

    await notifier.post({
      from: from.value,
      to: from, // mirror to self as audit
      type: 'request_created',
      text: `request ${id.value} created: ${input.action}`,
      related: id.value,
    });
    return request;
  }

  async listPending(): Promise<Request[]> {
    return this.deps.requests.listByState('pending');
  }

  async listByState(state: string): Promise<Request[]> {
    if (!(REQUEST_STATES as readonly string[]).includes(state)) {
      throw new DomainError(`Invalid state: ${state}`, 'state');
    }
    return this.deps.requests.listByState(state as RequestState);
  }

  async show(id: string): Promise<Request | null> {
    return this.deps.requests.findById(RequestId.of(id));
  }

  async approve(id: string, by: string, note?: string): Promise<Request> {
    const req = await this.loadOrThrow(id);
    const actor = await assertActor(by, '--by', this.deps.members);
    req.approve(actor, note);
    await this.deps.requests.save(req);
    return req;
  }

  async deny(id: string, by: string, reason: string): Promise<Request> {
    const req = await this.loadOrThrow(id);
    const actor = await assertActor(by, '--by', this.deps.members);
    req.deny(actor, reason);
    await this.deps.requests.save(req);
    return req;
  }

  async execute(id: string, by: string, note?: string): Promise<Request> {
    const req = await this.loadOrThrow(id);
    const actor = await assertActor(by, '--by', this.deps.members);
    req.execute(actor, note);
    await this.deps.requests.save(req);
    return req;
  }

  async complete(id: string, by: string, note?: string): Promise<Request> {
    const req = await this.loadOrThrow(id);
    const actor = await assertActor(by, '--by', this.deps.members);
    req.complete(actor, note);
    await this.deps.requests.save(req);
    return req;
  }

  async fail(id: string, by: string, reason: string): Promise<Request> {
    const req = await this.loadOrThrow(id);
    const actor = await assertActor(by, '--by', this.deps.members);
    req.fail(actor, reason);
    await this.deps.requests.save(req);
    return req;
  }

  async review(input: {
    id: string;
    by: string;
    lense: string;
    verdict: string;
    comment: string;
  }): Promise<Request> {
    const req = await this.loadOrThrow(input.id);
    await assertActor(input.by, '--by', this.deps.members);
    const review = Review.create({
      by: input.by,
      lense: input.lense,
      verdict: input.verdict,
      comment: input.comment,
      at: this.deps.clock.now().toISOString(),
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
