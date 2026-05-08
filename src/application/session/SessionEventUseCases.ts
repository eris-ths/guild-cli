import type { Clock } from '../ports/Clock.js';
import type { MemberRepository } from '../ports/MemberRepository.js';
import { SessionEvent, SessionKind } from '../../domain/session/SessionEvent.js';
import { SessionEventRepository } from './SessionEventRepository.js';
import { assertActor } from '../shared/assertActor.js';

export interface RecordSessionEventInput {
  readonly kind: SessionKind;
  readonly by: string;
  readonly note?: string;
}

export interface SessionEventUseCasesDeps {
  readonly events: SessionEventRepository;
  readonly members: MemberRepository;
  readonly clock: Clock;
}

/**
 * Use-cases for session-boundary records (#36 Phase 2).
 *
 * Phase 2's first slice (this PR) only wires `record({ kind: 'rest' })`
 * via the `gate rest` handler. The interface accepts the full
 * `SessionKind` union so the wake / farewell handlers in follow-up
 * PRs can reuse `record()` without a domain change.
 */
export class SessionEventUseCases {
  constructor(private readonly deps: SessionEventUseCasesDeps) {}

  /**
   * Record one boundary event. Allocates a per-day sequence id,
   * stamps the system clock, and persists. Returns the saved
   * record so the handler can emit it back to the caller.
   */
  async record(input: RecordSessionEventInput): Promise<SessionEvent> {
    const actor = await assertActor(input.by, '--by', this.deps.members);
    const at = this.deps.clock.now().toISOString();
    const dateKey = at.slice(0, 10); // YYYY-MM-DD
    const seq = await this.deps.events.nextSequence(dateKey);
    const id = `${dateKey}-${String(seq).padStart(3, '0')}`;
    const event = SessionEvent.create({
      id,
      kind: input.kind,
      by: actor,
      at,
      ...(input.note !== undefined ? { note: input.note } : {}),
    });
    await this.deps.events.save(event);
    return event;
  }
}
