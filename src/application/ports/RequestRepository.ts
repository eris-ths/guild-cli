import { Request } from '../../domain/request/Request.js';
import { RequestId } from '../../domain/request/RequestId.js';
import { RequestState } from '../../domain/request/RequestState.js';

export interface RequestRepository {
  findById(id: RequestId): Promise<Request | null>;
  listByState(state: RequestState): Promise<Request[]>;
  /** Persist; positions file under current state directory. */
  save(request: Request): Promise<void>;
  /**
   * Create a brand-new request file. Must fail with `RequestIdCollision`
   * if a file for this id already exists anywhere in the requests tree —
   * callers rely on the error to drive sequence-allocation retry.
   */
  saveNew(request: Request): Promise<void>;
  /** Allocate a candidate sequence number for the given date (YYYY-MM-DD). */
  nextSequence(dateKey: string): Promise<number>;
}

export class RequestIdCollision extends Error {
  constructor(id: string) {
    super(`Request id already exists: ${id}`);
    this.name = 'RequestIdCollision';
  }
}
