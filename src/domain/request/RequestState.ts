import { DomainError } from '../shared/DomainError.js';

export const REQUEST_STATES = [
  'pending',
  'approved',
  'executing',
  'completed',
  'failed',
  'denied',
] as const;

export type RequestState = (typeof REQUEST_STATES)[number];

const TRANSITIONS: Record<RequestState, readonly RequestState[]> = {
  pending: ['approved', 'denied'],
  approved: ['executing'],
  executing: ['completed', 'failed'],
  completed: [],
  failed: [],
  denied: [],
};

export function parseRequestState(value: string): RequestState {
  if ((REQUEST_STATES as readonly string[]).includes(value)) {
    return value as RequestState;
  }
  throw new DomainError(`Invalid request state: "${value}"`, 'state');
}

export function canTransition(from: RequestState, to: RequestState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: RequestState, to: RequestState): void {
  if (canTransition(from, to)) return;
  // Same-state attempts ("approve an already-approved request") are
  // the common idempotency mistake; render them in plain English so
  // the user sees the answer instead of decoding the arrow form.
  if (from === to) {
    throw new DomainError(`Request is already ${from}.`, 'state');
  }
  throw new DomainError(
    `Illegal state transition: ${from} → ${to}`,
    'state',
  );
}
