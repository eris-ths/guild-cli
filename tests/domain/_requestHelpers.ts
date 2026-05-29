// Shared fixtures for the Request domain test split. Extracted from the
// original monolithic Request.test.ts (1158 lines) so the per-concern
// files (RequestId / core lifecycle / #294 slice closure) reuse one
// definition of the fixed clock + the minimal pending-request builder.
import { Request } from '../../src/domain/request/Request.js';
import { RequestId } from '../../src/domain/request/RequestId.js';

/** Fixed clock so generated ids are deterministic across the split files. */
export const d = new Date('2026-04-14T00:00:00Z');

/** Minimal single-actor pending request (the common starting point). */
export function mkReq(): Request {
  return Request.create({
    id: RequestId.generate(d, 1),
    from: 'alice',
    action: 'do stuff',
    reason: 'because',
  });
}
