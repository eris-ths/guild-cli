import { Request } from '../../domain/request/Request.js';
import { RequestId } from '../../domain/request/RequestId.js';
import { RequestState } from '../../domain/request/RequestState.js';

export interface RequestRepository {
  findById(id: RequestId): Promise<Request | null>;
  listByState(state: RequestState): Promise<Request[]>;
  /** Persist; positions file under current state directory. */
  save(request: Request): Promise<void>;
  /** Allocate a new sequence number for the given date (YYYY-MM-DD). */
  nextSequence(dateKey: string): Promise<number>;
}
